// lib/db/utils/password-reset.ts
// ─────────────────────────────────────────────────────────────────────────────
// "Lupa password" — staff request → IT verifies → one-time link → new password.
//
//   1. submitResetRequest()  public. NIK + store email must match the user's
//      home store (stores.email). The reply is the same whether or not they
//      matched (no NIK/email probing); on a match a `pending` row is written and
//      the store mailbox gets a "request received" email.
//   2. sendResetLink()       IT. Mints a random token (only its SHA-256 is
//      stored), emails /reset-password/<token> to the store mailbox, 24h TTL.
//      Any other live link of the same user is cancelled.
//   3. checkResetLink() / completeReset()  public. The link only works with the
//      NIK it was made for — another NIK gets "Link ini bukan untuk NIK Anda."
//      and counts as a failed attempt; RESET_MAX_NIK_ATTEMPTS locks the link.
//      Success sets the password, marks the row `completed` (IT sees it) and
//      emails the store mailbox.
//
// Emails go through lib/email/graph-mail.ts. The public steps hand their email
// work back as `followUp` so the route can run it after responding (next/server
// `after`) — the response time then doesn't reveal whether the NIK matched.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, desc, eq, gt, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/lib/db';
import { passwordResetRequests, stores, users } from '@/lib/db/schema';
import { validateNewPassword } from '@/lib/auth/password';
import { clearLoginFailures } from '@/lib/auth/rate-limit';
import { sendMail } from '@/lib/email/graph-mail';
import {
  itNotifyEmail,
  requestReceivedEmail,
  requestRejectedEmail,
  resetCompletedEmail,
  resetLinkEmail,
  type ResetEmailPerson,
} from '@/lib/email/password-reset-emails';
import {
  derivePasswordResetStatus,
  isOpenPasswordResetStatus,
  isValidEmail,
  NIK_MISMATCH_MESSAGE,
  normalizeEmail,
  RESET_LINK_TTL_HOURS,
  RESET_MAX_NIK_ATTEMPTS,
  RESET_REJECT_REASON_MAX,
  resetPasswordError,
  sameNik,
  type PasswordResetCounts,
  type PasswordResetRow,
  type ResetCompleteError,
  type ResetLinkCheck,
  type ResetLinkProblem,
  type SendLinkOutcome,
} from '@/lib/password-reset';
import { clearPasswordExpiryReminders } from './password-policy';

const SALT_ROUNDS = 10;
const HOUR_MS = 60 * 60 * 1000;

/** 32 random bytes, base64url → always 43 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type FollowUp = () => Promise<void>;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Public origin for links in emails. NEXTAUTH_URL is the deployment's canonical URL. */
function appBaseUrl(fallbackOrigin?: string): string {
  const base = process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || fallbackOrigin || '';
  return base.replace(/\/+$/, '');
}

function storeLabel(storeNo: string | null, storeName: string | null): string {
  if (storeNo && storeName) return `${storeNo} · ${storeName}`;
  return storeName ?? storeNo ?? '-';
}

/** Optional IT inbox copy (comma-separated MAIL_IT_NOTIFY_TO). */
function itNotifyRecipients(): string[] {
  return (process.env.MAIL_IT_NOTIFY_TO ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && isValidEmail(s));
}

async function recordEmailResult(requestId: number, result: Awaited<ReturnType<typeof sendMail>>) {
  await db
    .update(passwordResetRequests)
    .set({ lastEmailError: result.success ? null : result.error.slice(0, 1000) })
    .where(eq(passwordResetRequests.id, requestId));
  if (!result.success) console.error(`[password-reset] email for request ${requestId} failed: ${result.error}`);
}

async function notifyIt(kind: 'requested' | 'completed', person: ResetEmailPerson & { email: string }, at: Date) {
  const to = itNotifyRecipients();
  if (to.length === 0) return;
  const result = await sendMail({ to, ...itNotifyEmail(kind, person, at, `${appBaseUrl()}/it/password-reset`) });
  if (!result.success) console.error(`[password-reset] IT notify email failed: ${result.error}`);
}

/** The request row + who it is for, by id or by token hash. */
function selectRequest() {
  return db
    .select({
      id: passwordResetRequests.id,
      userId: passwordResetRequests.userId,
      email: passwordResetRequests.email,
      status: passwordResetRequests.status,
      tokenExpiresAt: passwordResetRequests.tokenExpiresAt,
      failedAttempts: passwordResetRequests.failedAttempts,
      userNik: users.nik,
      userName: users.name,
      userActive: users.isActive,
      userDeletedAt: users.deletedAt,
      password: users.password,
      storeNo: stores.storeNo,
      storeName: stores.name,
    })
    .from(passwordResetRequests)
    .innerJoin(users, eq(users.id, passwordResetRequests.userId))
    .leftJoin(stores, eq(stores.id, passwordResetRequests.storeId));
}

// ─── 1. Request (public) ──────────────────────────────────────────────────────

export type SubmitResetResult =
  | { success: true; followUp: FollowUp | null }
  | { success: false; error: string; status: 400 };

export async function submitResetRequest(input: {
  nik: string;
  email: string;
  ip: string;
  userAgent: string | null;
}): Promise<SubmitResetResult> {
  const nik = input.nik.trim();
  const email = normalizeEmail(input.email);

  if (!nik || nik.length > 64) return { success: false, error: 'NIK wajib diisi.', status: 400 };
  if (!isValidEmail(email)) return { success: false, error: 'Format email toko tidak valid.', status: 400 };

  // NIK compared case-insensitively (people type it in lowercase on phones);
  // an exact match wins if two NIKs only differ in case.
  const candidates = await db
    .select({
      userId: users.id,
      nik: users.nik,
      name: users.name,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      storeId: stores.id,
      storeNo: stores.storeNo,
      storeName: stores.name,
      storeEmail: stores.email,
    })
    .from(users)
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .where(sql`lower(${users.nik}) = ${nik.toLowerCase()}`)
    .limit(5);
  const user = candidates.find((c) => c.nik === nik) ?? (candidates.length === 1 ? candidates[0] : undefined);

  const ignore = (why: string): SubmitResetResult => {
    console.info(`[password-reset] request for NIK ${nik} not accepted: ${why}`);
    return { success: true, followUp: null };
  };

  if (!user) return ignore('unknown NIK');
  if (!user.isActive || user.deletedAt) return ignore('account inactive');
  if (!user.storeId || !user.storeEmail) return ignore('no home store email on record');
  if (normalizeEmail(user.storeEmail) !== email) return ignore('store email does not match');

  // One open request per user: a second ask while IT is still on it (or while a
  // live link is out) adds nothing. Dead links (expired/locked) are closed here
  // so the new request is the only one IT acts on.
  const existing = await db
    .select({
      id: passwordResetRequests.id,
      status: passwordResetRequests.status,
      tokenExpiresAt: passwordResetRequests.tokenExpiresAt,
      failedAttempts: passwordResetRequests.failedAttempts,
    })
    .from(passwordResetRequests)
    .where(and(
      eq(passwordResetRequests.userId, user.userId),
      inArray(passwordResetRequests.status, ['pending', 'link_sent']),
    ));
  if (existing.some((r) => isOpenPasswordResetStatus(derivePasswordResetStatus(r)))) {
    return ignore('an open request already exists');
  }
  const now = new Date();
  if (existing.length > 0) {
    await db
      .update(passwordResetRequests)
      .set({ status: 'cancelled', tokenHash: null, rejectReason: 'Diganti permintaan baru', updatedAt: now })
      .where(inArray(passwordResetRequests.id, existing.map((r) => r.id)));
  }

  const [created] = await db
    .insert(passwordResetRequests)
    .values({
      userId: user.userId,
      nik: user.nik,
      storeId: user.storeId,
      email,
      status: 'pending',
      requestIp: input.ip,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      // Explicit, not defaultNow(): the DB session runs on Asia/Jakarta, so now()
      // into a timestamp-without-tz column reads back 7h off through Drizzle.
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: passwordResetRequests.id, createdAt: passwordResetRequests.createdAt });

  const person = { name: user.name, nik: user.nik, storeLabel: storeLabel(user.storeNo, user.storeName) };

  return {
    success: true,
    followUp: async () => {
      const result = await sendMail({ to: email, ...requestReceivedEmail(person, created.createdAt) });
      await recordEmailResult(created.id, result);
      await notifyIt('requested', { ...person, email }, created.createdAt);
    },
  };
}

// ─── 2. IT: list / send link / reject ─────────────────────────────────────────

const linkSender = alias(users, 'link_sender');
const rejecter = alias(users, 'rejecter');

/** Open requests (any age) plus the most recent closed ones. */
export async function listResetRequests(): Promise<{ rows: PasswordResetRow[]; counts: PasswordResetCounts }> {
  const base = () =>
    db
      .select({
        r: passwordResetRequests,
        name: users.name,
        userActive: users.isActive,
        storeNo: stores.storeNo,
        storeName: stores.name,
        linkSentByName: linkSender.name,
        rejectedByName: rejecter.name,
      })
      .from(passwordResetRequests)
      .innerJoin(users, eq(users.id, passwordResetRequests.userId))
      .leftJoin(stores, eq(stores.id, passwordResetRequests.storeId))
      .leftJoin(linkSender, eq(linkSender.id, passwordResetRequests.linkSentBy))
      .leftJoin(rejecter, eq(rejecter.id, passwordResetRequests.rejectedBy));

  const [open, closed] = await Promise.all([
    base()
      .where(inArray(passwordResetRequests.status, ['pending', 'link_sent']))
      .orderBy(desc(passwordResetRequests.createdAt)),
    base()
      .where(notInArray(passwordResetRequests.status, ['pending', 'link_sent']))
      .orderBy(desc(passwordResetRequests.updatedAt))
      .limit(300),
  ]);

  const now = new Date();
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const rows: PasswordResetRow[] = [...open, ...closed].map(({ r, ...x }) => ({
    id: r.id,
    status: derivePasswordResetStatus(r, now),
    userId: r.userId,
    name: x.name,
    nik: r.nik,
    userActive: x.userActive,
    storeNo: x.storeNo,
    storeName: x.storeName,
    email: r.email,
    requestIp: r.requestIp,
    createdAt: r.createdAt.toISOString(),
    linkSentAt: iso(r.linkSentAt),
    linkSentByName: x.linkSentByName,
    tokenExpiresAt: iso(r.tokenExpiresAt),
    failedAttempts: r.failedAttempts,
    completedAt: iso(r.completedAt),
    rejectedAt: iso(r.rejectedAt),
    rejectedByName: x.rejectedByName,
    rejectReason: r.rejectReason,
    lastEmailError: r.lastEmailError,
  }));

  const since30d = now.getTime() - 30 * 24 * HOUR_MS;
  const counts: PasswordResetCounts = {
    pending: rows.filter((r) => r.status === 'pending').length,
    linkSent: rows.filter((r) => r.status === 'link_sent').length,
    completed30d: rows.filter((r) => r.status === 'completed' && r.completedAt && Date.parse(r.completedAt) >= since30d).length,
    stuck: rows.filter((r) => r.status === 'expired' || r.status === 'locked').length,
  };

  return { rows, counts };
}

/** Sidebar badge: requests waiting for IT to act. */
export async function countRequestsNeedingIt(): Promise<number> {
  const rows = await db
    .select({
      status: passwordResetRequests.status,
      tokenExpiresAt: passwordResetRequests.tokenExpiresAt,
      failedAttempts: passwordResetRequests.failedAttempts,
    })
    .from(passwordResetRequests)
    .where(inArray(passwordResetRequests.status, ['pending', 'link_sent']));
  return rows.filter((r) => derivePasswordResetStatus(r) !== 'link_sent').length;
}

type ItResult<T> = { success: true; data: T } | { success: false; error: string; status: 404 | 409 };

export async function sendResetLink(input: {
  requestId: number;
  actorId: string;
  fallbackOrigin: string;
}): Promise<ItResult<SendLinkOutcome>> {
  const [req] = await selectRequest().where(eq(passwordResetRequests.id, input.requestId)).limit(1);
  if (!req) return { success: false, error: 'Permintaan tidak ditemukan.', status: 404 };

  if (req.status !== 'pending' && req.status !== 'link_sent') {
    return { success: false, error: 'Permintaan ini sudah ditutup.', status: 409 };
  }
  if (!req.userActive || req.userDeletedAt) {
    return { success: false, error: 'Akun ini sudah tidak aktif — tolak permintaannya.', status: 409 };
  }

  const now = new Date();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + RESET_LINK_TTL_HOURS * HOUR_MS);

  // Only one usable link per user.
  await db
    .update(passwordResetRequests)
    .set({ status: 'cancelled', tokenHash: null, rejectReason: 'Digantikan link baru', updatedAt: now })
    .where(and(
      eq(passwordResetRequests.userId, req.userId),
      eq(passwordResetRequests.status, 'link_sent'),
      ne(passwordResetRequests.id, req.id),
    ));

  const [claimed] = await db
    .update(passwordResetRequests)
    .set({
      status: 'link_sent',
      tokenHash: hashToken(token),
      tokenExpiresAt: expiresAt,
      linkSentAt: now,
      linkSentBy: input.actorId,
      failedAttempts: 0,
      updatedAt: now,
    })
    .where(and(
      eq(passwordResetRequests.id, req.id),
      inArray(passwordResetRequests.status, ['pending', 'link_sent']),
    ))
    .returning({ id: passwordResetRequests.id });
  if (!claimed) return { success: false, error: 'Permintaan ini baru saja diubah. Muat ulang halaman.', status: 409 };

  const link = `${appBaseUrl(input.fallbackOrigin)}/reset-password/${token}`;
  const person = { name: req.userName, nik: req.userNik, storeLabel: storeLabel(req.storeNo, req.storeName) };
  const result = await sendMail({ to: req.email, ...resetLinkEmail(person, link, expiresAt) });
  await recordEmailResult(req.id, result);

  const delivered = result.success && result.mode === 'graph';
  return {
    success: true,
    data: {
      email: req.email,
      expiresAt: expiresAt.toISOString(),
      mode: result.success ? result.mode : null,
      emailError: result.success ? null : result.error,
      link: delivered ? null : link,
    },
  };
}

export async function rejectResetRequest(input: {
  requestId: number;
  actorId: string;
  reason: string;
}): Promise<ItResult<{ followUp: FollowUp }>> {
  const reason = input.reason.trim().slice(0, RESET_REJECT_REASON_MAX) || null;
  const [req] = await selectRequest().where(eq(passwordResetRequests.id, input.requestId)).limit(1);
  if (!req) return { success: false, error: 'Permintaan tidak ditemukan.', status: 404 };

  const now = new Date();
  const [updated] = await db
    .update(passwordResetRequests)
    .set({
      status: 'rejected',
      tokenHash: null,
      rejectedAt: now,
      rejectedBy: input.actorId,
      rejectReason: reason,
      updatedAt: now,
    })
    .where(and(
      eq(passwordResetRequests.id, req.id),
      inArray(passwordResetRequests.status, ['pending', 'link_sent']),
    ))
    .returning({ id: passwordResetRequests.id });
  if (!updated) return { success: false, error: 'Permintaan ini sudah ditutup.', status: 409 };

  const person = { name: req.userName, nik: req.userNik, storeLabel: storeLabel(req.storeNo, req.storeName) };
  return {
    success: true,
    data: {
      followUp: async () => {
        const result = await sendMail({ to: req.email, ...requestRejectedEmail(person, reason) });
        await recordEmailResult(req.id, result);
      },
    },
  };
}

// ─── 3. The link (public) ─────────────────────────────────────────────────────

type LinkRow = Awaited<ReturnType<ReturnType<typeof selectRequest>['limit']>>[number];

async function findByToken(token: string): Promise<LinkRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await selectRequest().where(eq(passwordResetRequests.tokenHash, hashToken(token))).limit(1);
  return row ?? null;
}

/** Why this link can't be used, or null when it can. */
function linkProblem(row: LinkRow | null): ResetLinkProblem | null {
  if (!row || row.userDeletedAt || !row.userActive) return 'invalid';
  const status = derivePasswordResetStatus(row);
  if (status === 'completed') return 'used';
  if (status === 'expired') return 'expired';
  if (status === 'locked') return 'locked';
  if (status !== 'link_sent') return 'invalid';
  return null;
}

export async function checkResetLink(token: string): Promise<ResetLinkCheck> {
  const row = await findByToken(token);
  const problem = linkProblem(row);
  if (problem || !row?.tokenExpiresAt) return { success: true, state: problem ?? 'invalid' };
  return { success: true, state: 'valid', expiresAt: row.tokenExpiresAt.toISOString() };
}

const PROBLEM_MESSAGE: Record<ResetLinkProblem, string> = {
  invalid: 'Link tidak valid. Ajukan reset password baru dari halaman masuk.',
  expired: 'Link sudah kedaluwarsa. Ajukan reset password baru.',
  used: 'Link ini sudah digunakan. Silakan masuk dengan password baru Anda.',
  locked: 'Link dinonaktifkan karena terlalu banyak percobaan NIK yang salah. Minta IT mengirim link baru.',
};

export type CompleteResetResult =
  | { success: true; followUp: FollowUp }
  | { success: false; status: number; error: string; detail: ResetCompleteError };

export async function completeReset(input: {
  token: string;
  nik: string;
  password: string;
  confirmPassword: string;
  ip: string;
}): Promise<CompleteResetResult> {
  const row = await findByToken(input.token);
  const problem = linkProblem(row);
  if (problem || !row) {
    const code = problem ?? 'invalid';
    return { success: false, status: code === 'invalid' ? 404 : 410, error: PROBLEM_MESSAGE[code], detail: { code } };
  }

  if (!input.nik.trim()) {
    return { success: false, status: 400, error: 'NIK wajib diisi.', detail: { code: 'BAD_REQUEST' } };
  }

  // The link belongs to one NIK. Anyone else gets told so, and it costs an attempt.
  if (!sameNik(input.nik, row.userNik)) {
    const [bumped] = await db
      .update(passwordResetRequests)
      .set({ failedAttempts: sql`${passwordResetRequests.failedAttempts} + 1`, updatedAt: new Date() })
      .where(and(eq(passwordResetRequests.id, row.id), eq(passwordResetRequests.status, 'link_sent')))
      .returning({ failedAttempts: passwordResetRequests.failedAttempts });
    const attemptsLeft = Math.max(0, RESET_MAX_NIK_ATTEMPTS - (bumped?.failedAttempts ?? RESET_MAX_NIK_ATTEMPTS));
    console.warn(`[password-reset] wrong NIK on link of request ${row.id} from ${input.ip} (${attemptsLeft} left)`);
    if (attemptsLeft === 0) {
      return { success: false, status: 423, error: PROBLEM_MESSAGE.locked, detail: { code: 'locked' } };
    }
    return {
      success: false,
      status: 403,
      error: NIK_MISMATCH_MESSAGE,
      detail: { code: 'NIK_MISMATCH', attemptsLeft },
    };
  }

  const pwError = resetPasswordError(input.password, input.confirmPassword, row.userNik);
  const policy = validateNewPassword(input.password, { nik: row.userNik });
  if (pwError || !policy.ok) {
    return {
      success: false,
      status: 400,
      error: pwError ?? 'Password tidak memenuhi syarat.',
      detail: { code: 'PASSWORD' },
    };
  }
  if (await bcrypt.compare(input.password, row.password)) {
    return {
      success: false,
      status: 400,
      error: 'Password baru tidak boleh sama dengan password lama.',
      detail: { code: 'SAME_PASSWORD' },
    };
  }

  // Claim the link first (single use, even with two tabs racing), then set the password.
  const now = new Date();
  const [claimed] = await db
    .update(passwordResetRequests)
    .set({ status: 'completed', completedAt: now, completedIp: input.ip, lastEmailError: null, updatedAt: now })
    .where(and(
      eq(passwordResetRequests.id, row.id),
      eq(passwordResetRequests.status, 'link_sent'),
      gt(passwordResetRequests.tokenExpiresAt, now),
      lt(passwordResetRequests.failedAttempts, RESET_MAX_NIK_ATTEMPTS),
    ))
    .returning({ id: passwordResetRequests.id });
  if (!claimed) {
    return { success: false, status: 410, error: PROBLEM_MESSAGE.used, detail: { code: 'used' } };
  }

  try {
    const hashed = await bcrypt.hash(input.password, SALT_ROUNDS);
    await db
      .update(users)
      .set({ password: hashed, passwordChangedAt: now, updatedAt: now })
      .where(eq(users.id, row.userId));
  } catch (err) {
    // Give the link back so the user can try again.
    await db
      .update(passwordResetRequests)
      .set({ status: 'link_sent', completedAt: null, completedIp: null, updatedAt: new Date() })
      .where(eq(passwordResetRequests.id, row.id));
    throw err;
  }

  await clearPasswordExpiryReminders(row.userId);
  clearLoginFailures(row.userNik, input.ip);

  const person = { name: row.userName, nik: row.userNik, storeLabel: storeLabel(row.storeNo, row.storeName) };
  return {
    success: true,
    followUp: async () => {
      const result = await sendMail({ to: row.email, ...resetCompletedEmail(person, now) });
      await recordEmailResult(row.id, result);
      await notifyIt('completed', { ...person, email: row.email }, now);
    },
  };
}

// lib/password-reset.ts
//
// Pure "Lupa password" rules shared by the forms, the IT page and the server
// (lib/db/utils/password-reset.ts). No DB, no Node APIs.

import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '@/lib/auth/password';
import type { PasswordResetStoredStatus } from '@/lib/db/schema/password-reset';

/** How long an emailed link stays usable. */
export const RESET_LINK_TTL_HOURS = 24;

/** Wrong-NIK attempts before a link stops working (IT has to send a new one). */
export const RESET_MAX_NIK_ATTEMPTS = 5;

export const RESET_REJECT_REASON_MAX = 300;

/** What the user / IT sees. `expired` and `locked` are derived from a link_sent row. */
export type PasswordResetStatus = PasswordResetStoredStatus | 'expired' | 'locked';

export function derivePasswordResetStatus(
  row: { status: PasswordResetStoredStatus; tokenExpiresAt: Date | string | null; failedAttempts: number },
  now: Date = new Date(),
): PasswordResetStatus {
  if (row.status !== 'link_sent') return row.status;
  if (row.failedAttempts >= RESET_MAX_NIK_ATTEMPTS) return 'locked';
  if (!row.tokenExpiresAt || new Date(row.tokenExpiresAt).getTime() <= now.getTime()) return 'expired';
  return 'link_sent';
}

export const PASSWORD_RESET_STATUS_LABEL: Record<PasswordResetStatus, string> = {
  pending: 'Menunggu verifikasi',
  link_sent: 'Link terkirim',
  expired: 'Link kedaluwarsa',
  locked: 'Link terkunci',
  completed: 'Berhasil',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
};

/** Window event the IT page fires after an action, so the sidebar badge refreshes at once. */
export const PASSWORD_RESET_CHANGED_EVENT = 'it:password-reset-changed';

/** Still waiting on IT or on the user — at most one per user. */
export function isOpenPasswordResetStatus(status: PasswordResetStatus): boolean {
  return status === 'pending' || status === 'link_sent';
}

/** One request as the IT page lists it (GET /api/it/password-reset). */
export interface PasswordResetRow {
  id: number;
  status: PasswordResetStatus;
  userId: string;
  name: string;
  /** NIK as it was when the request came in. */
  nik: string;
  userActive: boolean;
  storeNo: string | null;
  storeName: string | null;
  /** Store mailbox every email for this request goes to. */
  email: string;
  requestIp: string | null;
  createdAt: string;
  linkSentAt: string | null;
  linkSentByName: string | null;
  tokenExpiresAt: string | null;
  failedAttempts: number;
  completedAt: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectReason: string | null;
  lastEmailError: string | null;
}

export interface PasswordResetCounts {
  pending: number;
  linkSent: number;
  /** Completed in the last 30 days. */
  completed30d: number;
  /** Links that expired / got locked and still need IT (resend or reject). */
  stuck: number;
}

/** POST /api/it/password-reset/:id { action: 'send_link' } — what happened to the email. */
export interface SendLinkOutcome {
  email: string;
  expiresAt: string;
  /** 'graph' = delivered to Microsoft 365; 'console' = dev mode, printed on the server. */
  mode: 'graph' | 'console' | null;
  emailError: string | null;
  /** Only when the email didn't really go out — so IT can pass the link on by hand. */
  link: string | null;
}

/** The NIK check on the reset page. Case and surrounding spaces don't matter. */
export function sameNik(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * "A11040401" → "A1•••••01". The link email goes to a mailbox the whole store
 * reads: enough for the right person to recognise it, without handing the NIK
 * (the second half of the check on the reset page) to everyone else.
 */
export function maskNik(nik: string): string {
  const s = nik.trim();
  if (s.length <= 4) return `${'•'.repeat(Math.max(0, s.length - 1))}${s.slice(-1)}`;
  return `${s.slice(0, 2)}${'•'.repeat(s.length - 4)}${s.slice(-2)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

// ─── New password ────────────────────────────────────────────────────────────
// The same policy as lib/auth/password.ts (validateNewPassword), worded in
// Indonesian for the store-staff page. The server runs both.

export interface ResetPasswordChecks {
  minLength: boolean;
  notTooLong: boolean;
  notNik: boolean;
  matches: boolean;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function resetPasswordChecks(password: string, confirm: string, nik: string): ResetPasswordChecks {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    notTooLong: utf8Bytes(password) <= PASSWORD_MAX_BYTES,
    notNik: !nik.trim() || !password || password.trim().toLowerCase() !== nik.trim().toLowerCase(),
    matches: password.length > 0 && password === confirm,
  };
}

/** First failing rule as an Indonesian sentence, or null when the password is acceptable. */
export function resetPasswordError(password: string, confirm: string, nik: string): string | null {
  const c = resetPasswordChecks(password, confirm, nik);
  if (!password) return 'Password baru wajib diisi.';
  if (!c.minLength) return `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`;
  if (!c.notTooLong) return 'Password terlalu panjang.';
  if (!c.notNik) return 'Password tidak boleh sama dengan NIK.';
  if (!confirm) return 'Konfirmasi password wajib diisi.';
  if (!c.matches) return 'Konfirmasi password tidak cocok.';
  return null;
}

// ─── API contract (public endpoints) ─────────────────────────────────────────

/** Why a link can't be used — drives the reset page's error screens. */
export type ResetLinkProblem = 'invalid' | 'expired' | 'used' | 'locked';

export type ResetLinkCheck =
  | { success: true; state: 'valid'; expiresAt: string }
  | { success: true; state: ResetLinkProblem };

export type ResetCompleteError =
  | { code: 'NIK_MISMATCH'; attemptsLeft: number }
  | { code: ResetLinkProblem }
  | { code: 'PASSWORD' | 'SAME_PASSWORD' | 'ACCOUNT' | 'RATE_LIMIT' | 'BAD_REQUEST' };

/** The exact sentence the reset page shows when someone else's NIK is typed. */
export const NIK_MISMATCH_MESSAGE = 'Link ini bukan untuk NIK Anda.';

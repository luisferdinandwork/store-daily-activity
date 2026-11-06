// lib/db/utils/petty-cash-refill.ts
//
// PIC-initiated "top me back up" requests — distinct from Finance's own
// month-end close-and-reset (pettyCashRefills in lib/db/schema/petty-cash.ts).
//
// Flow (period rules: lib/petty-cash-period.ts):
//
//   1. PIC 1 sends the refill for the period in use (due before the 15th of its month — later still works, it is
//      just flagged Terlambat). The period is CLOSED right there: what was used is fixed, and the next period opens
//      at once, so new requests keep flowing — they are filed under the next period. Requests that were still
//      waiting (OPS / confirmation) move to it too.
//   2. OPS approves / rejects the request. Approval alone does NOT move the balance — the store hasn't received the
//      cash yet. A rejected refill leaves the period closed: PIC 1 sends a corrected one for the same period.
//   3. Finance sends the cash and verifies the refill on its Petty Cash pages (financeVerifiedAt; PIC 1 can't
//      confirm receipt before this). Verifying freezes the amount (transferAmount).
//   4. PIC 1 uploads two proof-of-receipt photos (the petty cash drawer and the Surat Terima Petty Cash). Once BOTH
//      are in the refill is received (balanceAfter set) — the real "the store now has the money" moment. The next
//      period was opened at step 1 and already carries whatever was spent meanwhile, so nothing is reset.
//
// The balance PIC 1 sees does NOT jump back to Rp 1.000.000 at step 1: the cash is still on its way. Until step 4
// the spendable balance is the period's balance minus the refill not received yet (getRefillOutstanding), so the
// store keeps working with what is really in the cash box and the balance "turns back" only on receipt.
//
// `pettyCashRefillRequests.yearMonth` is the PERIOD the refill settles (the month that was closed), not the
// calendar month it was filed in; `requestedAt` says when.

import { db } from '@/lib/db';
import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import {
  pettyCashPeriods,
  pettyCashRefillRequests,
  stores,
  users,
  type PettyCashRefillRequest,
} from '@/lib/db/schema';
import { PETTY_CASH_MAX_BALANCE } from '@/lib/db/schema/petty-cash';
import { jakartaTodayKey, jakartaYearMonth } from '@/lib/day-bucket';
import { createNotificationsForUsers, getOpsUserIdsForArea } from './notifications';
import { getRefillRowsByIds } from './petty-cash-ops';
import { rejectedNote, type RefillTransfer } from '@/lib/petty-cash-review';
import { closePeriodAndOpenNext, getActivePeriod, getPeriod, type DbExecutor } from './petty-cash-period';
import { addMonths, deadlineStatus, isRefillLate, periodLabel, type DeadlineStatus } from '@/lib/petty-cash-period';
import type { BankDetails } from '@/lib/petty-cash-bank';

/**
 * PIC 1 is the store's petty cash holder: only they request usage, confirm
 * the actual amount spent, upload receipts, request a refill and upload its
 * proof photos. Everyone else at the store (PIC 2, SA) can only view.
 */
export function isPettyCashHolder(empType: unknown): boolean {
  return empType === 'pic_1';
}

export function currentYearMonthJakarta(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

async function notifyOps(storeId: number, input: { type: string; title: string; body: string }) {
  const [storeRow] = await db
    .select({ areaId: stores.areaId, name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  const opsUserIds = await getOpsUserIdsForArea(storeRow?.areaId ?? null);
  await createNotificationsForUsers(opsUserIds, { ...input, link: '/ops/petty-cash/refills' });
}

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * A refill that is still on its way: waiting on OPS, or approved and the store has not confirmed receiving the cash
 * (both proof photos) yet. A store has at most one at a time — the next refill can only be sent once this one has
 * landed (or was rejected).
 */
export async function getLiveRefillRequest(
  storeId: number,
  exec: DbExecutor = db,
): Promise<PettyCashRefillRequest | null> {
  const [row] = await exec
    .select()
    .from(pettyCashRefillRequests)
    .where(
      and(
        eq(pettyCashRefillRequests.storeId, storeId),
        or(
          eq(pettyCashRefillRequests.status, 'pending'),
          and(eq(pettyCashRefillRequests.status, 'approved'), isNull(pettyCashRefillRequests.balanceAfter)),
        ),
      ),
    )
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(1);

  return row ?? null;
}

/** The store's most recent refill request, whatever month or state. */
export async function getLatestRefillRequest(
  storeId: number,
  exec: DbExecutor = db,
): Promise<PettyCashRefillRequest | null> {
  const [row] = await exec
    .select()
    .from(pettyCashRefillRequests)
    .where(eq(pettyCashRefillRequests.storeId, storeId))
    .orderBy(desc(pettyCashRefillRequests.requestedAt), desc(pettyCashRefillRequests.id))
    .limit(1);

  return row ?? null;
}

/**
 * The period a refill sent now would settle: the one in use — unless the store's latest refill was rejected by OPS
 * for a period that is already closed, in which case that period still has to be settled (its usage is fixed,
 * PIC 1 sends a corrected request for it).
 */
async function resolveSettlePeriod(
  storeId: number,
  latest: PettyCashRefillRequest | null,
  exec: DbExecutor = db,
) {
  if (latest?.status === 'rejected') {
    const period = await getPeriod(storeId, latest.yearMonth, exec);
    if (period?.status === 'closed') return period;
  }
  return getActivePeriod(storeId, jakartaYearMonth(Date.now()));
}

/**
 * Cash the store has been promised but does not have yet: the Refill of the period just BEFORE `periodMonth`, for as
 * long as it is on its way (waiting on OPS, approved, waiting for Finance, or turned down and not sent again) — it
 * counts as received only once PIC 1 has both proof photos in (balanceAfter).
 *
 * Sending a Refill opens the next period at the full Rp 1.000.000 on paper so requests can carry on, but that money
 * is not in the cash box until it arrives. What PIC 1 can actually spend is therefore the period's balance MINUS
 * this amount — the balance only "turns back" to Rp 1.000.000 (less what was spent meanwhile) when the Refill is
 * received. It is the frozen transfer once Finance verified, else what the closed period still needs (max − balance).
 */
export async function getRefillOutstanding(
  storeId: number,
  periodMonth: string,
  exec: DbExecutor = db,
): Promise<number> {
  const prev = addMonths(periodMonth, -1);

  const [request] = await exec
    .select()
    .from(pettyCashRefillRequests)
    .where(and(eq(pettyCashRefillRequests.storeId, storeId), eq(pettyCashRefillRequests.yearMonth, prev)))
    .orderBy(desc(pettyCashRefillRequests.requestedAt), desc(pettyCashRefillRequests.id))
    .limit(1);

  if (!request || request.balanceAfter) return 0;
  if (request.transferAmount != null) return Math.max(0, Math.round(Number(request.transferAmount)));

  const closed = await getPeriod(storeId, prev, exec);
  const left = closed ? Number(closed.currentBalance) : Number(request.balanceBefore ?? PETTY_CASH_MAX_BALANCE);
  return Math.max(0, Math.round(PETTY_CASH_MAX_BALANCE - left));
}

export type RefillRequestResult =
  | {
      success: true;
      request: PettyCashRefillRequest;
      /** The period the refill settles, the one new requests now go to, and whether it was past the 15th. */
      periodMonth?: string;
      nextMonth?: string;
      late?: boolean;
      /** Requests that were still waiting and moved to the next period. */
      moved?: number;
    }
  | { success: false; error: string };

/** What the Refill tab shows PIC 1 (and what decides whether the button is there). */
export interface RefillOverview {
  /** The refill on its way, else the latest one (any state); null = the store never sent one. */
  request: PettyCashRefillRequest | null;
  /** The period new requests are filed under right now. */
  usageMonth: string;
  /** What a refill sent now would cover; null while another refill is on its way. */
  settle: { month: string; balance: number; refill: number; closed: boolean } | null;
  /** Where that refill stands against the 15th. */
  deadline: DeadlineStatus | null;
  canRequest: boolean;
  /** Why not, when `canRequest` is false and no refill is on its way. */
  blockedReason: string | null;
}

type SendOutcome =
  | { ok: false; error: string }
  | { ok: true; request: PettyCashRefillRequest; period: string; next: string; moved: number };

const NOTHING_USED = (month: string) =>
  `Belum ada pemakaian di periode ${periodLabel(month)}, jadi belum ada yang perlu di-Refill.`;

export async function getRefillOverview(storeId: number): Promise<RefillOverview> {
  const usage = await getActivePeriod(storeId, jakartaYearMonth(Date.now()));
  const live = await getLiveRefillRequest(storeId);

  if (live) {
    return {
      request: live,
      usageMonth: usage.yearMonth,
      settle: null,
      deadline: null,
      canRequest: false,
      blockedReason: 'Refill sebelumnya masih diproses.',
    };
  }

  const latest = await getLatestRefillRequest(storeId);
  const settle = await resolveSettlePeriod(storeId, latest);
  const balance = Number(settle.currentBalance);
  const refill = Math.max(0, PETTY_CASH_MAX_BALANCE - balance);

  return {
    request: latest,
    usageMonth: usage.yearMonth,
    settle: { month: settle.yearMonth, balance, refill, closed: settle.status === 'closed' },
    deadline: deadlineStatus(settle.yearMonth, jakartaTodayKey()),
    canRequest: refill > 0,
    blockedReason: refill > 0 ? null : NOTHING_USED(settle.yearMonth),
  };
}

/**
 * The account this PIC used on their most recent refill request — pre-fills
 * the form so they don't retype it every month (they can still change it).
 */
export async function getLastBankDetails(userId: string): Promise<BankDetails | null> {
  const [row] = await db
    .select({
      bankName: pettyCashRefillRequests.bankName,
      accountNumber: pettyCashRefillRequests.accountNumber,
      accountHolderName: pettyCashRefillRequests.accountHolderName,
    })
    .from(pettyCashRefillRequests)
    .where(and(eq(pettyCashRefillRequests.requestedBy, userId), isNotNull(pettyCashRefillRequests.accountNumber)))
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(1);

  if (!row?.bankName || !row.accountNumber || !row.accountHolderName) return null;
  return { bankName: row.bankName, accountNumber: row.accountNumber, accountHolderName: row.accountHolderName };
}

/**
 * PIC 1 sends the refill for the period in use. It must say where Finance should send the cash, so `bank` is
 * required (already validated/normalised by normalizeBankDetails in the route).
 *
 * In one transaction: the period is closed, the next one opens, requests still waiting move to it, and the refill
 * request is recorded against the period it settles (balanceBefore = what that period had left).
 */
export async function createRefillRequest(
  storeId: number,
  userId: string,
  bank: BankDetails,
  notes?: string,
): Promise<RefillRequestResult> {
  const today = jakartaTodayKey();

  const outcome = await db.transaction(async (trx): Promise<SendOutcome> => {
    if (await getLiveRefillRequest(storeId, trx)) {
      return { ok: false, error: 'Refill sebelumnya masih diproses. Refill berikutnya bisa diajukan setelah uangnya diterima toko.' };
    }

    const latest = await getLatestRefillRequest(storeId, trx);
    const settle = await resolveSettlePeriod(storeId, latest, trx);

    // Serialise two taps on "Kirim": the second waits here, then sees the first one's request below.
    await trx.select({ id: pettyCashPeriods.id }).from(pettyCashPeriods).where(eq(pettyCashPeriods.id, settle.id)).for('update');
    if (await getLiveRefillRequest(storeId, trx)) {
      return { ok: false, error: 'Refill sudah diajukan.' };
    }

    const fresh = (await getPeriod(storeId, settle.yearMonth, trx)) ?? settle;
    const balance = Number(fresh.currentBalance);
    if (PETTY_CASH_MAX_BALANCE - balance <= 0) return { ok: false, error: NOTHING_USED(fresh.yearMonth) };

    // Sending the refill closes the period (a retry for an already-closed one leaves it as it is) and opens the next.
    const closing = await closePeriodAndOpenNext(storeId, fresh.yearMonth, userId, trx);

    const [request] = await trx
      .insert(pettyCashRefillRequests)
      .values({
        storeId,
        yearMonth: fresh.yearMonth,
        requestedBy: userId,
        notes,
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        accountHolderName: bank.accountHolderName,
        balanceBefore: fresh.currentBalance,
        // Explicit app-clock timestamp — see the same fix/comment in
        // app/api/employee/petty-cash/route.ts for why DEFAULT NOW() is wrong here.
        requestedAt: new Date(),
      })
      .returning();

    return { ok: true, request, period: fresh.yearMonth, next: closing.next.yearMonth, moved: closing.moved };
  });

  if (!outcome.ok) return { success: false, error: outcome.error };

  const late = isRefillLate(outcome.period, today);
  const [storeRow] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1);
  await notifyOps(storeId, {
    type: 'petty_cash_refill_requested',
    title: `Petty cash refill requested — ${storeRow?.name ?? `Store ${storeId}`}`,
    body:
      `For period ${periodLabel(outcome.period)}${late ? ' — sent AFTER the 15th (late)' : ''}. ` +
      `Transfer to ${bank.bankName} ${bank.accountNumber} a.n. ${bank.accountHolderName}.${notes ? ` Note: ${notes}` : ''}`,
  });

  return {
    success: true,
    request: outcome.request,
    periodMonth: outcome.period,
    nextMonth: outcome.next,
    late,
    moved: outcome.moved,
  };
}

/**
 * OPS approves — this only marks the request approved and snapshots the
 * balance of the period it settles at the time of approval. It does NOT touch
 * any balance: the store hasn't received the cash yet (Finance still needs to
 * physically hand it over), so the dashboard shouldn't show it as available
 * yet either. The refill only counts as received once proof photos are in
 * (see attachRefillProof below).
 */
export async function approveRefillRequest(id: number, actorUserId: string): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.status !== 'pending') return { success: false, error: 'Request has already been processed.' };

  // The period was closed when the refill was sent — it is the usage that is being paid for.
  const period = await getPeriod(existing.storeId, existing.yearMonth);

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({
      status: 'approved',
      approvedBy: actorUserId,
      approvedAt: new Date(),
      balanceBefore: period?.currentBalance ?? existing.balanceBefore,
    })
    .where(and(eq(pettyCashRefillRequests.id, id), eq(pettyCashRefillRequests.status, 'pending')))
    .returning();

  if (!request) {
    return { success: false, error: 'Approval failed. Request may already be processed.' };
  }

  return { success: true, request };
}

export async function rejectRefillRequest(
  id: number,
  actorUserId: string,
  reason?: string,
): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.status !== 'pending') return { success: false, error: 'Request has already been processed.' };

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({ status: 'rejected', rejectedBy: actorUserId, rejectedAt: new Date(), rejectionReason: reason })
    .where(and(eq(pettyCashRefillRequests.id, id), eq(pettyCashRefillRequests.status, 'pending')))
    .returning();

  if (!request) return { success: false, error: 'Reject failed. Please refresh and try again.' };

  return { success: true, request };
}

export interface RefillVerifyResult {
  /** Ids that actually changed. */
  changedIds: number[];
  /** Ids left alone (already in that state, wrong status, or proof already uploaded). */
  skipped: number;
}

/**
 * Finance verifies that it has refilled the store for an OPS-approved request.
 * This is what unlocks PIC 1's "receive" step (proof photos) on the employee
 * page — see attachRefillProof. The status guard lives in the UPDATE itself, so
 * two Finance users racing can't both claim the same request. PIC 1 is
 * notified for each one that actually changed.
 */
export async function verifyRefillRequests(ids: number[], actorUserId: string): Promise<RefillVerifyResult> {
  if (ids.length === 0) return { changedIds: [], skipped: 0 };
  const now = new Date();

  const rows = await db
    .update(pettyCashRefillRequests)
    .set({ financeVerifiedBy: actorUserId, financeVerifiedAt: now })
    .where(
      and(
        inArray(pettyCashRefillRequests.id, ids),
        eq(pettyCashRefillRequests.status, 'approved'),
        isNull(pettyCashRefillRequests.financeVerifiedAt),
      ),
    )
    .returning({
      id: pettyCashRefillRequests.id,
      storeId: pettyCashRefillRequests.storeId,
      requestedBy: pettyCashRefillRequests.requestedBy,
    });

  // Verifying locks the amount (reviews stop at this moment — see lib/petty-cash-review.ts), so
  // what Finance sends is worked out now and frozen on the request: what the store used minus
  // the requests Finance rejected.
  const figures = new Map((await getRefillRowsByIds(rows.map((r) => r.id))).map((f) => [f.id, f.transfer]));
  await Promise.all(
    rows.map(async (r) => {
      const t = figures.get(r.id);
      if (t) {
        await db
          .update(pettyCashRefillRequests)
          .set({
            transferAmount: String(t.transfer),
            rejectedCount: t.rejectedCount,
            rejectedAmount: String(t.rejectedAmount),
          })
          .where(eq(pettyCashRefillRequests.id, r.id));
      }

      const rejected = t ? rejectedNote(t.rejectedCount, t.rejectedAmount) : null;
      await createNotificationsForUsers([r.requestedBy], {
        type: 'petty_cash_refill_verified',
        title: 'Refill petty cash sudah diproses Finance',
        body:
          'Finance sudah memverifikasi Refill toko kamu' +
          (t ? `: ${rp(t.transfer)} ditransfer.` : '.') +
          (rejected ? ` ${rejected}. Yang Perlu Perbaikan bisa diajukan ulang lewat Re-request di halaman Petty Cash (masuk periode berikutnya).` : '') +
          ' Setelah uangnya diterima, unggah foto laci petty cash dan Surat Terima.',
        link: '/employee/pettycash',
        relatedType: 'petty_cash_refill_request',
        relatedId: r.id,
      });
    }),
  );

  return { changedIds: rows.map((r) => r.id), skipped: ids.length - rows.length };
}

/**
 * Finance takes a verification back (a mis-click, or the transfer bounced).
 * Only allowed while PIC 1 hasn't uploaded any proof photo — once they've
 * started confirming receipt the cash is already in their hands.
 */
export async function unverifyRefillRequests(ids: number[]): Promise<RefillVerifyResult> {
  if (ids.length === 0) return { changedIds: [], skipped: 0 };

  const rows = await db
    .update(pettyCashRefillRequests)
    .set({ financeVerifiedBy: null, financeVerifiedAt: null, transferAmount: null, rejectedCount: 0, rejectedAmount: null })
    .where(
      and(
        inArray(pettyCashRefillRequests.id, ids),
        eq(pettyCashRefillRequests.status, 'approved'),
        isNotNull(pettyCashRefillRequests.financeVerifiedAt),
        isNull(pettyCashRefillRequests.drawerPhotoUrl),
        isNull(pettyCashRefillRequests.signaturePhotoUrl),
      ),
    )
    .returning({ id: pettyCashRefillRequests.id });

  return { changedIds: rows.map((r) => r.id), skipped: ids.length - rows.length };
}

export type ProofPhotoKind = 'drawer' | 'signature';

/**
 * Any store employee attaches one of the two proof photos once OPS has
 * approved. Once BOTH the drawer photo and the Surat Terima Petty Cash photo
 * are in, this is the moment the cash is considered actually received: the
 * refill is marked received (balanceAfter) — right here, not at approval time.
 *
 * The next period was already opened when the refill was sent and carries whatever the store spent since, so
 * receiving never resets a balance. (closePeriodAndOpenNext only makes sure of it for a refill sent before
 * periods closed at that moment — a no-op for every other.)
 */
export async function attachRefillProof(
  id: number,
  storeId: number,
  userId: string,
  kind: ProofPhotoKind,
  imageUrl: string,
): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.storeId !== storeId) return { success: false, error: 'This request belongs to a different store.' };
  if (existing.status !== 'approved') {
    return { success: false, error: 'Proof photos can only be uploaded after OPS approves the refill.' };
  }
  // The store can only confirm receiving cash Finance has actually sent.
  if (!existing.financeVerifiedAt) {
    return {
      success: false,
      error: 'Finance belum memverifikasi Refill ini. Foto bukti bisa diunggah setelah Finance memprosesnya.',
    };
  }

  const columnKey = kind === 'drawer' ? 'drawerPhotoUrl' : 'signaturePhotoUrl';

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({
      [columnKey]: imageUrl,
      proofUploadedBy: userId,
      proofUploadedAt: new Date(),
    })
    .where(eq(pettyCashRefillRequests.id, id))
    .returning();

  if (!request) return { success: false, error: 'Failed to attach photo.' };

  const bothUploaded = Boolean(request.drawerPhotoUrl) && Boolean(request.signaturePhotoUrl);

  // Guard on balanceAfter still being unset so a retaken photo after the refill was received doesn't do it twice.
  if (bothUploaded && !request.balanceAfter) {
    const updated = await db.transaction(async (trx) => {
      const closing = await closePeriodAndOpenNext(existing.storeId, existing.yearMonth, userId, trx);

      // balanceAfter is what the period now holding the cash has on paper; it also marks the refill as received,
      // which is what lets the spendable balance catch up with it (getRefillOutstanding becomes 0).
      const [row] = await trx
        .update(pettyCashRefillRequests)
        .set({ balanceAfter: String(closing.next.currentBalance), updatedAt: new Date() })
        .where(and(eq(pettyCashRefillRequests.id, id), isNull(pettyCashRefillRequests.balanceAfter)))
        .returning();
      return row;
    });

    if (updated) return { success: true, request: updated };
  }

  return { success: true, request };
}

export interface RefillRequestWithContext extends PettyCashRefillRequest {
  storeName: string;
  storeAreaId: number | null;
  requestedByName: string | null;
  /** What the store used, what Finance rejected and the cash to send — null for a request OPS rejected. */
  transfer: RefillTransfer | null;
}

export async function listRefillRequestsForFinance(limit = 50): Promise<RefillRequestWithContext[]> {
  const rows = await db
    .select({
      request: pettyCashRefillRequests,
      storeName: stores.name,
      storeAreaId: stores.areaId,
      requestedByName: users.name,
    })
    .from(pettyCashRefillRequests)
    .innerJoin(stores, eq(pettyCashRefillRequests.storeId, stores.id))
    .leftJoin(users, eq(pettyCashRefillRequests.requestedBy, users.id))
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(limit);

  // The figures behind each request that is (or was) going to be paid.
  const live = rows.filter((r) => r.request.status !== 'rejected').map((r) => r.request.id);
  const transfers = new Map((await getRefillRowsByIds(live)).map((f) => [f.id, f.transfer]));

  return rows.map((r) => ({
    ...r.request,
    storeName: r.storeName,
    storeAreaId: r.storeAreaId,
    requestedByName: r.requestedByName,
    transfer: transfers.get(r.request.id) ?? null,
  }));
}

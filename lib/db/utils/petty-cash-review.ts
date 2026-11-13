// lib/db/utils/petty-cash-review.ts
//
// Finance's review of completed petty cash requests (rules + states: lib/petty-cash-review.ts).
//
//   financeRejectTransaction  Finance turns a request down — "Perlu Perbaikan" or "Ditolak" (final) — PIC 1 is told.
//                             Perlu Perbaikan sends the SAME request back to PIC 1 as a `draft` (no new request):
//                             PIC 1 fixes it and sends it to OPS again (marked Re-request), OPS approves, and it comes
//                             back to Finance (lib/db/utils/petty-cash-re-request.ts). Where it is counted: it STAYS in
//                             its period while that period is still running and no refill has been asked for it;
//                             otherwise (the period has ended, or PIC 1 already sent its refill) it moves to the next
//                             period — made ahead as 'upcoming' when that is not the period in use yet.
//   financeAcceptTransaction  Finance accepts a request (Diterima), or takes a Ditolak back
//
// Both stop once the refill that settles the request's period has been verified: that cash is already
// sent (getVerifiedThrough). A request filed while the refill was on its way belongs to the NEXT period,
// so it stays open to Finance's decision. They also stop for a Perlu Perbaikan request PIC 1 has already
// filed again.
//
// A request keeps status 'completed' throughout, but while Finance's decision stands (needs_fix or
// rejected) its amount is NOT counted as used: turning it down gives the amount back to the period's
// balance, accepting takes it off again (adjustPeriodBalance — also on a period closed by its refill, until
// Finance verifies that refill). So "used", the balance and the refill (max − balance) all leave it out;
// whatever the transfer doesn't cover is paid by the employee outside the system.

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  pettyCashRefillRequests,
  pettyCashRefills,
  pettyCashTransactions,
  userRoles,
  users,
} from '@/lib/db/schema';
import { isLockedByVerification, leavesOutOfTransfer, refillSentFor, validateFinanceComment } from '@/lib/petty-cash-review';
import { RE_REQUEST_LABEL } from '@/lib/petty-cash-re-request';
import { addMonths, laterMonth, periodLabel } from '@/lib/petty-cash-period';
import { createNotificationsForUsers } from './notifications';
import { adjustPeriodBalance, ensureUpcomingPeriod, getActivePeriod, latestRefilledMonth } from './petty-cash-period';

export type ReviewResult =
  | { success: true; /** Perlu Perbaikan: the period the draft is counted in now (YYYY-MM). */ periodMonth?: string }
  | { success: false; error: string; status: 400 | 404 | 409 };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Per store, the latest period (YYYY-MM) whose refill Finance has verified (stores with none are absent).
 * Requests of that period or an earlier one are locked: the cash is already sent.
 */
export async function getVerifiedThrough(storeIds: number[]): Promise<Map<number, string>> {
  if (storeIds.length === 0) return new Map();

  const rows = await db
    .select({
      storeId: pettyCashRefillRequests.storeId,
      through: sql<string>`MAX(${pettyCashRefillRequests.yearMonth})`,
    })
    .from(pettyCashRefillRequests)
    .where(
      and(
        inArray(pettyCashRefillRequests.storeId, storeIds),
        eq(pettyCashRefillRequests.status, 'approved'),
        sql`${pettyCashRefillRequests.financeVerifiedAt} IS NOT NULL`,
      ),
    )
    .groupBy(pettyCashRefillRequests.storeId);

  return new Map(rows.map((r) => [r.storeId, r.through]));
}

export async function financeUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .where(and(eq(userRoles.code, 'finance'), eq(users.isActive, true)));
  return rows.map((r) => r.id);
}

async function loadTransaction(txId: number) {
  const [row] = await db
    .select({ tx: pettyCashTransactions })
    .from(pettyCashTransactions)
    .where(eq(pettyCashTransactions.id, txId))
    .limit(1);
  return row ?? null;
}

type TxRow = typeof pettyCashTransactions.$inferSelect;

async function isLocked(tx: TxRow): Promise<boolean> {
  const through = (await getVerifiedThrough([tx.storeId])).get(tx.storeId);
  return isLockedByVerification(tx.yearMonth, through);
}

/** The re-request that filed this request again, if there is one. */
async function reRequestOf(txId: number): Promise<number | null> {
  const [again] = await db
    .select({ id: pettyCashTransactions.id })
    .from(pettyCashTransactions)
    .where(eq(pettyCashTransactions.reRequestOfId, txId))
    .limit(1);
  return again?.id ?? null;
}

const amountOf = (tx: TxRow) => Number(tx.actualAmount ?? tx.amount);
const labelOf = (tx: TxRow) => tx.categoryName ?? 'Request petty cash';

// ─── Finance ─────────────────────────────────────────────────────────────────

/** How Finance turns a request down: Perlu Perbaikan (back to PIC 1 as a draft) or Ditolak (final). */
export type RejectKind = 'needs_fix' | 'rejected';

/**
 * Where a request Finance sends back (Perlu Perbaikan) is counted from now on. It STAYS in its period while that
 * period is still running (the one in use, or one made ahead) and nobody has asked for its refill yet — Finance
 * will see it again in the same check. Otherwise (the period has ended, or PIC 1 already sent its refill, e.g. on
 * the 15th) it moves to the NEXT period: the one after its own, never older than the period in use; a period that
 * does not exist yet is made ahead as 'upcoming' and opens when the calendar reaches it.
 */
async function fixPeriodFor(tx: TxRow): Promise<{ periodId: number; yearMonth: string }> {
  const active = await getActivePeriod(tx.storeId);

  const [asked] = await db
    .select({ id: pettyCashRefillRequests.id })
    .from(pettyCashRefillRequests)
    .where(
      and(
        eq(pettyCashRefillRequests.storeId, tx.storeId),
        eq(pettyCashRefillRequests.yearMonth, tx.yearMonth),
        ne(pettyCashRefillRequests.status, 'rejected'),
      ),
    )
    .limit(1);
  // A month-end refill of the old flow settles the period too.
  const [legacyRefill] = asked
    ? [asked]
    : await db
        .select({ id: pettyCashRefills.id })
        .from(pettyCashRefills)
        .where(and(eq(pettyCashRefills.storeId, tx.storeId), eq(pettyCashRefills.yearMonth, tx.yearMonth)))
        .limit(1);

  if (tx.yearMonth >= active.yearMonth && !legacyRefill && tx.periodId != null) {
    return { periodId: tx.periodId, yearMonth: tx.yearMonth };
  }

  const month = laterMonth(addMonths(tx.yearMonth, 1), active.yearMonth);
  const period = month === active.yearMonth ? active : await ensureUpcomingPeriod(tx.storeId, month);
  return { periodId: period.id, yearMonth: period.yearMonth };
}

/** PIC 1 has sent the Refill of this request's period (or a later one) — only then does a Ditolak reach them. */
async function refillSentForTx(tx: TxRow): Promise<boolean> {
  return refillSentFor(tx.yearMonth, await latestRefilledMonth(tx.storeId, db, { includeRejected: true }));
}

export async function financeRejectTransaction(input: {
  txId: number;
  actorId: string;
  /** Default: Ditolak. */
  kind?: RejectKind;
  comment?: unknown;
}): Promise<ReviewResult> {
  const kind: RejectKind = input.kind ?? 'rejected';
  const comment = validateFinanceComment(input.comment);
  if (!comment.ok) return { success: false, error: comment.error, status: 400 };

  const found = await loadTransaction(input.txId);
  if (!found) return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  const { tx } = found;

  if (tx.status === 'draft' || (tx.isReRequest && tx.status !== 'completed' && tx.status !== 'ops_rejected')) {
    return { success: false, error: 'Request ini sedang diperbaiki PIC 1 — bisa diputuskan lagi setelah disetujui OPS.', status: 409 };
  }
  if (tx.status !== 'completed') {
    return { success: false, error: 'Hanya request yang sudah selesai (jumlah terpakai sudah diisi PIC 1) yang bisa diputuskan.', status: 409 };
  }
  if (tx.financeReview === 'rejected') {
    return { success: false, error: 'Request ini sudah Ditolak. Batalkan penolakannya dulu kalau ingin mengubah keputusan.', status: 409 };
  }
  if (tx.financeReview === 'needs_fix' && kind === 'needs_fix') {
    return { success: false, error: 'Request ini sudah berstatus Perlu Perbaikan.', status: 409 };
  }
  if (await isLocked(tx)) {
    return { success: false, error: 'Refill toko ini sudah diverifikasi — nominalnya sudah dikunci dan keputusannya tidak bisa diubah lagi.', status: 409 };
  }
  const again = await reRequestOf(tx.id);
  if (again != null) {
    return { success: false, error: `Request ini sudah diajukan ulang sebagai ${RE_REQUEST_LABEL} (#${again}), jadi keputusannya tidak bisa diubah.`, status: 409 };
  }

  // Perlu Perbaikan: the same request goes back to PIC 1 as a draft, in this period or the next one.
  const target = kind === 'needs_fix' ? await fixPeriodFor(tx) : null;

  const now = new Date();
  const previous = tx.financeReview;
  const updated = await db.transaction(async (trx) => {
    const [row] = await trx
      .update(pettyCashTransactions)
      .set({
        financeReview: kind,
        financeReviewBy: input.actorId,
        financeReviewAt: now,
        financeComment: comment.comment,
        updatedAt: now,
        ...(target
          ? {
              status: 'draft',
              // The mark OPS and Finance see when it comes back: a request fixed after Perlu Perbaikan.
              isReRequest: true,
              periodId: target.periodId,
              yearMonth: target.yearMonth,
            }
          : {}),
      })
      .where(
        and(
          eq(pettyCashTransactions.id, tx.id),
          eq(pettyCashTransactions.status, 'completed'),
          previous == null ? isNull(pettyCashTransactions.financeReview) : eq(pettyCashTransactions.financeReview, previous),
        ),
      )
      .returning({ id: pettyCashTransactions.id });
    // The amount stops counting as used: a request that was still counted (never reviewed, or accepted)
    // gives it back to the period it was cut from; one that was already left out did so before. A draft is cut
    // again (from the period it is in by then) when OPS approves the fixed request.
    if (row && (previous == null || previous === 'accepted')) await adjustPeriodBalance(trx, tx.periodId, amountOf(tx));
    return row;
  });
  if (!updated) return { success: false, error: 'Gagal menyimpan keputusan. Muat ulang lalu coba lagi.', status: 409 };

  // Ditolak reaches PIC 1 only once the period's Refill has been sent (visibleReviewOutcome) — before that, no
  // message either. Perlu Perbaikan always does: the request is back with PIC 1 to fix.
  if (!target && !(await refillSentForTx(tx))) return { success: true };

  const reason = comment.comment ? ` Alasan: ${comment.comment}` : '';
  await createNotificationsForUsers([tx.userId], {
    type: 'petty_cash_tx_rejected',
    title: kind === 'needs_fix' ? 'Request petty cash perlu diperbaiki' : 'Request petty cash ditolak',
    body:
      target
        ? `${labelOf(tx)} ${rp(amountOf(tx))} perlu diperbaiki.${reason} Buka halaman Petty Cash, perbaiki request ini lalu kirim lagi ke OPS — dihitung di periode ${periodLabel(target.yearMonth)}.`
        : `${labelOf(tx)} ${rp(amountOf(tx))} ditolak dan tidak ikut ditransfer.${reason} Request yang ditolak tidak bisa diajukan ulang.`,
    link: '/employee/pettycash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true, periodMonth: target?.yearMonth };
}

/**
 * "Diterima": Finance has checked the request and it is fine.
 *  - from Pending Finance (no decision yet): just records the check — the amount was already counted as used, so
 *    nothing moves and PIC 1 is not messaged. It still works after the refill was verified (the amount does not
 *    change), so a month can always be completed.
 *  - from Perlu Perbaikan / Ditolak: takes that decision back, so the request counts as used again (before the
 *    refill is verified, and only while it has not been filed again as a re-request).
 */
export async function financeAcceptTransaction(input: { txId: number; actorId: string }): Promise<ReviewResult> {
  const found = await loadTransaction(input.txId);
  if (!found) return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  const { tx } = found;
  const previous = tx.financeReview;

  if (tx.status === 'draft' || (tx.isReRequest && tx.status !== 'completed' && tx.status !== 'ops_rejected')) {
    return { success: false, error: 'Request ini sedang diperbaiki PIC 1 — bisa diputuskan lagi setelah disetujui OPS.', status: 409 };
  }
  if (tx.status !== 'completed') {
    return { success: false, error: 'Hanya request yang sudah selesai (jumlah terpakai sudah diisi PIC 1) yang bisa diterima.', status: 409 };
  }
  if (previous === 'accepted') {
    return { success: false, error: 'Request ini sudah Diterima.', status: 409 };
  }

  const takingBack = leavesOutOfTransfer(previous);
  if (takingBack) {
    if (await isLocked(tx)) {
      return { success: false, error: 'Refill toko ini sudah diverifikasi — nominalnya sudah dikunci.', status: 409 };
    }
    const again = await reRequestOf(tx.id);
    if (again != null) {
      return { success: false, error: `Request ini sudah diajukan ulang sebagai ${RE_REQUEST_LABEL} (#${again}), jadi keputusannya tidak bisa dibatalkan.`, status: 409 };
    }
  }

  const now = new Date();
  const updated = await db.transaction(async (trx) => {
    const [row] = await trx
      .update(pettyCashTransactions)
      .set({ financeReview: 'accepted', financeReviewBy: input.actorId, financeReviewAt: now, updatedAt: now })
      .where(
        and(
          eq(pettyCashTransactions.id, tx.id),
          eq(pettyCashTransactions.status, 'completed'),
          previous == null ? isNull(pettyCashTransactions.financeReview) : eq(pettyCashTransactions.financeReview, previous),
        ),
      )
      .returning({ id: pettyCashTransactions.id });
    // Counted as used again: take the amount off the balance. (A plain check changes no amount.)
    if (row && takingBack) await adjustPeriodBalance(trx, tx.periodId, -amountOf(tx));
    return row;
  });
  if (!updated) return { success: false, error: 'Gagal memproses. Muat ulang lalu coba lagi.', status: 409 };

  if (!takingBack) return { success: true };
  // A Ditolak PIC 1 never saw (its Refill not sent yet) is taken back silently.
  if (previous === 'rejected' && !(await refillSentForTx(tx))) return { success: true };

  await createNotificationsForUsers([tx.userId], {
    type: 'petty_cash_tx_accepted',
    title: 'Keputusan Finance atas request petty cash dibatalkan',
    body: `${labelOf(tx)} ${rp(amountOf(tx))} tidak jadi ${previous === 'rejected' ? 'ditolak' : 'diminta diperbaiki'} dan ikut dihitung di Refill.`,
    link: '/employee/pettycash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true };
}

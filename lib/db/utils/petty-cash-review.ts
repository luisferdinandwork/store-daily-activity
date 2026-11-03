// lib/db/utils/petty-cash-review.ts
//
// Finance's review of completed petty cash requests (rules + states: lib/petty-cash-review.ts).
//
//   financeRejectTransaction  Finance turns a request down — "Perlu Perbaikan" (PIC 1 files it again next
//                             month as a re-request) or "Ditolak" (final, can't be re-requested) — PIC 1 is told
//   financeAcceptTransaction  Finance takes either decision back
//
// Both stop once the store's refill has been verified after the request was filed: that cash is already
// sent (getVerifiedCutoffs). They also stop for a Perlu Perbaikan request PIC 1 has already filed again.
//
// A request keeps status 'completed' throughout, but while Finance's decision stands (needs_fix or
// rejected) its amount is NOT counted as used: turning it down gives the amount back to the period's
// balance, accepting takes it off again (adjustPeriodBalance). So "used", the balance and the refill
// (max − balance) all leave it out; whatever the transfer doesn't cover is paid by the employee
// outside the system.

import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashTransactions,
  userRoles,
  users,
} from '@/lib/db/schema';
import { isLockedByVerification, leavesOutOfTransfer, validateFinanceComment } from '@/lib/petty-cash-review';
import { RE_REQUEST_LABEL } from '@/lib/petty-cash-re-request';
import { createNotificationsForUsers } from './notifications';

export type ReviewResult =
  | { success: true }
  | { success: false; error: string; status: 400 | 404 | 409 };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const money = (n: number) => n.toFixed(2);

/** Later than any request: while a verified refill is still waiting for PIC 1's receipt, everything is locked. */
const LOCKED_UNTIL_RECEIVED = new Date(8_640_000_000_000_000);

/**
 * When Finance last verified a refill of each store (stores with none are absent). Requests filed up
 * to that moment are locked. While a verified refill has not been received yet (PIC 1 has not
 * confirmed with both photos) the cash is already sent, so the cutoff is "forever": a request filed
 * in between can't be decided on either. Once it is received, new requests start a new cycle.
 */
export async function getVerifiedCutoffs(storeIds: number[]): Promise<Map<number, Date>> {
  if (storeIds.length === 0) return new Map();

  const rows = await db
    .select({
      storeId: pettyCashRefillRequests.storeId,
      at: pettyCashRefillRequests.financeVerifiedAt,
      balanceAfter: pettyCashRefillRequests.balanceAfter,
    })
    .from(pettyCashRefillRequests)
    .where(
      and(
        inArray(pettyCashRefillRequests.storeId, storeIds),
        eq(pettyCashRefillRequests.status, 'approved'),
        isNotNull(pettyCashRefillRequests.financeVerifiedAt),
      ),
    )
    .orderBy(asc(pettyCashRefillRequests.financeVerifiedAt));

  // Oldest first, so the last row of a store is its latest verified refill.
  const out = new Map<number, Date>();
  for (const r of rows) {
    if (!r.at) continue;
    out.set(r.storeId, r.balanceAfter == null ? LOCKED_UNTIL_RECEIVED : new Date(r.at));
  }
  return out;
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
  const cutoff = (await getVerifiedCutoffs([tx.storeId])).get(tx.storeId);
  return isLockedByVerification(tx.createdAt, cutoff);
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

type Trx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Moves the money the request's period has left (+ gives back, − takes off), kept between 0 and the
 * maximum. Closed periods are frozen books and stay as they are.
 */
async function adjustPeriodBalance(trx: Trx, periodId: number | null, delta: number): Promise<void> {
  if (periodId == null || delta === 0) return;
  await trx
    .update(pettyCashPeriods)
    .set({
      currentBalance: sql`GREATEST(0, LEAST(${String(PETTY_CASH_MAX_BALANCE)}::numeric, ${pettyCashPeriods.currentBalance} + ${money(delta)}::numeric))`,
      updatedAt: new Date(),
    })
    .where(and(eq(pettyCashPeriods.id, periodId), eq(pettyCashPeriods.status, 'open')));
}

// ─── Finance ─────────────────────────────────────────────────────────────────

/** How Finance turns a request down: Perlu Perbaikan (re-requestable) or Ditolak (final). */
export type RejectKind = 'needs_fix' | 'rejected';

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
    // gives it back; one that was already left out (needs_fix → rejected) did so before.
    if (row && (previous == null || previous === 'accepted')) await adjustPeriodBalance(trx, tx.periodId, amountOf(tx));
    return row;
  });
  if (!updated) return { success: false, error: 'Gagal menyimpan keputusan. Muat ulang lalu coba lagi.', status: 409 };

  const reason = comment.comment ? ` Alasan: ${comment.comment}` : '';
  await createNotificationsForUsers([tx.userId], {
    type: 'petty_cash_tx_rejected',
    title: kind === 'needs_fix' ? 'Request petty cash perlu diperbaiki' : 'Request petty cash ditolak',
    body:
      kind === 'needs_fix'
        ? `${labelOf(tx)} ${rp(amountOf(tx))} perlu diperbaiki dan tidak ikut ditransfer.${reason} Ajukan ulang bulan depan lewat ${RE_REQUEST_LABEL} di halaman Petty Cash.`
        : `${labelOf(tx)} ${rp(amountOf(tx))} ditolak dan tidak ikut ditransfer.${reason} Request yang ditolak tidak bisa diajukan ulang.`,
    link: '/employee/pettycash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true };
}

/** Takes Finance's decision on a request back: it counts as used again. */
export async function financeAcceptTransaction(input: { txId: number; actorId: string }): Promise<ReviewResult> {
  const found = await loadTransaction(input.txId);
  if (!found) return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  const { tx } = found;

  if (!leavesOutOfTransfer(tx.financeReview)) {
    return { success: false, error: 'Request ini tidak sedang menunggu keputusan Finance.', status: 409 };
  }
  if (await isLocked(tx)) {
    return { success: false, error: 'Refill toko ini sudah diverifikasi — nominalnya sudah dikunci.', status: 409 };
  }
  const again = await reRequestOf(tx.id);
  if (again != null) {
    return { success: false, error: `Request ini sudah diajukan ulang sebagai ${RE_REQUEST_LABEL} (#${again}), jadi keputusannya tidak bisa dibatalkan.`, status: 409 };
  }

  const now = new Date();
  const updated = await db.transaction(async (trx) => {
    const [row] = await trx
      .update(pettyCashTransactions)
      .set({ financeReview: 'accepted', financeReviewBy: input.actorId, financeReviewAt: now, updatedAt: now })
      .where(and(eq(pettyCashTransactions.id, tx.id), eq(pettyCashTransactions.financeReview, tx.financeReview!)))
      .returning({ id: pettyCashTransactions.id });
    // Counted as used again: take the amount off the balance.
    if (row) await adjustPeriodBalance(trx, tx.periodId, -amountOf(tx));
    return row;
  });
  if (!updated) return { success: false, error: 'Gagal memproses. Muat ulang lalu coba lagi.', status: 409 };

  await createNotificationsForUsers([tx.userId], {
    type: 'petty_cash_tx_accepted',
    title: 'Keputusan Finance atas request petty cash dibatalkan',
    body: `${labelOf(tx)} ${rp(amountOf(tx))} tidak jadi ${tx.financeReview === 'rejected' ? 'ditolak' : 'diminta diperbaiki'} dan ikut dihitung di Refill.`,
    link: '/employee/pettycash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true };
}

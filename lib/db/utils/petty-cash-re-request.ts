// lib/db/utils/petty-cash-re-request.ts
//
// Fixing a request Finance sent back with "Perlu Perbaikan" (rules + wording: lib/petty-cash-re-request.ts).
// There is NO new request: Finance's Perlu Perbaikan turns the SAME request into a `draft`
// (financeRejectTransaction in ./petty-cash-review.ts — it stays in its period while that period is still running and
// no refill was asked for it, otherwise it moves to the next period), and from there:
//
//   resubmitFixedRequest   PIC 1 corrects it (category, Keterangan, what was spent, receipt photo) and sends it to
//                          OPS again → `pending_ops`, still marked Re-request (`is_re_request`) so OPS knows it was
//                          fixed after Perlu Perbaikan
//   approveFixedRequest    OPS approves it → `completed` straight away (PIC 1 already gave what was spent and the
//                          receipt), the amount is cut from the balance of the period it is in, and Finance's
//                          decision is cleared: it is Pending Finance again — Finance can accept it, send it back
//                          again or turn it down, the normal flow. (OPS rejecting it is the normal reject.)
//
// A Ditolak request is final and is never sent back to PIC 1.

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { PETTY_CASH_MAX_BALANCE, pettyCashPeriods, pettyCashTransactions, stores } from '@/lib/db/schema';
import { PETTY_CASH_REASON_MAX, pettyCashDescription } from '@/lib/petty-cash-categories';
import { periodLabel } from '@/lib/petty-cash-period';
import { createNotificationsForUsers } from './notifications';
import { getPettyCashCategory } from './petty-cash-categories';
import { rollRequestToActivePeriod } from './petty-cash-period';
import { getSpendable } from './petty-cash-refill';
import { financeUserIds } from './petty-cash-review';

const money = (n: number) => n.toFixed(2);
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

export type FixResult =
  | { success: true; txId: number; periodMonth: string }
  | { success: false; error: string; status: 400 | 404 | 409 | 422 };

async function loadRequest(txId: number) {
  const [row] = await db
    .select({ tx: pettyCashTransactions, storeName: stores.name })
    .from(pettyCashTransactions)
    .innerJoin(stores, eq(stores.id, pettyCashTransactions.storeId))
    .where(eq(pettyCashTransactions.id, txId))
    .limit(1);
  return row ?? null;
}

async function loadPeriod(periodId: number | null) {
  if (periodId == null) return null;
  const [period] = await db.select().from(pettyCashPeriods).where(eq(pettyCashPeriods.id, periodId)).limit(1);
  return period ?? null;
}

export interface ResubmitInput {
  /** The draft (Perlu Perbaikan) request being fixed. */
  txId: number;
  /** The store PIC 1 belongs to — a request of another store is never theirs. */
  storeId: number;
  userId: string;
  description: unknown;
  /** What was spent. */
  actualAmount: unknown;
  /** The category to file it under; leave out to keep its own (while that is still an active one). */
  categoryId?: unknown;
  /** A new receipt photo; leave out to keep the one it has. */
  imageUrl?: string | null;
  imageKey?: string | null;
}

/** PIC 1 fixes a draft and sends it to OPS again. */
export async function resubmitFixedRequest(input: ResubmitInput): Promise<FixResult> {
  const description = pettyCashDescription(typeof input.description === 'string' ? input.description.trim() : '');
  if (!description) return { success: false, error: 'Keterangan wajib diisi.', status: 400 };
  if (description.length > PETTY_CASH_REASON_MAX) {
    return { success: false, error: `Keterangan maksimal ${PETTY_CASH_REASON_MAX} karakter.`, status: 400 };
  }

  const actual = Number(input.actualAmount);
  if (!Number.isFinite(actual) || actual <= 0 || actual > PETTY_CASH_MAX_BALANCE) {
    return { success: false, error: 'Jumlah terpakai harus lebih dari 0.', status: 400 };
  }
  const amount = Math.round(actual);

  const found = await loadRequest(input.txId);
  if (!found || found.tx.storeId !== input.storeId) {
    return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  }
  const { tx } = found;
  if (tx.status !== 'draft') {
    return {
      success: false,
      error: 'Hanya request yang dikembalikan Finance (Perlu Perbaikan) yang bisa diperbaiki dan dikirim ulang.',
      status: 409,
    };
  }

  // The category can be changed: the one picked must be active; with none picked its own is kept — but only while
  // PIC 1 could still pick it (an older category may have been hidden since).
  const wanted = input.categoryId == null || input.categoryId === '' ? null : Number(input.categoryId);
  if (wanted != null && !Number.isInteger(wanted)) {
    return { success: false, error: 'Pilih kategori petty cash.', status: 400 };
  }
  const category = await getPettyCashCategory(wanted ?? tx.categoryId ?? -1);
  if (!category || !category.isActive) {
    return {
      success: false,
      error:
        wanted != null
          ? 'Kategori tidak tersedia. Pilih kategori petty cash.'
          : 'Kategori request ini sudah tidak dipakai — pilih kategori yang baru.',
      status: 400,
    };
  }

  const newImage = input.imageUrl?.trim() || null;
  const imageUrl = newImage ?? tx.imageUrl;
  if (!imageUrl) return { success: false, error: 'Foto struk wajib ada.', status: 400 };

  // Its period ended while it was being fixed: it moves on with the store (the calendar does this on the 16th too).
  await rollRequestToActivePeriod(tx.id, tx.storeId);
  const [current] = await db
    .select({ periodId: pettyCashTransactions.periodId, yearMonth: pettyCashTransactions.yearMonth })
    .from(pettyCashTransactions)
    .where(eq(pettyCashTransactions.id, tx.id))
    .limit(1);
  const period = await loadPeriod(current?.periodId ?? null);
  if (!period || period.status === 'closed') {
    return { success: false, error: 'Periode petty cash request ini sudah ditutup.', status: 422 };
  }

  // Cut from this period once OPS approves — so it has to fit what the period has left now.
  const { spendable } = await getSpendable(tx.storeId, period);
  if (amount > spendable) {
    return {
      success: false,
      error: `Saldo periode ${periodLabel(period.yearMonth)} tidak cukup (${rp(spendable)}).`,
      status: 422,
    };
  }

  const now = new Date();
  const [row] = await db
    .update(pettyCashTransactions)
    .set({
      status: 'pending_ops',
      // No estimate to speak of: what was asked for is what was spent.
      amount: money(amount),
      actualAmount: money(amount),
      actualAmountBy: input.userId,
      actualAmountAt: now,
      description,
      categoryId: category.id,
      categoryName: category.name,
      imageUrl,
      imageKey: newImage ? input.imageKey?.trim() || null : tx.imageKey,
      isReRequest: true,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      updatedAt: now,
    })
    .where(and(eq(pettyCashTransactions.id, tx.id), eq(pettyCashTransactions.status, 'draft')))
    .returning({ id: pettyCashTransactions.id });
  if (!row) return { success: false, error: 'Request ini baru saja berubah. Muat ulang lalu coba lagi.', status: 409 };

  return { success: true, txId: row.id, periodMonth: period.yearMonth };
}

/** A request OPS has to approve that is a fix of a Perlu Perbaikan one (it already carries what was spent). */
export const isFixedRequest = (tx: { status: string; isReRequest: boolean; actualAmount: string | null }) =>
  tx.status === 'pending_ops' && tx.isReRequest && tx.actualAmount != null;

/**
 * OPS approves a fixed request: it is completed at once — its amount cut from its period — and is Pending Finance
 * again (Finance's earlier comment is kept so Finance can see what was asked).
 */
export async function approveFixedRequest(input: { txId: number; actorId: string }): Promise<FixResult> {
  const found = await loadRequest(input.txId);
  if (!found) return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  if (!isFixedRequest(found.tx)) {
    return { success: false, error: 'Request ini bukan perbaikan yang menunggu OPS.', status: 409 };
  }
  const { storeName } = found;

  // A request left behind in a period that has ended belongs to the period in use.
  await rollRequestToActivePeriod(found.tx.id, found.tx.storeId);
  const [tx] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, input.txId)).limit(1);
  const period = await loadPeriod(tx?.periodId ?? null);
  if (!tx || !period || period.status === 'closed') {
    return { success: false, error: 'Periode petty cash request ini sudah ditutup.', status: 422 };
  }

  const amount = Number(tx.actualAmount);
  // Spendable = the period's balance minus the previous refill not received yet, plus its own once received.
  const { net } = await getSpendable(tx.storeId, period);

  const now = new Date();
  try {
    await db.transaction(async (trx) => {
      const [paid] = await trx
        .update(pettyCashPeriods)
        .set({
          currentBalance: sql`${pettyCashPeriods.currentBalance} - ${money(amount)}::numeric`,
          updatedAt: now,
        })
        .where(
          and(
            eq(pettyCashPeriods.id, period.id),
            inArray(pettyCashPeriods.status, ['open', 'upcoming']),
            sql`${pettyCashPeriods.currentBalance} + ${money(net)}::numeric >= ${money(amount)}::numeric`,
          ),
        )
        .returning({ id: pettyCashPeriods.id });
      if (!paid) throw new Error('INSUFFICIENT_BALANCE');

      const [row] = await trx
        .update(pettyCashTransactions)
        .set({
          status: 'completed',
          approvedBy: input.actorId,
          approvedAt: now,
          // Back on Finance's list as Pending Finance.
          financeReview: null,
          financeReviewBy: null,
          financeReviewAt: null,
          updatedAt: now,
        })
        .where(and(eq(pettyCashTransactions.id, tx.id), eq(pettyCashTransactions.status, 'pending_ops')))
        .returning({ id: pettyCashTransactions.id });
      if (!row) throw new Error('CHANGED');
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INSUFFICIENT_BALANCE') {
      return {
        success: false,
        error: `Saldo petty cash periode ${periodLabel(period.yearMonth)} tidak cukup untuk ${rp(amount)}.`,
        status: 422,
      };
    }
    if (err instanceof Error && err.message === 'CHANGED') {
      return { success: false, error: 'Request ini sudah diproses. Muat ulang halaman.', status: 409 };
    }
    throw err;
  }

  await createNotificationsForUsers(await financeUserIds(), {
    type: 'petty_cash_tx_re_request',
    title: 'Request petty cash yang diperbaiki sudah disetujui OPS',
    body: `${storeName}: ${tx.categoryName ?? 'Request petty cash'} (${rp(amount)}) sudah diperbaiki PIC 1 setelah Perlu Perbaikan dan disetujui OPS — periode ${periodLabel(period.yearMonth)}, menunggu keputusan Finance.`,
    link: '/finance/petty-cash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true, txId: tx.id, periodMonth: period.yearMonth };
}

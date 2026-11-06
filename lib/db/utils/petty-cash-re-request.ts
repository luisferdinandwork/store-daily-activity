// lib/db/utils/petty-cash-re-request.ts
//
// Re-request (rules + wording: lib/petty-cash-re-request.ts): PIC 1 files a request Finance sent back with
// "Perlu Perbaikan" again. A Ditolak request is final and can not be re-requested.
//
//   createReRequest    the new request — inserted straight as 'completed' (Ops approved the original, so it
//                      has no Ops step) with the usage + receipt, deducting the balance of ITS period
//
// Which period: Finance checks petty cash once a month, so a request it sent back is not decided again in the
// same check — a Re-request is counted in the period AFTER the one the original was filed in (and never in one
// that is already closed: if the store has moved on, in the period in use). When that is still ahead of the
// period in use (the original's own period has not been refilled yet), the next period is created ahead of time
// as 'upcoming' and opens when the current one closes (lib/db/utils/petty-cash-period.ts).
//
// PIC 1 can change the category, Keterangan, what was spent and the receipt photo. The original is left as it is
// (still Perlu Perbaikan, still outside its own period's "used"); the new row is a normal completed request as
// far as the balance, the refill and Finance's review are concerned — Finance can accept it, send it back again
// (a Perlu Perbaikan re-request can be re-requested in turn) or turn it down. `createdAt` is the day it was
// filed; `requestDate` the day PIC 1 typed in.

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { jakartaDayStart, jakartaTodayKey } from '@/lib/day-bucket';
import { PETTY_CASH_MAX_BALANCE, pettyCashPeriods, pettyCashTransactions, stores } from '@/lib/db/schema';
import { PETTY_CASH_REASON_MAX, pettyCashDescription } from '@/lib/petty-cash-categories';
import { periodLabel, reRequestPeriodMonth } from '@/lib/petty-cash-period';
import { RE_REQUEST_LABEL, validateRequestDate } from '@/lib/petty-cash-re-request';
import { canReRequest } from '@/lib/petty-cash-review';
import { createNotificationsForUsers } from './notifications';
import { getPettyCashCategory } from './petty-cash-categories';
import { ensureUpcomingPeriod, getActivePeriod } from './petty-cash-period';
import { currentYearMonthJakarta, getRefillOutstanding } from './petty-cash-refill';
import { financeUserIds } from './petty-cash-review';

const money = (n: number) => n.toFixed(2);
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

export interface ReRequestInput {
  /** The Perlu Perbaikan request being filed again. */
  originalTxId: number;
  /** The store PIC 1 belongs to — a request of another store is never theirs. */
  storeId: number;
  userId: string;
  /** YYYY-MM-DD: the day the request was made. */
  requestDate: unknown;
  description: unknown;
  /** What was spent. */
  actualAmount: unknown;
  /** The category to file it under; leave out to keep the original's (while it is still an active one). */
  categoryId?: unknown;
  /** A new receipt photo; leave out to keep the one on the original. */
  imageUrl?: string | null;
  imageKey?: string | null;
}

export type ReRequestResult =
  | { success: true; txId: number; newBalance: number; periodMonth: string }
  | { success: false; error: string; status: 400 | 404 | 409 | 422 };

export async function createReRequest(input: ReRequestInput): Promise<ReRequestResult> {
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

  const date = validateRequestDate(input.requestDate, jakartaTodayKey());
  if (!date.ok) return { success: false, error: date.error, status: 400 };

  const [original] = await db
    .select({ tx: pettyCashTransactions, storeName: stores.name })
    .from(pettyCashTransactions)
    .innerJoin(stores, eq(stores.id, pettyCashTransactions.storeId))
    .where(eq(pettyCashTransactions.id, input.originalTxId))
    .limit(1);
  if (!original || original.tx.storeId !== input.storeId) {
    return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  }
  const { tx, storeName } = original;

  if (tx.financeReview === 'rejected') {
    return { success: false, error: `Request yang Ditolak tidak bisa diajukan ulang.`, status: 409 };
  }
  if (tx.status !== 'completed' || !canReRequest(tx.financeReview)) {
    return { success: false, error: `Hanya request yang Perlu Perbaikan yang bisa diajukan ulang sebagai ${RE_REQUEST_LABEL}.`, status: 409 };
  }

  const [already] = await db
    .select({ id: pettyCashTransactions.id })
    .from(pettyCashTransactions)
    .where(eq(pettyCashTransactions.reRequestOfId, tx.id))
    .limit(1);
  if (already) {
    return { success: false, error: `Request ini sudah diajukan ulang (#${already.id}).`, status: 409 };
  }

  // The category can be changed: the one picked must be active; with none picked the original's is kept — but
  // only while PIC 1 could still pick it (an older category may have been hidden since).
  const wanted = input.categoryId == null || input.categoryId === '' ? null : Number(input.categoryId);
  if (wanted != null && !Number.isInteger(wanted)) {
    return { success: false, error: 'Pilih kategori petty cash.', status: 400 };
  }
  const category = await getPettyCashCategory(wanted ?? tx.categoryId ?? -1);
  if (!category || !category.isActive) {
    return {
      success: false,
      error: wanted != null ? 'Kategori tidak tersedia. Pilih kategori petty cash.' : 'Kategori request ini sudah tidak dipakai — pilih kategori yang baru.',
      status: 400,
    };
  }

  const newImage = input.imageUrl?.trim() || null;
  const imageUrl = newImage ?? tx.imageUrl;
  if (!imageUrl) return { success: false, error: 'Foto struk wajib ada.', status: 400 };

  // The period it is counted in: the one after the original's — or the period in use, if the store has moved on.
  const usage = await getActivePeriod(tx.storeId, currentYearMonthJakarta());
  const targetMonth = reRequestPeriodMonth(tx.yearMonth, usage.yearMonth);
  const period = targetMonth === usage.yearMonth ? usage : await ensureUpcomingPeriod(tx.storeId, targetMonth);
  if (period.status === 'closed') {
    return { success: false, error: `Periode petty cash ${periodLabel(period.yearMonth)} sudah ditutup.`, status: 422 };
  }

  // Cash on hand in that period = its balance minus a refill (of the period before it) not received yet.
  const owed = await getRefillOutstanding(tx.storeId, period.yearMonth);

  const now = new Date();
  try {
    const created = await db.transaction(async (trx) => {
      const [paid] = await trx
        .update(pettyCashPeriods)
        .set({
          currentBalance: sql`${pettyCashPeriods.currentBalance} - ${money(amount)}::numeric`,
          updatedAt: now,
        })
        .where(
          and(
            eq(pettyCashPeriods.id, period.id),
            sql`${pettyCashPeriods.status} IN ('open', 'upcoming')`,
            sql`${pettyCashPeriods.currentBalance} - ${money(owed)}::numeric >= ${money(amount)}::numeric`,
          ),
        )
        .returning({ balance: pettyCashPeriods.currentBalance });
      if (!paid) throw new Error('INSUFFICIENT_BALANCE');

      const [row] = await trx
        .insert(pettyCashTransactions)
        .values({
          periodId: period.id,
          // No estimate to speak of: the amount asked for is the amount spent.
          amount: money(amount),
          actualAmount: money(amount),
          actualAmountBy: input.userId,
          actualAmountAt: now,
          description,
          categoryId: category.id,
          categoryName: category.name,
          userId: input.userId,
          storeId: tx.storeId,
          status: 'completed',
          imageUrl,
          imageKey: newImage ? input.imageKey?.trim() || null : tx.imageKey,
          yearMonth: period.yearMonth,
          isReRequest: true,
          reRequestOfId: tx.id,
          requestDate: jakartaDayStart(date.date),
          // Explicit app-clock time, like every request (see POST /api/employee/petty-cash).
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: pettyCashTransactions.id });

      return { id: row.id, balance: Math.max(0, Number(paid.balance) - owed) };
    });

    await createNotificationsForUsers(await financeUserIds(), {
      type: 'petty_cash_tx_re_request',
      title: 'Re-request petty cash dikirim',
      body: `${storeName}: ${category.name} (${rp(amount)}) diajukan ulang PIC 1 setelah Perlu Perbaikan — dihitung di periode ${periodLabel(period.yearMonth)}.`,
      link: '/finance/petty-cash',
      relatedType: 'petty_cash_transaction',
      relatedId: created.id,
    });

    return { success: true, txId: created.id, newBalance: created.balance, periodMonth: period.yearMonth };
  } catch (err) {
    if (err instanceof Error && err.message === 'INSUFFICIENT_BALANCE') {
      return { success: false, error: `Saldo petty cash periode ${periodLabel(period.yearMonth)} tidak cukup untuk jumlah ini.`, status: 422 };
    }
    // The unique index on re_request_of_id: someone filed it again a moment ago.
    if ((err as { code?: string } | null)?.code === '23505') {
      return { success: false, error: 'Request ini sudah diajukan ulang.', status: 409 };
    }
    throw err;
  }
}

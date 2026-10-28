// lib/db/utils/petty-cash-review.ts
//
// Finance's review of completed petty cash requests (rules + states: lib/petty-cash-review.ts).
//
//   financeRejectTransaction  Finance turns a request down (optional comment) — PIC 1 is told
//   financeAcceptTransaction  Finance accepts PIC 1's correction, or takes a rejection back
//   employeeFixTransaction    PIC 1 corrects a rejected request (Keterangan, jumlah, struk) and resubmits
//
// All three stop once the store's refill has been verified after the request was filed: that cash is
// already sent, so a rejection standing at that point is permanent (getVerifiedCutoffs).
//
// A request keeps status 'completed' throughout — the money was already taken off the period's balance
// when PIC 1 confirmed it, and the balance goes back to the maximum with the refill anyway. Only the
// refill TRANSFER leaves rejected requests out (see getRefillRowsByIds).

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashTransactions,
  stores,
  userRoles,
  users,
} from '@/lib/db/schema';
import { PETTY_CASH_REASON_MAX, pettyCashDescription } from '@/lib/petty-cash-categories';
import { isLockedByVerification, validateFinanceComment } from '@/lib/petty-cash-review';
import { createNotificationsForUsers } from './notifications';

export type ReviewResult =
  | { success: true }
  | { success: false; error: string; status: 400 | 404 | 409 };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const money = (n: number) => n.toFixed(2);

/** When Finance last verified a refill of each store (stores with none are absent). */
export async function getVerifiedCutoffs(storeIds: number[]): Promise<Map<number, Date>> {
  if (storeIds.length === 0) return new Map();

  const rows = await db
    .select({
      storeId: pettyCashRefillRequests.storeId,
      at: sql<Date>`MAX(${pettyCashRefillRequests.financeVerifiedAt})`,
    })
    .from(pettyCashRefillRequests)
    .where(
      and(
        inArray(pettyCashRefillRequests.storeId, storeIds),
        eq(pettyCashRefillRequests.status, 'approved'),
        isNotNull(pettyCashRefillRequests.financeVerifiedAt),
      ),
    )
    .groupBy(pettyCashRefillRequests.storeId);

  // Raw aggregates come back as strings from node-postgres, whatever the column type.
  return new Map(rows.map((r) => [r.storeId, new Date(r.at)]));
}

async function financeUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .where(and(eq(userRoles.code, 'finance'), eq(users.isActive, true)));
  return rows.map((r) => r.id);
}

async function loadTransaction(txId: number) {
  const [row] = await db
    .select({ tx: pettyCashTransactions, storeName: stores.name })
    .from(pettyCashTransactions)
    .innerJoin(stores, eq(stores.id, pettyCashTransactions.storeId))
    .where(eq(pettyCashTransactions.id, txId))
    .limit(1);
  return row ?? null;
}

type TxRow = typeof pettyCashTransactions.$inferSelect;

async function isLocked(tx: TxRow): Promise<boolean> {
  const cutoff = (await getVerifiedCutoffs([tx.storeId])).get(tx.storeId);
  return isLockedByVerification(tx.createdAt, cutoff);
}

const amountOf = (tx: TxRow) => Number(tx.actualAmount ?? tx.amount);
const labelOf = (tx: TxRow) => tx.categoryName ?? 'Request petty cash';

// ─── Finance ─────────────────────────────────────────────────────────────────

export async function financeRejectTransaction(input: {
  txId: number;
  actorId: string;
  comment?: unknown;
}): Promise<ReviewResult> {
  const comment = validateFinanceComment(input.comment);
  if (!comment.ok) return { success: false, error: comment.error, status: 400 };

  const found = await loadTransaction(input.txId);
  if (!found) return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  const { tx } = found;

  if (tx.status !== 'completed') {
    return { success: false, error: 'Hanya request yang sudah selesai (jumlah terpakai sudah diisi PIC 1) yang bisa ditolak.', status: 409 };
  }
  if (tx.financeReview === 'rejected') {
    return { success: false, error: 'Request ini sudah ditolak.', status: 409 };
  }
  if (await isLocked(tx)) {
    return { success: false, error: 'Refill toko ini sudah diverifikasi — nominalnya sudah dikunci dan tidak bisa ditolak lagi.', status: 409 };
  }

  const now = new Date();
  const [updated] = await db
    .update(pettyCashTransactions)
    .set({
      financeReview: 'rejected',
      financeReviewBy: input.actorId,
      financeReviewAt: now,
      financeComment: comment.comment,
      // The first rejection keeps what the request originally looked like.
      financeRejectedSnapshot: tx.financeRejectedSnapshot ?? {
        description: tx.description,
        amount: tx.amount,
        actualAmount: tx.actualAmount,
        imageUrl: tx.imageUrl,
      },
      updatedAt: now,
    })
    .where(and(eq(pettyCashTransactions.id, tx.id), eq(pettyCashTransactions.status, 'completed')))
    .returning({ id: pettyCashTransactions.id });
  if (!updated) return { success: false, error: 'Gagal menolak. Muat ulang lalu coba lagi.', status: 409 };

  await createNotificationsForUsers([tx.userId], {
    type: 'petty_cash_tx_rejected',
    title: 'Request petty cash ditolak Finance',
    body:
      `${labelOf(tx)} ${rp(amountOf(tx))} ditolak Finance dan tidak ikut ditransfer.` +
      (comment.comment ? ` Alasan: ${comment.comment}` : '') +
      ' Perbaiki di halaman Petty Cash sebelum Finance memverifikasi Refill.',
    link: '/employee/pettycash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true };
}

/** Accepts PIC 1's correction, or — on a request nobody corrected — takes the rejection back. */
export async function financeAcceptTransaction(input: { txId: number; actorId: string }): Promise<ReviewResult> {
  const found = await loadTransaction(input.txId);
  if (!found) return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  const { tx } = found;

  if (tx.financeReview !== 'rejected' && tx.financeReview !== 'resubmitted') {
    return { success: false, error: 'Request ini tidak sedang menunggu keputusan Finance.', status: 409 };
  }
  if (await isLocked(tx)) {
    return { success: false, error: 'Refill toko ini sudah diverifikasi — nominalnya sudah dikunci.', status: 409 };
  }

  const wasFix = tx.financeReview === 'resubmitted';
  const now = new Date();
  const [updated] = await db
    .update(pettyCashTransactions)
    .set({ financeReview: 'accepted', financeReviewBy: input.actorId, financeReviewAt: now, updatedAt: now })
    .where(and(eq(pettyCashTransactions.id, tx.id), eq(pettyCashTransactions.financeReview, tx.financeReview)))
    .returning({ id: pettyCashTransactions.id });
  if (!updated) return { success: false, error: 'Gagal memproses. Muat ulang lalu coba lagi.', status: 409 };

  await createNotificationsForUsers([tx.userId], {
    type: 'petty_cash_tx_accepted',
    title: wasFix ? 'Perbaikan petty cash diterima Finance' : 'Penolakan petty cash dibatalkan Finance',
    body: `${labelOf(tx)} ${rp(amountOf(tx))} ${wasFix ? 'sudah diterima Finance' : 'tidak jadi ditolak'} dan ikut dihitung di Refill.`,
    link: '/employee/pettycash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true };
}

// ─── Employee ────────────────────────────────────────────────────────────────

export interface FixInput {
  txId: number;
  /** The store PIC 1 belongs to — a request of another store is never theirs to fix. */
  storeId: number;
  userId: string;
  description: unknown;
  actualAmount: unknown;
  /** A new receipt photo; leave out to keep the one on file. */
  imageUrl?: string | null;
  imageKey?: string | null;
}

export async function employeeFixTransaction(input: FixInput): Promise<ReviewResult> {
  const description = pettyCashDescription(typeof input.description === 'string' ? input.description.trim() : '');
  if (!description) return { success: false, error: 'Keterangan wajib diisi.', status: 400 };
  if (description.length > PETTY_CASH_REASON_MAX) {
    return { success: false, error: `Keterangan maksimal ${PETTY_CASH_REASON_MAX} karakter.`, status: 400 };
  }
  const actual = Number(input.actualAmount);
  if (!Number.isFinite(actual) || actual <= 0 || actual > PETTY_CASH_MAX_BALANCE) {
    return { success: false, error: 'Jumlah terpakai harus lebih dari 0.', status: 400 };
  }
  const newActual = Math.round(actual);

  const found = await loadTransaction(input.txId);
  if (!found || found.tx.storeId !== input.storeId) {
    return { success: false, error: 'Request tidak ditemukan.', status: 404 };
  }
  const { tx, storeName } = found;

  const standing = tx.financeReview === 'rejected' || tx.financeReview === 'resubmitted';
  if (standing && (await isLocked(tx))) {
    return {
      success: false,
      error: 'Refill sudah diverifikasi Finance — penolakan ini permanen. Ajukan request baru bulan depan.',
      status: 409,
    };
  }
  if (tx.financeReview !== 'rejected') {
    return { success: false, error: 'Request ini tidak sedang ditolak Finance, jadi tidak bisa diperbaiki.', status: 409 };
  }

  const newImage = input.imageUrl?.trim() || null;
  const oldActual = amountOf(tx);
  const delta = newActual - oldActual;
  if (!newImage && !tx.imageUrl) {
    return { success: false, error: 'Foto struk wajib ada.', status: 400 };
  }
  if (description === pettyCashDescription(tx.description) && delta === 0 && !newImage) {
    return { success: false, error: 'Ubah Keterangan, jumlah, atau foto struk dulu sebelum mengirim ulang.', status: 400 };
  }

  const now = new Date();
  const outcome = await db.transaction(async (trx): Promise<ReviewResult> => {
    // A different amount moves the money the period has left by the difference.
    if (delta !== 0) {
      if (tx.periodId == null) {
        return { success: false, error: 'Jumlah tidak bisa diubah: request ini tidak terhubung ke periode petty cash.', status: 409 };
      }
      const [period] = await trx
        .update(pettyCashPeriods)
        .set({ currentBalance: sql`${pettyCashPeriods.currentBalance} - ${money(delta)}::numeric`, updatedAt: now })
        .where(
          and(
            eq(pettyCashPeriods.id, tx.periodId),
            eq(pettyCashPeriods.status, 'open'),
            sql`${pettyCashPeriods.currentBalance} - ${money(delta)}::numeric >= 0`,
            sql`${pettyCashPeriods.currentBalance} - ${money(delta)}::numeric <= ${String(PETTY_CASH_MAX_BALANCE)}::numeric`,
          ),
        )
        .returning({ id: pettyCashPeriods.id });
      if (!period) {
        return {
          success: false,
          error: 'Jumlah baru tidak bisa dipakai: saldo petty cash tidak cukup, atau periodenya sudah ditutup.',
          status: 409,
        };
      }
    }

    const [updated] = await trx
      .update(pettyCashTransactions)
      .set({
        description,
        actualAmount: money(newActual),
        ...(newImage ? { imageUrl: newImage, imageKey: input.imageKey?.trim() || null } : {}),
        financeReview: 'resubmitted',
        resubmittedAt: now,
        updatedAt: now,
      })
      // Still rejected: if Finance acted in the meantime this simply does nothing.
      .where(and(eq(pettyCashTransactions.id, tx.id), eq(pettyCashTransactions.financeReview, 'rejected')))
      .returning({ id: pettyCashTransactions.id });
    if (!updated) {
      // Roll the balance change back with it.
      throw new Error('REVIEW_CHANGED');
    }
    return { success: true };
  }).catch((err: unknown): ReviewResult => {
    if (err instanceof Error && err.message === 'REVIEW_CHANGED') {
      return { success: false, error: 'Status request berubah. Muat ulang lalu coba lagi.', status: 409 };
    }
    throw err;
  });
  if (!outcome.success) return outcome;

  await createNotificationsForUsers(await financeUserIds(), {
    type: 'petty_cash_tx_resubmitted',
    title: 'Perbaikan petty cash dikirim',
    body: `${storeName}: ${labelOf(tx)} (${rp(newActual)}) sudah diperbaiki PIC 1 — mohon dicek ulang sebelum Refill diverifikasi.`,
    link: '/finance/petty-cash',
    relatedType: 'petty_cash_transaction',
    relatedId: tx.id,
  });

  return { success: true };
}

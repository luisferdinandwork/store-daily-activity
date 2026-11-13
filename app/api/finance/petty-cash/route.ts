// app/api/finance/petty-cash/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { areas, stores } from '@/lib/db/schema/core';
import {
  pettyCashPeriods,
  pettyCashRefills,
  pettyCashTransactions,
} from '@/lib/db/schema/petty-cash';
import { pettyCashDescription } from '@/lib/petty-cash-categories';
import { jakartaDateKey } from '@/lib/day-bucket';
import { getVerifiedThrough } from '@/lib/db/utils/petty-cash-review';
import { categoryIsCodeSql } from '@/lib/db/utils/petty-cash-categories';
import {
  isFinanceReview,
  isLockedByVerification,
  needsFinanceCheck,
  type FinanceReview,
} from '@/lib/petty-cash-review';
import type { StoreStatus } from '@/lib/store-status';

function getJakartaMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;

  return `${year}-${month}`;
}

function isValidMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export type PettyCashTxRow = {
  id: number;
  amount: string;
  actualAmount: string | null;
  description: string;
  categoryName: string | null;
  /** The category's IS (Business Central item no.) — Finance only. */
  isCode: string | null;
  status: string;
  imageUrl: string | null;
  submittedBy: string;
  submittedById: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;

  /** Finance's review of the request (lib/petty-cash-review.ts); null = not reviewed. */
  financeReview: FinanceReview | null;
  /** Finance's comment on its decision, if it left one. */
  financeComment: string | null;
  financeReviewAt: string | null;
  /** The refill of its period has been verified: the amount is locked, Finance can no longer decide on it. */
  locked: boolean;

  /** A Perlu Perbaikan request PIC 1 filed again (lib/petty-cash-re-request.ts). `createdAt` is the day it was filed. */
  isReRequest: boolean;
  /** The day PIC 1 gave as the day the request was made (YYYY-MM-DD); null on a normal request. */
  requestDate: string | null;
  /** For a re-request: the Perlu Perbaikan request it files again (may be from an earlier month). */
  reRequestOf: ReRequestOrigin | null;
  /** For a Perlu Perbaikan request: the re-request that filed it again. */
  reRequestedAs: number | null;
};

export type ReRequestOrigin = {
  id: number;
  categoryName: string | null;
  description: string;
  amount: string;
  imageUrl: string | null;
  createdAt: string;
  month: string;
  financeComment: string | null;
  financeReviewAt: string | null;
};

export type PettyCashStoreRow = {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  /** BC dept code — Finance + IT only. */
  deptCode: string | null;
  /** Store lifecycle (ready_to_open stores are never listed here — they have no petty cash yet). */
  storeStatus: StoreStatus;

  openingBalance: string;
  balance: string;
  closingBalance: string | null;
  periodStatus: 'open' | 'closed';

  /** Sum of the month's requests Finance accepted (Diterima), actual amount — integer Rupiah as text. */
  monthlySpend: string;

  pendingOpsCount: number;
  /** Approved by OPS, PIC 1 has not recorded the actual amount yet. */
  awaitingActualCount: number;
  /** Sent back by Finance (Perlu Perbaikan): drafts PIC 1 is fixing, to go through OPS again. */
  fixingCount: number;
  /** Completed requests Finance has not decided on yet (Pending Finance) — they hold the month back from the Report. */
  pendingFinanceCount: number;
  rejectedCount: number;

  refillIssued: boolean;
  refillAmount: string | null;
  nextYearMonth: string | null;

  transactions: PettyCashTxRow[];
};

export type PettyCashListResponse =
  | { success: true; month: string; data: PettyCashStoreRow[] }
  | { success: false; error: string };

export async function GET(
  req: NextRequest,
): Promise<NextResponse<PettyCashListResponse>> {
  const scope = await resolveFinanceScope();

  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  const currentMonth = getJakartaMonth();
  const month = req.nextUrl.searchParams.get('month') ?? currentMonth;

  if (!isValidMonth(month)) {
    return NextResponse.json(
      { success: false, error: 'Invalid month. Use YYYY-MM.' },
      { status: 400 },
    );
  }

  const storeRows = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
      areaName: areas.name,
      deptCode: stores.deptCode,
      status: stores.status,
    })
    .from(stores)
    .innerJoin(areas, eq(stores.areaId, areas.id))
    // A store that is still getting ready to open has no petty cash yet — it is left out of the whole tab.
    .where(ne(stores.status, 'ready_to_open'))
    .orderBy(stores.name);

  if (storeRows.length === 0) {
    return NextResponse.json({ success: true, month, data: [] });
  }

  const storeIds = storeRows.map((store) => store.id);

  // Exact-month only, deliberately no carry-forward fallback here: this
  // view is a per-month provisioning ledger, not a live balance dashboard.
  // A store only appears in a given month if it actually has a period row
  // for that exact month (created by a completed refill, or — for the very
  // first month a store is ever used — bootstrapped lazily elsewhere). A
  // past month's row is never touched again once a later one exists, so
  // its balance stays exactly as it was; a store that hasn't been refilled
  // this month simply isn't listed here at all.
  const periodRows = await db
    .select()
    .from(pettyCashPeriods)
    .where(and(eq(pettyCashPeriods.yearMonth, month), inArray(pettyCashPeriods.storeId, storeIds)));

  const periodByStore = new Map(periodRows.map((period) => [period.storeId, period]));

  const txRows = await db
    .select({
      id: pettyCashTransactions.id,
      storeId: pettyCashTransactions.storeId,
      amount: pettyCashTransactions.amount,
      actualAmount: pettyCashTransactions.actualAmount,
      description: pettyCashTransactions.description,
      categoryName: pettyCashTransactions.categoryName,
      isCode: categoryIsCodeSql(pettyCashTransactions.categoryId, pettyCashTransactions.categoryName),
      status: pettyCashTransactions.status,
      imageUrl: pettyCashTransactions.imageUrl,
      approvedAt: pettyCashTransactions.approvedAt,
      rejectedAt: pettyCashTransactions.rejectedAt,
      rejectionReason: pettyCashTransactions.rejectionReason,
      createdAt: pettyCashTransactions.createdAt,
      financeReview: pettyCashTransactions.financeReview,
      financeComment: pettyCashTransactions.financeComment,
      financeReviewAt: pettyCashTransactions.financeReviewAt,
      isReRequest: pettyCashTransactions.isReRequest,
      requestDate: pettyCashTransactions.requestDate,
      reRequestOfId: pettyCashTransactions.reRequestOfId,
      submittedById: pettyCashTransactions.userId,
      submitterName: sql<string>`COALESCE((SELECT name FROM users WHERE id = ${pettyCashTransactions.userId}), 'Unknown')`,
    })
    .from(pettyCashTransactions)
    .where(
      and(
        eq(pettyCashTransactions.yearMonth, month),
        inArray(pettyCashTransactions.storeId, storeIds),
      ),
    )
    .orderBy(desc(pettyCashTransactions.createdAt));

  // Re-requests point at a Ditolak request that may sit in another month; Ditolak ones need to know whether
  // somebody filed them again. Both are looked up by id, outside the month filter.
  const originIds = [...new Set(txRows.flatMap((tx) => (tx.reRequestOfId != null ? [tx.reRequestOfId] : [])))];
  const originRows = originIds.length
    ? await db
        .select({
          id: pettyCashTransactions.id,
          categoryName: pettyCashTransactions.categoryName,
          description: pettyCashTransactions.description,
          amount: pettyCashTransactions.amount,
          actualAmount: pettyCashTransactions.actualAmount,
          imageUrl: pettyCashTransactions.imageUrl,
          createdAt: pettyCashTransactions.createdAt,
          yearMonth: pettyCashTransactions.yearMonth,
          financeComment: pettyCashTransactions.financeComment,
          financeReviewAt: pettyCashTransactions.financeReviewAt,
        })
        .from(pettyCashTransactions)
        .where(inArray(pettyCashTransactions.id, originIds))
    : [];
  const originById = new Map(originRows.map((o) => [o.id, o]));

  const filedAgain = txRows.length
    ? await db
        .select({ id: pettyCashTransactions.id, of: pettyCashTransactions.reRequestOfId })
        .from(pettyCashTransactions)
        .where(inArray(pettyCashTransactions.reRequestOfId, txRows.map((tx) => tx.id)))
    : [];
  const reRequestedAs = new Map<number, number>();
  for (const r of filedAgain) if (r.of != null) reRequestedAs.set(r.of, r.id);

  const refillRows = await db
    .select({
      storeId: pettyCashRefills.storeId,
      refillAmount: pettyCashRefills.refillAmount,
      nextYearMonth: pettyCashRefills.nextYearMonth,
    })
    .from(pettyCashRefills)
    .where(eq(pettyCashRefills.yearMonth, month));

  const refillByStore = new Map(refillRows.map((refill) => [refill.storeId, refill]));

  // Per store: the latest period whose refill Finance has verified — requests of that period (or an earlier one)
  // are locked. A request filed while a refill was on its way belongs to the next period and stays open.
  const verifiedThrough = await getVerifiedThrough(storeIds);

  const txByStore = new Map<number, typeof txRows>();

  for (const storeId of storeIds) {
    txByStore.set(storeId, []);
  }

  for (const tx of txRows) {
    txByStore.get(tx.storeId)?.push(tx);
  }

  // A store shows once it has a period row for this month.
  const data: PettyCashStoreRow[] = storeRows
    .filter((store) => periodByStore.has(store.id))
    .map((store) => {
    const period = periodByStore.get(store.id)!;
    const refill = refillByStore.get(store.id) ?? null;
    const txList = txByStore.get(store.id) ?? [];

    // Only 'completed' transactions have actually been deducted from the
    // balance — 'ops_approved' ones are still waiting on the PIC to record
    // the actual amount used, so they don't count as spend yet.
    const completedTx = txList.filter((tx) => tx.status === 'completed');

    // "Used" on Finance's pages adds up only what Finance has accepted (Diterima): a request still Pending Finance
    // is not counted yet, and Perlu Perbaikan / Ditolak never are. (The balance itself is the ledger and still
    // deducts every completed request that is not turned down.)
    const monthlySpend = completedTx
      .filter((tx) => tx.financeReview === 'accepted')
      .reduce((sum, tx) => sum + Number(tx.actualAmount ?? tx.amount), 0);

    const pendingOpsCount = txList.filter((tx) => tx.status === 'pending_ops').length;
    // Approved by OPS, still waiting for PIC 1 to record the actual amount.
    const awaitingActualCount = txList.filter((tx) => tx.status === 'ops_approved').length;
    const fixingCount = txList.filter((tx) => tx.status === 'draft').length;

    // Completed by PIC 1 but not yet checked by Finance (Diterima / Perlu Perbaikan / Ditolak).
    const pendingFinanceCount = txList.filter((tx) => needsFinanceCheck(tx.status, tx.financeReview)).length;

    const rejectedCount = txList.filter((tx) => tx.status === 'ops_rejected').length;

    const balance = period.closingBalance ?? period.currentBalance;

    return {
      storeId: store.id,
      storeNo: store.storeNo,
      storeName: store.name,
      areaName: store.areaName,
      deptCode: store.deptCode,
      storeStatus: store.status,

      openingBalance: period.openingBalance,
      balance,
      closingBalance: period.closingBalance,
      periodStatus: period.status === 'closed' ? 'closed' : 'open',

      monthlySpend: String(monthlySpend),

      pendingOpsCount,
      awaitingActualCount,
      fixingCount,
      pendingFinanceCount,
      rejectedCount,

      refillIssued: Boolean(refill),
      refillAmount: refill?.refillAmount ?? null,
      nextYearMonth: refill?.nextYearMonth ?? null,

      transactions: txList.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        actualAmount: tx.actualAmount,
        description: pettyCashDescription(tx.description),
        categoryName: tx.categoryName,
        isCode: tx.isCode,
        status: tx.status,
        imageUrl: tx.imageUrl,
        submittedBy: tx.submitterName,
        submittedById: tx.submittedById,
        approvedAt: tx.approvedAt ? new Date(tx.approvedAt).toISOString() : null,
        rejectedAt: tx.rejectedAt ? new Date(tx.rejectedAt).toISOString() : null,
        rejectionReason: tx.rejectionReason,
        createdAt: new Date(tx.createdAt).toISOString(),
        financeReview: isFinanceReview(tx.financeReview) ? tx.financeReview : null,
        financeComment: tx.financeComment,
        financeReviewAt: tx.financeReviewAt ? new Date(tx.financeReviewAt).toISOString() : null,
        // Every row here is of this period (`month`).
        locked: isLockedByVerification(month, verifiedThrough.get(store.id)),
        isReRequest: tx.isReRequest,
        requestDate: tx.requestDate ? jakartaDateKey(tx.requestDate) : null,
        reRequestOf: (() => {
          const o = tx.reRequestOfId != null ? originById.get(tx.reRequestOfId) : undefined;
          return o
            ? {
                id: o.id,
                categoryName: o.categoryName,
                description: pettyCashDescription(o.description),
                amount: o.actualAmount ?? o.amount,
                imageUrl: o.imageUrl,
                createdAt: new Date(o.createdAt).toISOString(),
                month: o.yearMonth,
                financeComment: o.financeComment,
                financeReviewAt: o.financeReviewAt ? new Date(o.financeReviewAt).toISOString() : null,
              }
            : null;
        })(),
        reRequestedAs: reRequestedAs.get(tx.id) ?? null,
      })),
    };
  });

  // Stores needing attention first: anything still Pending, then the rest; refilled ones last.
  const rank = (row: PettyCashStoreRow) =>
    row.pendingOpsCount + row.awaitingActualCount + row.fixingCount + row.pendingFinanceCount > 0
      ? 0
      : row.refillIssued
        ? 2
        : 1;

  data.sort((a, b) => {
    const priorityA = rank(a);
    const priorityB = rank(b);

    if (priorityA !== priorityB) return priorityA - priorityB;

    return a.storeName.localeCompare(b.storeName);
  });

  return NextResponse.json({
    success: true,
    month,
    data,
  });
}
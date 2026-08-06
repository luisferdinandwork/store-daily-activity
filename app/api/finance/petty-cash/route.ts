// app/api/finance/petty-cash/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { areas, stores } from '@/lib/db/schema/core';
import {
  pettyCashPeriods,
  pettyCashRefills,
  pettyCashTransactions,
} from '@/lib/db/schema/petty-cash';

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
  description: string;
  status: string;
  imageUrl: string | null;
  submittedBy: string;
  submittedById: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export type PettyCashStoreRow = {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;

  openingBalance: string;
  balance: string;
  closingBalance: string | null;
  periodStatus: 'open' | 'closed';

  monthlySpend: string;

  pendingOpsCount: number;
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
    })
    .from(stores)
    .innerJoin(areas, eq(stores.areaId, areas.id))
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
      description: pettyCashTransactions.description,
      status: pettyCashTransactions.status,
      imageUrl: pettyCashTransactions.imageUrl,
      approvedAt: pettyCashTransactions.approvedAt,
      rejectedAt: pettyCashTransactions.rejectedAt,
      rejectionReason: pettyCashTransactions.rejectionReason,
      createdAt: pettyCashTransactions.createdAt,
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

  const refillRows = await db
    .select({
      storeId: pettyCashRefills.storeId,
      refillAmount: pettyCashRefills.refillAmount,
      nextYearMonth: pettyCashRefills.nextYearMonth,
    })
    .from(pettyCashRefills)
    .where(eq(pettyCashRefills.yearMonth, month));

  const refillByStore = new Map(refillRows.map((refill) => [refill.storeId, refill]));

  const txByStore = new Map<number, typeof txRows>();

  for (const storeId of storeIds) {
    txByStore.set(storeId, []);
  }

  for (const tx of txRows) {
    txByStore.get(tx.storeId)?.push(tx);
  }

  const data: PettyCashStoreRow[] = storeRows
    .filter((store) => periodByStore.has(store.id))
    .map((store) => {
    const period = periodByStore.get(store.id)!;
    const refill = refillByStore.get(store.id) ?? null;
    const txList = txByStore.get(store.id) ?? [];

    const approvedTx = txList.filter((tx) => tx.status === 'ops_approved');

    const monthlySpend = approvedTx.reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );

    const pendingOpsCount = txList.filter((tx) => tx.status === 'pending_ops').length;

    const rejectedCount = txList.filter((tx) => tx.status === 'ops_rejected').length;

    const balance = period.closingBalance ?? period.currentBalance;

    return {
      storeId: store.id,
      storeNo: store.storeNo,
      storeName: store.name,
      areaName: store.areaName,

      openingBalance: period.openingBalance,
      balance,
      closingBalance: period.closingBalance,
      periodStatus: period.status === 'closed' ? 'closed' : 'open',

      monthlySpend: String(monthlySpend),

      pendingOpsCount,
      rejectedCount,

      refillIssued: Boolean(refill),
      refillAmount: refill?.refillAmount ?? null,
      nextYearMonth: refill?.nextYearMonth ?? null,

      transactions: txList.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        description: tx.description,
        status: tx.status,
        imageUrl: tx.imageUrl,
        submittedBy: tx.submitterName,
        submittedById: tx.submittedById,
        approvedAt: tx.approvedAt ? new Date(tx.approvedAt).toISOString() : null,
        rejectedAt: tx.rejectedAt ? new Date(tx.rejectedAt).toISOString() : null,
        rejectionReason: tx.rejectionReason,
        createdAt: new Date(tx.createdAt).toISOString(),
      })),
    };
  });

  data.sort((a, b) => {
    const priorityA = a.pendingOpsCount > 0 ? 0 : a.refillIssued ? 2 : 1;
    const priorityB = b.pendingOpsCount > 0 ? 0 : b.refillIssued ? 2 : 1;

    if (priorityA !== priorityB) return priorityA - priorityB;

    return a.storeName.localeCompare(b.storeName);
  });

  return NextResponse.json({
    success: true,
    month,
    data,
  });
}
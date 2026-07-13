// app/api/ops/performance-targets/[storeId]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets/:storeId?yearMonth=YYYY-MM&period=daily|monthly&date=YYYY-MM-DD
//
// Returns:
//   - the store + area info
//   - the store_monthly_targets "plan" row (monthly sales/transaction target,
//     set directly by Ops; lock state; notes)
//   - the roster (employee_monthly_targets, no amounts) joined with users
//   - for period=daily: each present roster employee's slotCode, default %,
//     effective % (after any override), and the resulting daily
//     sales/transaction target — from computeDailyAllocations()
//   - for period=monthly: each roster employee's month-to-date target,
//     summed from their daily allocations across every day they're
//     scheduled — from computeMonthlyAllocationSummary()
//   - matching ACTUALS from Business Central for the selected period
//
// Access:
//   - OPS HO   → any store
//   - OPS Area → only stores within their assigned area
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, stores } from '@/lib/db/schema';
import { storeMonthlyTargets } from '@/lib/db/schema';
import { getStoreActuals } from '@/lib/performance/employee-actuals';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  computeDailyAllocations,
  computeMonthlyAllocationSummary,
  getStoreMonthlyTarget,
  listStoreRoster,
  toYearMonth,
} from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string }> };

async function loadStore(storeId: number) {
  const [row] = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
      address: stores.address,
      areaId: stores.areaId,
      areaName: areas.name,
    })
    .from(stores)
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(eq(stores.id, storeId))
    .limit(1);

  return row ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw } = await params;
  const storeId = Number(storeIdRaw);

  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid store id.' }, { status: 400 });
  }

  const store = await loadStore(storeId);
  if (!store) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  if (scope.scope === 'area' && store.areaId !== scope.areaId) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: store is outside your assigned area.' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const yearMonth = searchParams.get('yearMonth') ?? toYearMonth(new Date());
  const period = (searchParams.get('period') === 'daily' ? 'daily' : 'monthly') as 'daily' | 'monthly';
  const date = searchParams.get('date') ?? undefined;

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'yearMonth must be in YYYY-MM format.' },
      { status: 400 },
    );
  }

  if (period === 'daily') {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, error: 'date (YYYY-MM-DD) is required when period=daily.' },
        { status: 400 },
      );
    }
    if (!date.startsWith(yearMonth)) {
      return NextResponse.json(
        { success: false, error: 'date must fall within yearMonth.' },
        { status: 400 },
      );
    }
  }

  const [plan] = await db
    .select()
    .from(storeMonthlyTargets)
    .where(
      and(
        eq(storeMonthlyTargets.storeId, storeId),
        eq(storeMonthlyTargets.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  const [storeMonthly, roster, actuals] = await Promise.all([
    getStoreMonthlyTarget({ storeId, yearMonth }),
    listStoreRoster({ storeId, yearMonth }),
    getStoreActuals({ storeNo: store.storeNo, period, date, yearMonth }),
  ]);

  let employeeTargets: Array<{
    id: number;
    userId: string;
    nik: string;
    name: string;
    targetRoleCode: string;
    slotCode: string | null;
    defaultPct: number | null;
    effectivePct: number | null;
    isOverridden: boolean;
    isScheduledToday: boolean;
    displaySalesTarget: number;
    displayTransactionTarget: number;
    actualSales: number;
    actualTransactionCount: number;
  }>;

  let dailyMeta: { headcount: number; usedFallbackEqualSplit: boolean } | null = null;

  if (period === 'daily' && date) {
    const daily = await computeDailyAllocations({ storeId, date, yearMonth });
    dailyMeta = { headcount: daily.headcount, usedFallbackEqualSplit: daily.usedFallbackEqualSplit };

    const rowsByUserId = new Map(daily.rows.map((r) => [r.userId, r]));

    employeeTargets = roster.map((member) => {
      const allocation = rowsByUserId.get(member.userId);
      const actual = actuals.byEmployee.get(member.nik);

      return {
        id: member.id,
        userId: member.userId,
        nik: member.nik,
        name: member.name,
        targetRoleCode: member.targetRoleCode,
        slotCode: allocation?.slotCode ?? null,
        defaultPct: allocation?.defaultPct ?? null,
        effectivePct: allocation?.effectivePct ?? null,
        isOverridden: allocation?.isOverridden ?? false,
        isScheduledToday: Boolean(allocation),
        displaySalesTarget: allocation?.dailySalesTarget ?? 0,
        displayTransactionTarget: allocation?.dailyTransactionTarget ?? 0,
        actualSales: actual?.actualSales ?? 0,
        actualTransactionCount: actual?.actualTransactionCount ?? 0,
      };
    });
  } else {
    const monthly = await computeMonthlyAllocationSummary({ storeId, yearMonth });

    employeeTargets = roster.map((member) => {
      const rollup = monthly.byUserId.get(member.userId);
      const actual = actuals.byEmployee.get(member.nik);

      return {
        id: member.id,
        userId: member.userId,
        nik: member.nik,
        name: member.name,
        targetRoleCode: member.targetRoleCode,
        slotCode: null,
        defaultPct: null,
        effectivePct: null,
        isOverridden: false,
        isScheduledToday: (rollup?.scheduledDays ?? 0) > 0,
        displaySalesTarget: rollup?.monthlySalesTarget ?? 0,
        displayTransactionTarget: rollup?.monthlyTransactionTarget ?? 0,
        actualSales: actual?.actualSales ?? 0,
        actualTransactionCount: actual?.actualTransactionCount ?? 0,
      };
    });
  }

  const storeDisplaySalesTarget = employeeTargets.reduce((sum, row) => sum + row.displaySalesTarget, 0);
  const storeDisplayTransactionTarget = employeeTargets.reduce((sum, row) => sum + row.displayTransactionTarget, 0);

  return NextResponse.json({
    success: true,
    yearMonth,
    period,
    date: date ?? null,
    scope: scope.scope,
    store,
    plan: plan ?? null,
    rollup: {
      storeMonthlyTargetId: storeMonthly.storeMonthlyTargetId,
      storeId,
      yearMonth,
      storeMonthlySalesTarget: storeMonthly.monthlySalesTarget,
      storeMonthlyTransactionTarget: storeMonthly.monthlyTransactionTarget,
      storeMonthlyAtvTarget: storeMonthly.monthlyAtvTarget,
      rosterCount: roster.length,
    },
    dailyMeta,
    employeeTargets,
    actuals: {
      available: actuals.available,
      error: actuals.error,
      storeActualSales: actuals.storeActualSales,
      storeActualTransactionCount: actuals.storeActualTransactionCount,
    },
    storeDisplaySalesTarget,
    storeDisplayTransactionTarget,
  });
}
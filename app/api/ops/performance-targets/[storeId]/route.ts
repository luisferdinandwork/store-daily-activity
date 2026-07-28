// app/api/ops/performance-targets/[storeId]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets/:storeId?yearMonth=YYYY-MM&period=daily|monthly
//
// Returns:
//   - the store + area info
//   - the store_monthly_targets "plan" row (monthly sales/transaction target,
//     set directly by Ops; lock state; notes)
//   - the roster (employee_monthly_targets) joined with users, each with its
//     fixed monthly slotCode/percentage/monthly target/flat daily target —
//     from computeMonthlyRosterAllocations(). Percentages no longer vary by
//     day; `period` only selects which ACTUALS window (today vs
//     month-to-date) to compare targets against.
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
  computeMonthlyRosterAllocations,
  getScheduledUserIdsForStoreDate,
  getStoreMonthlyTarget,
  toDateOnly,
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
  const date = searchParams.get('date') ?? (period === 'daily' ? toDateOnly(new Date()) : undefined);

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'yearMonth must be in YYYY-MM format.' },
      { status: 400 },
    );
  }

  if (period === 'daily' && (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(yearMonth))) {
    return NextResponse.json(
      { success: false, error: 'date (YYYY-MM-DD) within yearMonth is required when period=daily.' },
      { status: 400 },
    );
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

  const [storeMonthly, allocations, actuals, scheduledTodayUserIds] = await Promise.all([
    getStoreMonthlyTarget({ storeId, yearMonth }),
    computeMonthlyRosterAllocations({ storeId, yearMonth }),
    getStoreActuals({ storeNo: store.storeNo, period, date, yearMonth }),
    period === 'daily' && date
      ? getScheduledUserIdsForStoreDate({ storeId, date })
      : Promise.resolve(null),
  ]);

  const employeeTargets = allocations.rows.map((row) => {
    const actual = actuals.byEmployee.get(row.nik);
    const isScheduledToday = scheduledTodayUserIds ? scheduledTodayUserIds.has(row.userId) : true;

    return {
      id: row.employeeMonthlyTargetId,
      userId: row.userId,
      nik: row.nik,
      name: row.name,
      targetRoleCode: row.targetRoleCode,
      slotCode: row.slotCode,
      percentage: row.percentage,
      isPercentageOverridden: row.isPercentageOverridden,
      scheduledDays: row.scheduledDays,
      monthlySalesTarget: row.monthlySalesTarget,
      monthlyTransactionTarget: row.monthlyTransactionTarget,
      dailySalesTarget: row.dailySalesTarget,
      dailyTransactionTarget: row.dailyTransactionTarget,
      isScheduledToday,
      displaySalesTarget:
        period === 'daily' ? (isScheduledToday ? row.dailySalesTarget : 0) : row.monthlySalesTarget,
      displayTransactionTarget:
        period === 'daily'
          ? (isScheduledToday ? row.dailyTransactionTarget : 0)
          : row.monthlyTransactionTarget,
      actualSales: actual?.actualSales ?? 0,
      actualTransactionCount: actual?.actualTransactionCount ?? 0,
    };
  });

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
      rosterCount: allocations.headcount,
    },
    rosterMeta: {
      headcount: allocations.headcount,
      usedFallbackEqualSplit: allocations.usedFallbackEqualSplit,
    },
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

// app/api/ops/performance-targets/[storeId]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets/:storeId?yearMonth=YYYY-MM&period=daily|monthly&date=YYYY-MM-DD
//
// Returns:
//   - the store + area info
//   - the store_monthly_targets "plan" row (if any)
//   - the store rollup (sum of active employee_monthly_targets; ATV always
//     derived from sales/transaction totals)
//   - the list of employee_monthly_targets rows for this store + month,
//     joined with users so the UI can show name/NIK
//   - per-employee + store-level ACTUALS from Business Central for the
//     selected period (daily = a single date, monthly = the whole
//     yearMonth), plus the daily target equivalent (monthly target /
//     scheduled days) when period === 'daily'
//
// Query params:
//   - yearMonth   (required) — which monthly target plan to read targets from.
//   - period      ('daily' | 'monthly', default 'monthly') — which actuals
//                  window to compare against.
//   - date        (YYYY-MM-DD, required when period === 'daily') — the day to
//                  fetch actuals for. Must fall within yearMonth.
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
  calculateDailyTarget,
  getScheduledDaysForEmployeeInStore,
  getStoreMonthlyTargetRollup,
  listStoreEmployeeTargets,
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

  const [rollup, employeeTargets, actuals] = await Promise.all([
    getStoreMonthlyTargetRollup({ storeId, yearMonth }),
    listStoreEmployeeTargets({ storeId, yearMonth }),
    getStoreActuals({
      storeNo: store.storeNo,
      period,
      date,
      yearMonth,
    }),
  ]);

  // For daily view, also compute each employee's daily target (monthly
  // target / scheduled days in month) so the comparison is apples-to-apples.
  const scheduledDaysByUser = new Map<string, number>();

  if (period === 'daily') {
    await Promise.all(
      employeeTargets.map(async (row) => {
        const days = await getScheduledDaysForEmployeeInStore({
          userId: row.userId,
          storeId,
          yearMonth,
        });
        scheduledDaysByUser.set(row.userId, days);
      }),
    );
  }

  const employeeTargetsWithActuals = employeeTargets.map((row) => {
    const actual = actuals.byEmployee.get(row.nik);
    const actualSales = actual?.actualSales ?? 0;
    const actualTransactionCount = actual?.actualTransactionCount ?? 0;

    let displaySalesTarget = row.monthlySalesTarget;
    let displayTransactionTarget = row.monthlyTransactionTarget;

    if (period === 'daily') {
      const days = scheduledDaysByUser.get(row.userId) ?? 0;
      displaySalesTarget = calculateDailyTarget(row.monthlySalesTarget, days);
      displayTransactionTarget = calculateDailyTarget(row.monthlyTransactionTarget, days);
    }

    return {
      ...row,
      actualSales,
      actualTransactionCount,
      displaySalesTarget,
      displayTransactionTarget,
    };
  });

  // Store-level display targets follow the same daily/monthly logic, summed
  // across employees so the footer total stays consistent with the rows.
  const storeDisplaySalesTarget = employeeTargetsWithActuals.reduce(
    (sum, row) => sum + row.displaySalesTarget,
    0,
  );
  const storeDisplayTransactionTarget = employeeTargetsWithActuals.reduce(
    (sum, row) => sum + row.displayTransactionTarget,
    0,
  );

  return NextResponse.json({
    success: true,
    yearMonth,
    period,
    date: date ?? null,
    scope: scope.scope,
    store,
    plan: plan ?? null,
    rollup,
    employeeTargets: employeeTargetsWithActuals,
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
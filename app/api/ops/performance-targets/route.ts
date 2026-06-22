// app/api/ops/performance-targets/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets?yearMonth=YYYY-MM
//
// Returns the store list (scoped to the OPS user's area, or all areas for
// OPS HO) together with each store's monthly target rollup, calculated from
// employee_monthly_targets via getStoreMonthlyTargetRollup().
//
// Used by the /ops/performance-targets overview page (left list + summary).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, stores, storeMonthlyTargets } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  getStoreMonthlyTargetRollup,
  toYearMonth,
} from '@/lib/performance/target-utils';

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();

  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { searchParams } = new URL(req.url);
  const yearMonth = searchParams.get('yearMonth') ?? toYearMonth(new Date());

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'yearMonth must be in YYYY-MM format.' },
      { status: 400 },
    );
  }

  // ── Resolve store list based on scope ──────────────────────────────────────
  const storeRows = scope.scope === 'all_areas'
    ? await db
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
        .orderBy(asc(areas.name), asc(stores.name))
    : await db
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
        .where(eq(stores.areaId, scope.areaId))
        .orderBy(asc(stores.name));

  // ── Rollup per store for the requested month ────────────────────────────────
  const rollups = await Promise.all(
    storeRows.map((store) =>
      getStoreMonthlyTargetRollup({ storeId: store.id, yearMonth }),
    ),
  );

  // ── Lock status per store for the requested month (bulk fetch) ─────────────
  const storeIds = storeRows.map((s) => s.id);
  const planRows = storeIds.length > 0
    ? await db
        .select({
          storeId: storeMonthlyTargets.storeId,
          isLocked: storeMonthlyTargets.isLocked,
        })
        .from(storeMonthlyTargets)
        .where(
          and(
            inArray(storeMonthlyTargets.storeId, storeIds),
            eq(storeMonthlyTargets.yearMonth, yearMonth),
          ),
        )
    : [];

  const lockByStoreId = new Map(planRows.map((p) => [p.storeId, p.isLocked]));

  const storesWithRollup = storeRows.map((store, i) => ({
    ...store,
    rollup: rollups[i],
    isLocked: lockByStoreId.get(store.id) ?? false,
  }));

  // ── Aggregate summary across visible stores ────────────────────────────────
  const summary = storesWithRollup.reduce(
    (acc, s) => {
      acc.storeMonthlySalesTarget += s.rollup.storeMonthlySalesTarget;
      acc.storeMonthlyTransactionTarget += s.rollup.storeMonthlyTransactionTarget;
      acc.employeeTargetCount += s.rollup.employeeTargetCount;
      acc.storeCount += 1;
      if (s.rollup.storeMonthlyTargetId != null) acc.plannedStoreCount += 1;
      return acc;
    },
    {
      storeMonthlySalesTarget: 0,
      storeMonthlyTransactionTarget: 0,
      employeeTargetCount: 0,
      storeCount: 0,
      plannedStoreCount: 0,
    },
  );

  return NextResponse.json({
    success: true,
    yearMonth,
    scope: scope.scope,
    areaId: scope.areaId,
    summary,
    stores: storesWithRollup,
  });
}
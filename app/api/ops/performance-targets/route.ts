// app/api/ops/performance-targets/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets?yearMonth=YYYY-MM
//
// Store list for the left-hand rail of /ops/performance-targets, grouped by
// area for OPS HO or flat for OPS Area. Each store's rollup now reads
// directly from store_monthly_targets (Ops-set monthly target) instead of
// summing employee rows.
//
// NOTE: this file wasn't part of the files you shared, so it's a best-effort
// rewrite inferred from how app/ops/performance-targets/page.tsx consumes
// `OverviewResponse` / `StoreRow` / `StoreRollup`. Double check it against
// whatever this route currently does in your repo before replacing it.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, storeMonthlyTargets, stores } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { listStoreRoster, toYearMonth } from '@/lib/performance/target-utils';

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

  const storeRows = await db
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
    .where(scope.scope === 'area' ? eq(stores.areaId, scope.areaId) : undefined);

  const plans = await db
    .select()
    .from(storeMonthlyTargets)
    .where(eq(storeMonthlyTargets.yearMonth, yearMonth));

  const planByStoreId = new Map(plans.map((p) => [p.storeId, p]));

  const stores_ = await Promise.all(
    storeRows.map(async (store) => {
      const plan = planByStoreId.get(store.id) ?? null;
      const roster = await listStoreRoster({ storeId: store.id, yearMonth });

      const monthlySalesTarget = Number(plan?.monthlySalesTarget ?? 0);
      const monthlyTransactionTarget = Number(plan?.monthlyTransactionTarget ?? 0);

      return {
        id: store.id,
        storeNo: store.storeNo,
        name: store.name,
        address: store.address,
        areaId: store.areaId,
        areaName: store.areaName,
        rollup: {
          storeMonthlyTargetId: plan?.id ?? null,
          storeId: store.id,
          yearMonth,
          storeMonthlySalesTarget: monthlySalesTarget,
          storeMonthlyTransactionTarget: monthlyTransactionTarget,
          storeMonthlyAtvTarget: monthlyTransactionTarget > 0
            ? Math.round(monthlySalesTarget / monthlyTransactionTarget)
            : 0,
          rosterCount: roster.length,
        },
        isLocked: plan?.isLocked ?? false,
      };
    }),
  );

  const summary = stores_.reduce(
    (acc, store) => ({
      storeMonthlySalesTarget: acc.storeMonthlySalesTarget + store.rollup.storeMonthlySalesTarget,
      storeMonthlyTransactionTarget: acc.storeMonthlyTransactionTarget + store.rollup.storeMonthlyTransactionTarget,
      rosterCount: acc.rosterCount + store.rollup.rosterCount,
      storeCount: acc.storeCount + 1,
      plannedStoreCount: acc.plannedStoreCount + (store.rollup.storeMonthlyTargetId != null ? 1 : 0),
    }),
    { storeMonthlySalesTarget: 0, storeMonthlyTransactionTarget: 0, rosterCount: 0, storeCount: 0, plannedStoreCount: 0 },
  );

  return NextResponse.json({
    success: true,
    yearMonth,
    scope: scope.scope,
    areaId: scope.scope === 'area' ? scope.areaId : null,
    summary,
    stores: stores_,
  });
}
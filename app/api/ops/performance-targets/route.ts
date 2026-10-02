// app/api/ops/performance-targets/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets?yearMonth=YYYY-MM
//
// Every store in scope with its month rollup: the Ops-set monthly target
// (store_monthly_targets), Team size, and Business Central actuals. OPS HO sees
// all areas, OPS Area only their own. The page filters, sorts and totals this
// list client-side (lib/performance/target-view.ts); `status` is the store's
// lifecycle so closed stores can be hidden there.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, storeMonthlyTargets, stores } from '@/lib/db/schema';
import { getStoreActuals } from '@/lib/performance/employee-actuals';
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
      status: stores.status,
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
      const [roster, actuals] = await Promise.all([
        listStoreRoster({ storeId: store.id, yearMonth }),
        getStoreActuals({ storeNo: store.storeNo, period: 'monthly', yearMonth }),
      ]);

      const monthlySalesTarget = Number(plan?.monthlySalesTarget ?? 0);
      const monthlyTransactionTarget = Number(plan?.monthlyTransactionTarget ?? 0);

      return {
        id: store.id,
        storeNo: store.storeNo,
        name: store.name,
        address: store.address,
        areaId: store.areaId,
        areaName: store.areaName,
        status: store.status,
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
          storeActualSales: actuals.storeActualSales,
          storeActualTransactionCount: actuals.storeActualTransactionCount,
          actualsAvailable: actuals.available,
        },
      };
    }),
  );

  return NextResponse.json({
    success: true,
    yearMonth,
    scope: scope.scope,
    areaId: scope.scope === 'area' ? scope.areaId : null,
    stores: stores_,
  });
}
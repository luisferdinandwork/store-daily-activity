// app/api/ops/impact-visits/route.ts
//
// GET  — list Impact Visits, area-scoped via resolveOpsScope() (same helper
//        already used by /api/ops/stores): ops_area sees only visits for
//        stores in their own area, ops_ho sees every area. Optional
//        ?storeId= filter.
// POST — create a draft visit for a store. ops_area may only start a visit
//        for a store in their own area (403 otherwise); ops_ho may target
//        any store.

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, stores, areas, users } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  computeImpactVisitPermissionFlags,
  serializeImpactVisit,
} from '@/lib/db/utils/impact-visits';
import { emptyCashMoneyData } from '@/lib/impact-visit/checklist-config';

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const storeIdParam = req.nextUrl.searchParams.get('storeId');
  const conditions = [];

  if (scope.scope === 'area') {
    conditions.push(eq(stores.areaId, scope.areaId));
  }
  if (storeIdParam) {
    const storeId = Number(storeIdParam);
    if (Number.isInteger(storeId) && storeId > 0) {
      conditions.push(eq(impactVisits.storeId, storeId));
    }
  }

  const rows = await db
    .select({
      visit: impactVisits,
      storeName: stores.name,
      storeNo: stores.storeNo,
      areaName: areas.name,
      visitorName: users.name,
    })
    .from(impactVisits)
    .innerJoin(stores, eq(impactVisits.storeId, stores.id))
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .leftJoin(users, eq(impactVisits.visitedBy, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(impactVisits.visitDate));

  const isHO = scope.scope === 'all_areas';

  const out = rows.map((row) => ({
    ...serializeImpactVisit(row.visit),
    ...computeImpactVisitPermissionFlags(row.visit, { userId: scope.userId, isHO }),
    store: { name: row.storeName, storeNo: row.storeNo },
    areaName: row.areaName,
    visitorName: row.visitorName,
  }));

  return NextResponse.json({ success: true, isHO, visits: out });
}

export async function POST(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => ({}));
  const storeId = Number(body.storeId);

  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'A store is required.' }, { status: 400 });
  }

  const [store] = await db
    .select({ id: stores.id, areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  if (scope.scope === 'area' && store.areaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'That store is outside your area.' }, { status: 403 });
  }

  const visitDate = body.visitDate ? new Date(body.visitDate) : new Date();

  const [created] = await db
    .insert(impactVisits)
    .values({
      storeId,
      visitedBy: scope.userId,
      visitDate,
      cashMoneyData: JSON.stringify(emptyCashMoneyData()),
      updatedAt: new Date(),
    })
    .returning();

  return NextResponse.json({
    success: true,
    visit: {
      ...serializeImpactVisit(created),
      ...computeImpactVisitPermissionFlags(created, { userId: scope.userId, isHO: scope.scope === 'all_areas' }),
    },
  }, { status: 201 });
}

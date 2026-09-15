// app/api/ops/impact-visits/[id]/geo/route.ts
//
// POST — capture the geo-tag for an On Location impact visit. Hard-blocks
// (422) if the submitted point is outside the store's own geofence, reusing
// the same check employee task submissions use (lib/db/utils/tasks.ts).

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, stores, areas } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { computeImpactVisitPermissionFlags, serializeImpactVisit } from '@/lib/db/utils/impact-visits';
import { assertInGeofence } from '@/lib/db/utils/tasks';

async function loadVisitWithStoreArea(id: number) {
  const [row] = await db
    .select({
      visit: impactVisits,
      storeAreaId: stores.areaId,
      storeName: stores.name,
      storeNo: stores.storeNo,
      areaName: areas.name,
    })
    .from(impactVisits)
    .innerJoin(stores, eq(impactVisits.storeId, stores.id))
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .where(eq(impactVisits.id, id))
    .limit(1);
  return row ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const found = await loadVisitWithStoreArea(visitId);
  if (!found) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  if (scope.scope === 'area' && found.storeAreaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'Out of your area' }, { status: 403 });
  }

  const isHO = scope.scope === 'all_areas';
  const { canEdit } = computeImpactVisitPermissionFlags(found.visit, { userId: scope.userId, isHO });
  if (!canEdit) {
    return NextResponse.json(
      { success: false, error: found.visit.status !== 'draft' ? 'This visit has already been submitted.' : 'Forbidden' },
      { status: 409 },
    );
  }

  if (found.visit.visitType !== 'on_location') {
    return NextResponse.json({ success: false, error: 'This visit is not an On Location visit.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ success: false, error: 'lat and lng are required.' }, { status: 400 });
  }

  const geoErr = await assertInGeofence(found.visit.storeId, { lat, lng });
  if (geoErr) {
    return NextResponse.json({ success: false, error: geoErr }, { status: 422 });
  }

  const [updated] = await db
    .update(impactVisits)
    .set({ visitLat: String(lat), visitLng: String(lng), updatedAt: new Date() })
    .where(eq(impactVisits.id, visitId))
    .returning();

  return NextResponse.json({
    success: true,
    visit: {
      ...serializeImpactVisit(updated),
      ...computeImpactVisitPermissionFlags(updated, { userId: scope.userId, isHO }),
      store: { name: found.storeName, storeNo: found.storeNo },
      areaName: found.areaName,
    },
  });
}

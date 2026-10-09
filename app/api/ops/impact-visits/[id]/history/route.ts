// app/api/ops/impact-visits/[id]/history/route.ts
//
// GET — the store's earlier submitted Impact Visits (before this one, latest
// first), each with the items answered "tidak" and Ops's notes: the side panel
// the visitor checks while filling the next visit. Area-scoped like the visit.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, stores } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { listPreviousImpactVisitResults } from '@/lib/db/utils/impact-visit-results';

export async function GET(
  _req: NextRequest,
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

  const [found] = await db
    .select({
      id: impactVisits.id,
      storeId: impactVisits.storeId,
      visitDate: impactVisits.visitDate,
      storeAreaId: stores.areaId,
    })
    .from(impactVisits)
    .innerJoin(stores, eq(impactVisits.storeId, stores.id))
    .where(eq(impactVisits.id, visitId))
    .limit(1);

  if (!found) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  if (scope.scope === 'area' && found.storeAreaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'Out of your area' }, { status: 403 });
  }

  try {
    const visits = await listPreviousImpactVisitResults(found);
    return NextResponse.json({ success: true, visits });
  } catch (err) {
    console.error('[GET /api/ops/impact-visits/[id]/history]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

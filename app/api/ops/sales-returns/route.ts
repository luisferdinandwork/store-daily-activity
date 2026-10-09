// app/api/ops/sales-returns/route.ts
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&areaId=][&storeId=][&q=][&page=] — sales
// returns filed in the period (Jakarta days, both ends inclusive), newest first,
// 50 per page. Scoped: ops_area sees only their area's stores (areaId is ignored),
// ops_ho / IT see every store and may narrow to one area.

import { NextRequest, NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { getSalesReturns } from '@/lib/db/utils/sales-returns';
import { parseSalesReturnQuery } from '@/lib/sales-returns';

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const query = parseSalesReturnQuery(req.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ success: false, error: query.error }, { status: 400 });

  try {
    const data = await getSalesReturns({
      ...query,
      areaId: scope.scope === 'area' ? scope.areaId : query.areaId,
      pickableAreaId: scope.scope === 'area' ? scope.areaId : null,
    });
    return NextResponse.json({ success: true, scope: scope.scope, ...data });
  } catch (err) {
    console.error('[GET /api/ops/sales-returns]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

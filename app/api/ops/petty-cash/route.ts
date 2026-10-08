// app/api/ops/petty-cash/route.ts
//
// GET ?month=YYYY-MM — petty cash spending requests for Ops' Requests page:
// those filed in that Jakarta month plus every one still waiting on Ops.
// Scoped: ops_area sees only their area's stores, ops_ho / IT see all.
// Approve / reject lives at PATCH /api/ops/petty-cash/[txId].

import { NextRequest, NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { getOpsRequestRows } from '@/lib/db/utils/petty-cash-ops';
import { isValidMonth } from '@/lib/ops-petty-cash';
import { currentYearMonthJakarta } from '@/lib/db/utils/petty-cash-refill';

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();

  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  const month = req.nextUrl.searchParams.get('month') ?? currentYearMonthJakarta();

  if (!isValidMonth(month)) {
    return NextResponse.json(
      { success: false, error: 'Invalid month. Use YYYY-MM.' },
      { status: 400 },
    );
  }

  const data = await getOpsRequestRows({ areaId: scope.areaId, month });

  return NextResponse.json({
    success: true,
    month,
    scope: scope.scope,
    areaId: scope.areaId,
    data,
  });
}

// app/api/ops/petty-cash/refill-requests/route.ts
//
// GET ?month=YYYY-MM — refill requests for Ops' Refills page: those filed in
// that Jakarta month plus every one still waiting on Ops, each with the balance
// left, what the store used since its last refill, the refill it needs and the
// items behind it. Scoped: ops_area sees only their area's stores, ops_ho / IT
// see all. Approve / reject lives at PATCH /api/ops/petty-cash/refill-requests/[id].

import { NextRequest, NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { PETTY_CASH_MAX_BALANCE } from '@/lib/db/schema/petty-cash';
import { getOpsRefillRows } from '@/lib/db/utils/petty-cash-ops';
import { currentYearMonthJakarta } from '@/lib/db/utils/petty-cash-refill';
import { isValidMonth } from '@/lib/ops-petty-cash';

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const month = req.nextUrl.searchParams.get('month') ?? currentYearMonthJakarta();
  if (!isValidMonth(month)) {
    return NextResponse.json({ success: false, error: 'Invalid month. Use YYYY-MM.' }, { status: 400 });
  }

  const requests = await getOpsRefillRows({ areaId: scope.areaId, month });

  return NextResponse.json({
    success: true,
    month,
    scope: scope.scope,
    areaId: scope.areaId,
    maxBalance: PETTY_CASH_MAX_BALANCE,
    requests,
  });
}

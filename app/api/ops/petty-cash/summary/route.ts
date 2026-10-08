// app/api/ops/petty-cash/summary/route.ts
//
// GET — how many spending requests and refill requests are waiting on Ops (any
// month), for the count badges on the Requests / Refills tabs. Same area scope
// as the pages themselves.

import { NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { countPendingForOps } from '@/lib/db/utils/petty-cash-ops';

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const pending = await countPendingForOps(scope.areaId);
  return NextResponse.json({ success: true, pending });
}

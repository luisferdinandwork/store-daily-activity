// app/api/ops/petty-cash/refill-requests/route.ts
//
// GET — refill requests, scoped: ops_area sees only their area's stores,
// ops_ho sees all. Read-only — only Finance approves/rejects.

import { NextResponse } from 'next/server';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { listRefillRequestsForAreas } from '@/lib/db/utils/petty-cash-refill';

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const requests = await listRefillRequestsForAreas(scope.scope === 'area' ? [scope.areaId] : null);
  return NextResponse.json({ success: true, requests });
}

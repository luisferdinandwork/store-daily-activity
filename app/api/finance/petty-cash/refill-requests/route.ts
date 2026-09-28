// app/api/finance/petty-cash/refill-requests/route.ts
//
// GET — all petty cash refill requests (all stores; Finance has no area
// scoping). Read-only — OPS approves/rejects at
// PATCH /api/ops/petty-cash/refill-requests/[id]; Finance just sees the
// money and can privately mark ones they've physically refilled (client-only,
// see app/finance/petty-cash/page.tsx).

import { NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { listRefillRequestsForFinance } from '@/lib/db/utils/petty-cash-refill';

export async function GET() {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  // Well above the ~50-store fleet: the monitor picks the live request per
  // store out of this list, so it must not be cut off before older stores.
  const requests = await listRefillRequestsForFinance(500);
  return NextResponse.json({ success: true, requests });
}

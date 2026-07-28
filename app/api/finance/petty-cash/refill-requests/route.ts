// app/api/finance/petty-cash/refill-requests/route.ts
//
// GET — all petty cash refill requests (all stores; Finance has no area scoping).

import { NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { listRefillRequestsForFinance } from '@/lib/db/utils/petty-cash-refill';

export async function GET() {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const requests = await listRefillRequestsForFinance();
  return NextResponse.json({ success: true, requests });
}

// app/api/finance/sales-returns/route.ts
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&storeId=][&q=][&page=] — every sales return
// filed in the period (Jakarta days, both ends inclusive) across all stores,
// newest first, 50 per page. Defaults to this month so far. `q` matches the
// receipt number, the uploader, or the store's name / code.

import { NextRequest, NextResponse } from 'next/server';

import { resolveFinanceScope } from '@/lib/finance/scope';
import { getSalesReturns } from '@/lib/db/utils/sales-returns';
import { parseSalesReturnQuery, type SalesReturnsPage } from '@/lib/sales-returns';

export type FinanceSalesReturnsResponse =
  | ({ success: true } & SalesReturnsPage)
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<FinanceSalesReturnsResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const query = parseSalesReturnQuery(req.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ success: false, error: query.error }, { status: 400 });

  try {
    // Finance sees every store: no area pinning.
    const data = await getSalesReturns({ ...query, areaId: null });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[GET /api/finance/sales-returns]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

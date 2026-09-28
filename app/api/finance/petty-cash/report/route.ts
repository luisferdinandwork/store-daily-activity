// app/api/finance/petty-cash/report/route.ts
//
// GET ?month=YYYY-MM — every store's petty cash usage for the month plus the
// bank account its PIC 1 gave for refills. Grouping by store code is done by
// the caller (lib/petty-cash-report.ts).

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getPettyCashReport } from '@/lib/db/utils/petty-cash-report';
import { currentYearMonthJakarta } from '@/lib/db/utils/petty-cash-refill';
import type { PettyCashReportRow } from '@/lib/petty-cash-report';

export type PettyCashReportResponse =
  | { success: true; month: string; data: PettyCashReportRow[] }
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<PettyCashReportResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const month = req.nextUrl.searchParams.get('month') ?? currentYearMonthJakarta();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ success: false, error: 'Invalid month. Use YYYY-MM.' }, { status: 400 });
  }

  const data = await getPettyCashReport(month);
  return NextResponse.json({ success: true, month, data });
}

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

// Only store-months Monitoring has finished (see lib/petty-cash-report.ts → isStoreMonthComplete); `incompleteCount`
// says how many more are still open there.
export type PettyCashReportResponse =
  | { success: true; month: string; data: PettyCashReportRow[]; incompleteCount: number }
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

  const { rows, incompleteCount } = await getPettyCashReport(month);
  return NextResponse.json({ success: true, month, data: rows, incompleteCount });
}

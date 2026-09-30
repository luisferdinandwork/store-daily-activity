// app/api/finance/setoran/report/route.ts
//
// GET ?month=YYYY-MM — every store's setoran totals for the month (work days,
// submitted / missed days, received, deposited, remaining balance, unverified).
// Grouping by store code is done by the caller (lib/setoran-review.ts).

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getSetoranMonth } from '@/lib/db/utils/setoran-review';
import { todayJakarta, type SetoranMonthRow } from '@/lib/setoran-review';

export type SetoranMonthResponse =
  | { success: true; month: string; data: SetoranMonthRow[] }
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<SetoranMonthResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const today = todayJakarta();
  const month = req.nextUrl.searchParams.get('month') ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ success: false, error: 'Invalid month. Use YYYY-MM.' }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, month, data: await getSetoranMonth(month, today) });
  } catch (err) {
    console.error('[GET /api/finance/setoran/report]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

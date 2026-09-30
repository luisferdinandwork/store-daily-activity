// app/api/finance/uang-modal/report/route.ts
//
// GET ?month=YYYY-MM — every store's uang modal for the month: work days,
// full / short / empty / missed days, fill rate, shortfall, unverified.
// Grouping by store code is done by the caller (lib/finance/code-groups.ts).

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getUangModalMonth } from '@/lib/db/utils/uang-modal-review';
import { monthBounds, todayJakarta, type UangModalMonthRow } from '@/lib/uang-modal-review';

export type UangModalMonthResponse =
  | { success: true; month: string; data: UangModalMonthRow[] }
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<UangModalMonthResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const today = todayJakarta();
  const month = req.nextUrl.searchParams.get('month') ?? today.slice(0, 7);
  if (!monthBounds(month)) {
    return NextResponse.json({ success: false, error: 'Invalid month. Use YYYY-MM.' }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, month, data: await getUangModalMonth(month, today) });
  } catch (err) {
    console.error('[GET /api/finance/uang-modal/report]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

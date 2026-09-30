// app/api/finance/uang-modal/route.ts
//
// GET /api/finance/uang-modal?date=YYYY-MM-DD
//
// One UangModalRow per store that opened that day (see getUangModalDay): the
// cash it counted against the daily cap and the denominations behind it.
// Finance/IT only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getUangModalDay } from '@/lib/db/utils/uang-modal-review';
import { dayBounds, todayJakarta, type UangModalRow } from '@/lib/uang-modal-review';

export type UangModalDayResponse =
  | { success: true; date: string; data: UangModalRow[] }
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<UangModalDayResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const date = req.nextUrl.searchParams.get('date') ?? todayJakarta();
  if (!dayBounds(date)) {
    return NextResponse.json(
      { success: false, error: 'Invalid date parameter. Expected YYYY-MM-DD.' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ success: true, date, data: await getUangModalDay(date) });
  } catch (err) {
    console.error('[GET /api/finance/uang-modal]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

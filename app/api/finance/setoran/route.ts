// app/api/finance/setoran/route.ts
//
// GET /api/finance/setoran?date=YYYY-MM-DD
//
// One SetoranStoreRow per store that opened that day (see getSetoranDay).
// Finance/IT only — the response carries every store's money figures, staff
// names and the receipt / ATM-card photo URLs.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getSetoranDay } from '@/lib/db/utils/setoran-review';
import { dayBounds, todayJakarta, type SetoranStoreRow } from '@/lib/setoran-review';

export type SetoranDayResponse =
  | { success: true; date: string; data: SetoranStoreRow[] }
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<SetoranDayResponse>> {
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
    return NextResponse.json({ success: true, date, data: await getSetoranDay(date) });
  } catch (err) {
    console.error('[GET /api/finance/setoran]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// app/api/finance/store-closing/route.ts
//
// GET /api/finance/store-closing?date=YYYY-MM-DD
//
// { rows, holds } — `rows` are the stores scheduled to close that day (with the
// Z-Report & EDC Settlement photo and whether the Open Statement was posted or
// put on hold); `holds` are every statement still on hold, whatever its date.
// Finance/IT only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getStoreClosingDay, getStoreClosingHolds } from '@/lib/db/utils/store-closing-review';
import { dayBounds, todayJakarta, type StoreClosingRow } from '@/lib/store-closing-review';

export type StoreClosingResponse =
  | { success: true; date: string; rows: StoreClosingRow[]; holds: StoreClosingRow[] }
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<StoreClosingResponse>> {
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
    const [rows, holds] = await Promise.all([getStoreClosingDay(date), getStoreClosingHolds()]);
    return NextResponse.json({ success: true, date, rows, holds });
  } catch (err) {
    console.error('[GET /api/finance/store-closing]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

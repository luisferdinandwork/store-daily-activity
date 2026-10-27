// app/api/finance/store-sheet/day/route.ts
//
// GET ?storeId=&date=YYYY-MM-DD
//
// The detail behind one row of "Rekap per Toko": that store's Store Closing of the sales
// day `date` (who submitted, every bank × method, Z-Report + Indodana photos) and the Setoran
// submitted the morning after (who, cash figures, proof photos, notes, verification).
// See lib/store-money-detail.ts. Finance/IT only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { isIsoDay } from '@/lib/finance/dates';
import { getStoreDayDetail } from '@/lib/db/utils/store-day-detail';
import type { StoreDayDetail } from '@/lib/store-money-detail';

export type StoreDayResponse =
  | { success: true; detail: StoreDayDetail }
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<StoreDayResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const date = req.nextUrl.searchParams.get('date') ?? '';
  const storeId = Number(req.nextUrl.searchParams.get('storeId'));
  if (!isIsoDay(date)) {
    return NextResponse.json({ success: false, error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 });
  }
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid storeId.' }, { status: 400 });
  }

  try {
    const detail = await getStoreDayDetail(storeId, date);
    if (!detail) return NextResponse.json({ success: false, error: 'Toko tidak ditemukan.' }, { status: 404 });
    return NextResponse.json({ success: true, detail });
  } catch (err) {
    console.error('[GET /api/finance/store-sheet/day]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// app/api/finance/store-sheet/route.ts
//
// GET [?storeId=][&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
// Behind "Daily Report All Store": every store for the picker, and once `storeId` is given, that
// store's days in the period — the card money per bank × method from each day's Store
// Closing plus the cash from the Setoran submitted the morning after (see
// lib/store-closing-money.ts). Both days inclusive, at most MONEY_MAX_DAYS apart; defaults
// to this month so far. Finance/IT only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getStoreMoneySheet } from '@/lib/db/utils/store-closing-money';
import { parseMoneyQuery, todayJakarta } from '@/lib/store-closing-money';
import type { StoreMoneySheet } from '@/lib/store-money-sheet';

export type StoreSheetResponse = ({ success: true } & StoreMoneySheet) | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<StoreSheetResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const today = todayJakarta();
  const query = parseMoneyQuery(req.nextUrl.searchParams, { from: `${today.slice(0, 8)}01`, to: today });
  if (!query.ok) return NextResponse.json({ success: false, error: query.error }, { status: 400 });

  try {
    const sheet = await getStoreMoneySheet(query.storeId, query.from, query.to);
    if (!sheet) return NextResponse.json({ success: false, error: 'Toko tidak ditemukan.' }, { status: 404 });
    return NextResponse.json({ success: true, ...sheet });
  } catch (err) {
    console.error('[GET /api/finance/store-sheet]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

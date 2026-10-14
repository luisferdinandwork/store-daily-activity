// app/api/finance/store-closing/money/route.ts
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&storeId=]
//
// The Store Closing · Report: one row per store per sales day with the card money
// from that day's Store Closing and the cash from the Setoran submitted the next
// morning (see lib/store-closing-money.ts). Both days inclusive, at most
// MONEY_MAX_DAYS apart; defaults to this month so far. Finance/IT only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getClosingMoneyReport } from '@/lib/db/utils/store-closing-money';
import { parseMoneyQuery, todayJakarta, type ClosingMoneyReport } from '@/lib/store-closing-money';

export type ClosingMoneyResponse =
  | ({ success: true } & ClosingMoneyReport)
  | { success: false; error: string };

export async function GET(req: NextRequest): Promise<NextResponse<ClosingMoneyResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const today = todayJakarta();
  const query = parseMoneyQuery(req.nextUrl.searchParams, { from: `${today.slice(0, 8)}01`, to: today });
  if (!query.ok) return NextResponse.json({ success: false, error: query.error }, { status: 400 });

  try {
    const report = await getClosingMoneyReport(query.from, query.to, query.storeId);
    return NextResponse.json({ success: true, ...report });
  } catch (err) {
    console.error('[GET /api/finance/store-closing/money]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// app/api/finance/petty-cash/transactions/route.ts
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&storeId=][&status=][&page=] — every petty
// cash request made in the period (Jakarta days, both ends inclusive), newest
// first, 50 per page. Defaults to this month so far.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getPettyCashTransactions } from '@/lib/db/utils/petty-cash-transactions';
import { parseTransactionQuery, type TransactionsPage } from '@/lib/petty-cash-transactions';

export type PettyCashTransactionsResponse =
  | ({ success: true } & TransactionsPage)
  | { success: false; error: string };

const bad = (error: string) =>
  NextResponse.json<PettyCashTransactionsResponse>({ success: false, error }, { status: 400 });

export async function GET(req: NextRequest): Promise<NextResponse<PettyCashTransactionsResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const query = parseTransactionQuery(req.nextUrl.searchParams);
  if (!query.ok) return bad(query.error);

  const data = await getPettyCashTransactions(query);

  return NextResponse.json({ success: true, ...data });
}

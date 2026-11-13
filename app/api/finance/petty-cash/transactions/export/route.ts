// app/api/finance/petty-cash/transactions/export/route.ts
//
// GET — the same query string as the Transactions list (period, search, area, store, status, category, Finance
// decision, Re-request, receipt photo, amount range, sort; lib/petty-cash-transactions.ts → parseTransactionQuery)
// → "Petty cash transaction.xlsx": every matching request (not just the page on screen), in the page's order, laid
// out as Business Central Purchase Invoice lines (lib/petty-cash-transactions-xlsx.ts).

import { NextRequest, NextResponse } from 'next/server';

import { resolveFinanceScope } from '@/lib/finance/scope';
import { getPettyCashTransactionsForExport } from '@/lib/db/utils/petty-cash-transactions';
import { parseTransactionQuery } from '@/lib/petty-cash-transactions';
import { PETTY_CASH_EXPORT_NAME, buildTransactionsWorkbook } from '@/lib/petty-cash-transactions-xlsx';

export async function GET(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const query = parseTransactionQuery(req.nextUrl.searchParams);
  if (!query.ok) {
    return NextResponse.json({ success: false, error: query.error }, { status: 400 });
  }

  try {
    const rows = await getPettyCashTransactionsForExport(query);
    const buffer = buildTransactionsWorkbook(rows);
    const filename = `${PETTY_CASH_EXPORT_NAME}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/finance/petty-cash/transactions/export]', err);
    return NextResponse.json({ success: false, error: 'Failed to generate export.' }, { status: 500 });
  }
}

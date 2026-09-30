// app/api/finance/petty-cash/transactions/export/route.ts
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&storeId=][&status=] — the Petty Cash
// Transactions list as a styled .xlsx: the same filters as the page (store,
// period, status), but every matching row instead of one page.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getPettyCashTransactionsForExport, getStoreOption } from '@/lib/db/utils/petty-cash-transactions';
import { parseTransactionQuery } from '@/lib/petty-cash-transactions';
import { buildTransactionsWorkbook } from '@/lib/petty-cash-transactions-xlsx';

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
    const [session, rows, store] = await Promise.all([
      getServerSession(authOptions),
      getPettyCashTransactionsForExport(query),
      query.storeId != null ? getStoreOption(query.storeId) : Promise.resolve(null),
    ]);
    if (query.storeId != null && !store) {
      return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
    }

    const buffer = buildTransactionsWorkbook({
      from: query.from,
      to: query.to,
      storeLabel: store ? `${store.storeNo} · ${store.name}` : null,
      status: query.status,
      rows,
      exportedBy: session?.user?.name ?? scope.userId,
    });

    const period = query.from === query.to ? query.from : `${query.from}_${query.to}`;
    const filename =
      ['petty-cash-transaksi', period, store?.storeNo, query.status]
        .filter(Boolean)
        .join('_')
        .replace(/[^\w.-]+/g, '-') + '.xlsx';

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

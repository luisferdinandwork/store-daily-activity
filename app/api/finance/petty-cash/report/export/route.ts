// app/api/finance/petty-cash/report/export/route.ts
//
// Bank-transfer CSV for the report's current filters and ordering.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getPettyCashReport } from '@/lib/db/utils/petty-cash-report';
import { currentYearMonthJakarta } from '@/lib/db/utils/petty-cash-refill';
import { buildReportCsv } from '@/lib/petty-cash-report-csv';

export async function GET(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    const params = req.nextUrl.searchParams;
    const month = params.get('month') ?? currentYearMonthJakarta();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ success: false, error: 'Invalid month. Use YYYY-MM.' }, { status: 400 });
    }

    const sort = params.get('sort') ?? 'store';
    if (sort !== 'store' && sort !== 'bank_asc' && sort !== 'bank_desc') {
      return NextResponse.json({ success: false, error: 'Invalid sort order.' }, { status: 400 });
    }

    const csv = buildReportCsv({
      month,
      rows: (await getPettyCashReport(month)).rows,
      filters: {
        code: params.get('code'),
        bank: params.get('bank'),
        search: params.get('search') ?? '',
        onlyUsed: params.get('onlyUsed') === '1',
        onlyAwaiting: params.get('onlyAwaiting') === '1',
        sort,
      },
      grouped: params.get('view') === 'code',
    });

    const suffix = [params.get('code'), params.get('bank')]
      .map((value) => value?.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '_'))
      .filter(Boolean)
      .join('_');
    const filename = `petty-cash-report_${month}${suffix ? `_${suffix}` : ''}.csv`;
    const bytes = new TextEncoder().encode(csv);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[GET /api/finance/petty-cash/report/export]', err);
    return NextResponse.json({ success: false, error: 'Failed to generate export.' }, { status: 500 });
  }
}

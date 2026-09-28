// app/api/finance/petty-cash/report/export/route.ts
//
// GET ?month=YYYY-MM[&code=FF][&onlyUsed=1] — the Petty Cash Report as a
// styled .xlsx (see lib/petty-cash-report-xlsx.ts for the sheets). `code`
// narrows the file to that one code's sheet; `onlyUsed=1` drops stores that
// used nothing.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getPettyCashReport } from '@/lib/db/utils/petty-cash-report';
import { currentYearMonthJakarta } from '@/lib/db/utils/petty-cash-refill';
import { buildReportWorkbook } from '@/lib/petty-cash-report-xlsx';

export async function GET(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    const params = req.nextUrl.searchParams;
    const month = params.get('month') ?? currentYearMonthJakarta();
    if (!/^d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ success: false, error: 'Invalid month. Use YYYY-MM.' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);

    const result = buildReportWorkbook({
      month,
      rows: await getPettyCashReport(month),
      code: params.get('code')?.trim().toUpperCase() || null,
      onlyUsed: params.get('onlyUsed') === '1',
      exportedBy: session?.user?.name ?? scope.userId,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 });
    }

    const filename = `petty-cash-report_${month}${result.suffix}.xlsx`;

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(result.buffer.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/finance/petty-cash/report/export]', err);
    return NextResponse.json({ success: false, error: 'Failed to generate export.' }, { status: 500 });
  }
}

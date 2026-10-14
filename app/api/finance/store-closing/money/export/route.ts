// app/api/finance/store-closing/money/export/route.ts
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&storeId=][&code=FF] — the Store Closing ·
// Report as a styled .xlsx (lib/store-closing-money-xlsx.ts). `code` narrows the
// file to one store code.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getClosingMoneyReport } from '@/lib/db/utils/store-closing-money';
import { buildMoneyWorkbook } from '@/lib/store-closing-money-xlsx';
import { parseMoneyQuery, todayJakarta } from '@/lib/store-closing-money';

export async function GET(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const today = todayJakarta();
  const query = parseMoneyQuery(req.nextUrl.searchParams, { from: `${today.slice(0, 8)}01`, to: today });
  if (!query.ok) return NextResponse.json({ success: false, error: query.error }, { status: 400 });

  try {
    const code = req.nextUrl.searchParams.get('code')?.trim().toUpperCase() || null;
    const session = await getServerSession(authOptions);
    const report = await getClosingMoneyReport(query.from, query.to, query.storeId);

    const result = buildMoneyWorkbook({
      from: query.from,
      to: query.to,
      rows: report.rows,
      code,
      exportedBy: session?.user?.name ?? scope.userId,
    });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 404 });

    const filename = `store-closing-report_${query.from}_${query.to}${result.suffix}.xlsx`;
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(result.buffer.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/finance/store-closing/money/export]', err);
    return NextResponse.json({ success: false, error: 'Failed to generate export.' }, { status: 500 });
  }
}

// app/api/finance/setoran/export/route.ts
//
// GET ?date=YYYY-MM-DD[&code=FF][&unverified=1]  — one day's Setoran Review
// GET ?month=YYYY-MM[&code=FF][&issues=1]        — the monthly Setoran Report
//
// Both come back as a styled .xlsx (see lib/setoran-review-xlsx.ts). `code`
// narrows the file to one store code; `unverified` / `issues` keep only the
// rows Finance still has to look at.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getSetoranDay, getSetoranMonth } from '@/lib/db/utils/setoran-review';
import { buildDayWorkbook, buildMonthWorkbook, type WorkbookResult } from '@/lib/setoran-review-xlsx';
import { dayBounds, todayJakarta } from '@/lib/setoran-review';

export async function GET(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    const params = req.nextUrl.searchParams;
    const today = todayJakarta();
    const code = params.get('code')?.trim().toUpperCase() || null;
    const session = await getServerSession(authOptions);
    const exportedBy = session?.user?.name ?? scope.userId;

    const monthParam = params.get('month');
    let result: WorkbookResult;
    let filename: string;

    if (monthParam) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
        return NextResponse.json({ success: false, error: 'Invalid month. Use YYYY-MM.' }, { status: 400 });
      }
      result = buildMonthWorkbook({
        month: monthParam,
        rows: await getSetoranMonth(monthParam, today),
        code,
        onlyIssues: params.get('issues') === '1',
        exportedBy,
      });
      filename = `setoran-report_${monthParam}`;
    } else {
      const date = params.get('date') ?? today;
      if (!dayBounds(date)) {
        return NextResponse.json({ success: false, error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 });
      }
      result = buildDayWorkbook({
        date,
        today,
        rows: await getSetoranDay(date),
        code,
        unverifiedOnly: params.get('unverified') === '1',
        exportedBy,
      });
      filename = `setoran-harian_${date}`;
    }

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}${result.suffix}.xlsx"`,
        'Content-Length': String(result.buffer.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/finance/setoran/export]', err);
    return NextResponse.json({ success: false, error: 'Failed to generate export.' }, { status: 500 });
  }
}

// app/api/finance/store-sheet/export/route.ts
//
// GET ?storeId=&from=YYYY-MM-DD&to=YYYY-MM-DD — "Daily Report All Store" as an .xlsx with the same
// sheet the page draws (lib/store-money-sheet-xlsx.ts). One store, one row per sales day.
// Finance/IT only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { getStoreMoneySheet } from '@/lib/db/utils/store-closing-money';
import { parseMoneyQuery, todayJakarta } from '@/lib/store-closing-money';
import { sheetRows } from '@/lib/store-money-sheet';
import { buildStoreSheetWorkbook } from '@/lib/store-money-sheet-xlsx';

export async function GET(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const today = todayJakarta();
  const query = parseMoneyQuery(req.nextUrl.searchParams, { from: `${today.slice(0, 8)}01`, to: today });
  if (!query.ok) return NextResponse.json({ success: false, error: query.error }, { status: 400 });
  if (query.storeId == null) {
    return NextResponse.json({ success: false, error: 'Pilih toko terlebih dahulu.' }, { status: 400 });
  }

  try {
    const sheet = await getStoreMoneySheet(query.storeId, query.from, query.to);
    if (!sheet?.store) return NextResponse.json({ success: false, error: 'Toko tidak ditemukan.' }, { status: 404 });

    const { buffer } = buildStoreSheetWorkbook({
      store: sheet.store,
      rows: sheetRows(sheet.store, sheet.from, sheet.to, sheet.rows, sheet.openingSisa),
    });

    const filename = `daily-report_${sheet.store.storeNo}_${query.from}_${query.to}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/finance/store-sheet/export]', err);
    return NextResponse.json({ success: false, error: 'Failed to generate export.' }, { status: 500 });
  }
}

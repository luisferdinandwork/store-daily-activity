// app/api/audit/stock-opname/route.ts
//
// Audit "Stock Opname" (lib/db/utils/audit-stock-opname.ts).
//
//   GET ?month=YYYY-MM                      → { rows: StockOpnameListRow[] }  (the Berita Acara SO list)
//   GET ?storeId=N&date=YYYY-MM-DD[&refresh=1]
//       → { context (store, staff, default Head Store), so (saved record or null),
//           bc (what Business Central says now: SoBcSnapshot), defaults (store title / Surat city, brand, location) }
//   PUT { storeId, date, holderUserId?, sohBc, scanQty, shoppingBagQty, transSalesQty, valuePlus, valueMinus,
//         binsTotal, binsMatch, binsMismatch, findings[], notes? } → saves (creates the row on the first save).
//
// Audit + IT only (proxy rule on /api/audit + resolveAuditScope).

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { isMonth, isSoDate } from '@/lib/audit-stock-opname';
import { getStoreContext } from '@/lib/db/utils/audit-cash-check';
import {
  getSoBcSnapshot,
  getSoStoreDefaults,
  getStockOpname,
  listStockOpnames,
  saveStockOpname,
} from '@/lib/db/utils/audit-stock-opname';

export async function GET(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  try {
    if (month != null) {
      if (!isMonth(month)) return NextResponse.json({ success: false, error: 'Bulan tidak valid.' }, { status: 400 });
      return NextResponse.json({ success: true, rows: await listStockOpnames(month) });
    }

    const storeId = Number(url.searchParams.get('storeId'));
    const date = url.searchParams.get('date') ?? '';
    if (!Number.isInteger(storeId) || storeId <= 0 || !isSoDate(date)) {
      return NextResponse.json({ success: false, error: 'storeId dan date wajib diisi.' }, { status: 400 });
    }
    const context = await getStoreContext(storeId);
    if (!context) return NextResponse.json({ success: false, error: 'Toko tidak ditemukan.' }, { status: 404 });

    const [so, bc, defaults] = await Promise.all([
      getStockOpname(storeId, date),
      getSoBcSnapshot(context.store.storeNo, date, url.searchParams.get('refresh') === '1'),
      getSoStoreDefaults(context.store),
    ]);
    return NextResponse.json({ success: true, context, so, bc, defaults });
  } catch (error) {
    console.error('[audit/stock-opname] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat data stock opname.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Body tidak valid.' }, { status: 400 });
  }
  const storeId = Number(body.storeId);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'Toko wajib dipilih.' }, { status: 400 });
  }

  try {
    const result = await saveStockOpname(scope.userId, {
      storeId,
      date: String(body.date ?? ''),
      holderUserId: body.holderUserId,
      sohBc: body.sohBc,
      scanQty: body.scanQty,
      shoppingBagQty: body.shoppingBagQty,
      transSalesQty: body.transSalesQty,
      valuePlus: body.valuePlus,
      valueMinus: body.valueMinus,
      binsTotal: body.binsTotal,
      binsMatch: body.binsMatch,
      binsMismatch: body.binsMismatch,
      findings: body.findings,
      notes: body.notes,
    });
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json({ success: true, so: result.data });
  } catch (error) {
    console.error('[audit/stock-opname] PUT failed', error);
    return NextResponse.json({ success: false, error: 'Gagal menyimpan stock opname.' }, { status: 500 });
  }
}

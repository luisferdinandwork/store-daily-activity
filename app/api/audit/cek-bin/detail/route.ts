// app/api/audit/cek-bin/detail/route.ts
//
// Audit "Hasil Cek Bin" → detail of ONE store-day: the whole Business Central answer (every bin, every item line,
// every field), plus the verdict of each line (lib/audit-bin-detail.ts).
//
//   GET ?storeId=N&date=YYYY-MM-DD[&refresh=1]
//     → { state: 'ok' | 'not_configured' | 'unavailable', fetchedAt,
//         store: { id, storeNo, name, areaName }, date, lines, bins, extraColumns }
//
// Always 200 for a valid store + day — BC being down is `state`, not an error. Audit + IT only.

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { resolveAuditScope } from '@/lib/audit/scope';
import { db } from '@/lib/db';
import { areas, stores } from '@/lib/db/schema';
import { isDayKey, jakartaTodayKey } from '@/lib/day-bucket';
import { getBinCheckDayHeaders } from '@/lib/bc/bin-check-audit';
import { buildBinDetail } from '@/lib/audit-bin-detail';

export async function GET(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  const url = new URL(req.url);
  const storeId = Number(url.searchParams.get('storeId'));
  const date = url.searchParams.get('date') ?? '';
  if (!Number.isInteger(storeId) || storeId <= 0 || !isDayKey(date) || date > jakartaTodayKey()) {
    return NextResponse.json({ success: false, error: 'Toko atau tanggal tidak valid.' }, { status: 400 });
  }

  try {
    const [store] = await db
      .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaName: areas.name })
      .from(stores)
      .leftJoin(areas, eq(areas.id, stores.areaId))
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) return NextResponse.json({ success: false, error: 'Toko tidak ditemukan.' }, { status: 404 });

    const bc = await getBinCheckDayHeaders({ location: store.storeNo, day: date, force: url.searchParams.get('refresh') === '1' });
    const detail = buildBinDetail(bc.headers);
    return NextResponse.json({
      success: true,
      state: bc.state,
      fetchedAt: bc.fetchedAt,
      store: { ...store, areaName: store.areaName ?? null },
      date,
      ...detail,
    });
  } catch (error) {
    console.error('[audit/cek-bin/detail] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat detail cek bin.' }, { status: 500 });
  }
}

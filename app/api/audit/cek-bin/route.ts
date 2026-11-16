// app/api/audit/cek-bin/route.ts
//
// Audit "Hasil Cek Bin" (lib/audit-bin-report.ts) — every active store's daily Cek Bin, as Business Central judged
// it, for a period of at most 31 days.
//
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&refresh=1]
//     → { state: 'ok' | 'not_configured' | 'unavailable', fetchedAt, from, to,
//         stores: BinReportStore[] (active), rows: BinReportRow[] (store-days that have a result) }
//
// ONE BC query for the whole period (lib/bc/bin-check-audit.ts); area / store filters run in the browser. Always
// answers 200 when the period is valid — BC being down is `state`, not an error. Audit + IT only.

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { resolveAuditScope } from '@/lib/audit/scope';
import { db } from '@/lib/db';
import { areas, stores } from '@/lib/db/schema';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { getBinCheckRangeHeaders } from '@/lib/bc/bin-check-audit';
import {
  periodProblem,
  summarizeBinCheckHeaders,
  type BinReportRow,
  type BinReportStore,
} from '@/lib/audit-bin-report';

export async function GET(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const problem = periodProblem(from, to, jakartaTodayKey());
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

  try {
    const storeRows = await db
      .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId, areaName: areas.name })
      .from(stores)
      .leftJoin(areas, eq(areas.id, stores.areaId))
      .where(eq(stores.status, 'active'))
      .orderBy(stores.storeNo);
    const list: BinReportStore[] = storeRows.map((s) => ({ ...s, areaName: s.areaName ?? null }));
    const byCode = new Map(list.map((s) => [s.storeNo.trim().toUpperCase(), s]));

    const bc = await getBinCheckRangeHeaders({ from, to, force: url.searchParams.get('refresh') === '1' });
    const rows: BinReportRow[] = [];
    for (const stat of summarizeBinCheckHeaders(bc.headers, from, to)) {
      const store = byCode.get(stat.location);
      if (!store) continue; // a BC location that is not an active PRISM store
      rows.push({ ...stat, storeId: store.id, storeName: store.name, areaId: store.areaId, areaName: store.areaName });
    }

    return NextResponse.json({ success: true, state: bc.state, fetchedAt: bc.fetchedAt, from, to, stores: list, rows });
  } catch (error) {
    console.error('[audit/cek-bin] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat hasil cek bin.' }, { status: 500 });
  }
}

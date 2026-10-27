// app/api/ops/item-transfers/report/route.ts
//
// TO Report: per store, how many processes of ONE kind it had in a period and how
// many are done (rules: lib/transfer-order-report.ts).
//
//   GET ?process=return|receiving|delivery&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//        → every store in scope
//   GET …&storeId=N
//        → that store's processes (the drill-down sheet)
//
// Ops Area sees its own area, OPS HO / IT everything. Read-only: it never calls
// Business Central on the request path — the 5-minute cron keeps the registry
// warm, and a stale one is refreshed in the background (never awaited).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { isDayKey } from '@/lib/day-bucket';
import { MAX_RANGE_DAYS } from '@/lib/task-progress';
import { isWarehouseCode } from '@/lib/db/utils/item-transfers';
import { getReportRows, getReportStores, getStoreNamesByCode } from '@/lib/db/utils/transfer-order-report';
import { refreshTransferRegistry } from '@/lib/db/utils/transfer-order-refresh';
import {
  buildStoreItems,
  buildStoreReports,
  daysBetween,
  isProcess,
  type TransferReportResponse,
  type TransferReportStoreResponse,
} from '@/lib/transfer-order-report';
import { getOpsActor } from '@/app/api/ops/tasks/_helpers';

const LAZY_REFRESH_MAX_AGE_MS = 5 * 60_000;

function bad(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return bad('Unauthorized', 401);

  const actor = await getOpsActor(session.user.id);
  if (!actor) return bad('OPS only.', 403);

  const sp = req.nextUrl.searchParams;
  const process = sp.get('process');
  if (!isProcess(process)) return bad('process must be return, receiving or delivery.');

  const from = sp.get('startDate') ?? '';
  const to = sp.get('endDate') ?? '';
  if (!isDayKey(from) || !isDayKey(to)) return bad('startDate / endDate must be YYYY-MM-DD.');
  if (from > to) return bad('startDate is after endDate.');
  const days = daysBetween(from, to);
  if (days.length > MAX_RANGE_DAYS) return bad(`The range is limited to ${MAX_RANGE_DAYS} days.`);

  // Safety net for a missing cron: refresh in the background when stale.
  void refreshTransferRegistry({ maxAgeMs: LAZY_REFRESH_MAX_AGE_MS });

  const scopeStores = await getReportStores(actor);
  const storeIdParam = sp.get('storeId');
  const now = new Date();

  // ── One store's processes (the drill-down sheet) ──────────────────────────
  if (storeIdParam != null) {
    const storeId = Number(storeIdParam);
    if (!Number.isInteger(storeId) || !scopeStores.some((s) => s.id === storeId)) {
      return bad('Toko tidak ditemukan di cakupan kamu.', 404);
    }
    const [rows, nameByCode] = await Promise.all([getReportRows(process, from, to, [storeId]), getStoreNamesByCode()]);
    const [store] = buildStoreReports(scopeStores.filter((s) => s.id === storeId), rows, days, process, now);
    const body: TransferReportStoreResponse = {
      success: true,
      process,
      from,
      to,
      store: store ?? null,
      items: buildStoreItems(storeId, rows, days, process, { now, nameByCode, isWarehouseCode }),
    };
    return NextResponse.json(body);
  }

  // ── Every store in scope ──────────────────────────────────────────────────
  const rows = await getReportRows(process, from, to, scopeStores.map((s) => s.id));
  const body: TransferReportResponse = {
    success: true,
    process,
    from,
    to,
    scope: actor.isOpsHo ? 'all_areas' : 'area',
    areaName: actor.isOpsHo ? null : (scopeStores[0]?.areaName ?? null),
    generatedAt: now.toISOString(),
    stores: buildStoreReports(scopeStores, rows, days, process, now),
  };
  return NextResponse.json(body);
}

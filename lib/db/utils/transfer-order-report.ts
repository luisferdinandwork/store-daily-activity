// lib/db/utils/transfer-order-report.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reads for the OPS TO Report (/ops/transfer-order/report/[process]). The counting
// rules live in lib/transfer-order-report.ts (pure); this only loads the stores in
// an actor's scope and the transfer-order rows that STARTED a process in a period.
// ─────────────────────────────────────────────────────────────────────────────

import { and, asc, eq, inArray, isNotNull, sql, type SQLWrapper } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, itemTransferOrders as t, stores } from '@/lib/db/schema';
import { jakartaDaysRange } from '@/lib/day-bucket';
import type { Process, ReportRow, StoreMeta } from '@/lib/transfer-order-report';

/**
 * The stores a report covers: active stores only (prep / closed stores take no
 * part in progress rollups), all of them for HO / IT, the actor's own area for
 * Ops Area.
 */
export async function getReportStores(scope: { isOpsHo: boolean; areaId: number | null }): Promise<StoreMeta[]> {
  if (!scope.isOpsHo && scope.areaId == null) return [];

  const rows = await db
    .select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, areaId: stores.areaId, areaName: areas.name })
    .from(stores)
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(and(
      eq(stores.status, 'active'),
      scope.isOpsHo ? undefined : eq(stores.areaId, scope.areaId!),
    ))
    .orderBy(asc(stores.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    storeNo: r.storeNo,
    areaId: r.areaId != null ? String(r.areaId) : null,
    areaName: r.areaName ?? null,
  }));
}

/** store code → name, for naming the other end of a transfer in the drill-down. */
export async function getStoreNamesByCode(): Promise<Map<string, string>> {
  const rows = await db.select({ storeNo: stores.storeNo, name: stores.name }).from(stores);
  return new Map(rows.map((r) => [r.storeNo, r.name]));
}

/**
 * Rows where one of `storeIds` has a `process` that started between Jakarta days
 * `from` and `to` (inclusive):
 *   • return    — the store is the origin and the TO was created in range
 *                 ("TO Dibuat", clamped like effectiveToCreatedAt);
 *   • receiving — the store is the destination and BC posted the Warehouse
 *                 Shipment in range;
 *   • delivery  — the store is the destination of a store → store TO whose origin
 *                 handed it over (Foto Serah Terima) in range.
 * The timestamp columns are UTC instants stored without a zone, so the bounds
 * go in as ISO strings cast to `timestamp` (the same encoding Drizzle writes).
 */
export async function getReportRows(
  process: Process,
  from: string,
  to: string,
  storeIds: number[],
): Promise<ReportRow[]> {
  if (storeIds.length === 0) return [];
  const { start, end } = jakartaDaysRange(from, to);
  const s = start.toISOString();
  const e = end.toISOString();

  const inRange = (column: SQLWrapper) =>
    and(sql`${column} >= ${s}::timestamp`, sql`${column} < ${e}::timestamp`);

  // least() skips NULLs; a TO can't be created after its shipment or its photo.
  const toCreated = sql`least(${t.returnDetectedAt}, ${t.droppingDetectedAt}, ${t.returnSubmittedAt})`;

  const where =
    process === 'return'
      ? and(inArray(t.fromStoreId, storeIds), inRange(toCreated))
      : process === 'receiving'
        ? and(inArray(t.toStoreId, storeIds), isNotNull(t.whseShipmentNo), inRange(t.droppingDetectedAt))
        : and(inArray(t.toStoreId, storeIds), isNotNull(t.fromStoreId), inRange(t.returnSubmittedAt));

  return db
    .select({
      id: t.id,
      toaNo: t.toaNo,
      transferFromCode: t.transferFromCode,
      transferToCode: t.transferToCode,
      fromStoreId: t.fromStoreId,
      toStoreId: t.toStoreId,
      qtyOrdered: t.qtyOrdered,
      whseShipmentNo: t.whseShipmentNo,
      returnDetectedAt: t.returnDetectedAt,
      returnSubmittedAt: t.returnSubmittedAt,
      droppingDetectedAt: t.droppingDetectedAt,
      droppingSubmittedAt: t.droppingSubmittedAt,
      receivedAt: t.receivedAt,
    })
    .from(t)
    .where(where);
}

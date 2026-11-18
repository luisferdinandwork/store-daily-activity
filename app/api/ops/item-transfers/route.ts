// app/api/ops/item-transfers/route.ts
//
// OPS dashboard for the Item Return → Shipping → Item Receiving pipeline.
// Every load/refresh re-syncs live from Business Central — this is the one
// place that keeps phase 3 (Item Receiving) current for stores nobody has
// opened an Item Dropping task for recently, and gives OPS visibility into
// transfer orders no employee has looked at yet (see
// lib/db/utils/item-transfers.ts syncTransferOrderRegistry/syncReceivingStatus).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { desc, eq, inArray } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { itemTransferOrders, itemReturnEntries, itemDroppingEntries, stores, areas } from '@/lib/db/schema';
import { ensureWarehouseCodes, isWarehouseCode } from '@/lib/db/utils/item-transfers';
import { effectiveToCreatedAt } from '@/lib/transfer-order-metrics';
import { legsNotProcessedInPrism, resolveTransferPhase } from '@/lib/transfer-order-phase';
import { refreshReceivingStatus, refreshTransferRegistry } from '@/lib/db/utils/transfer-order-refresh';
import { getOpsActor } from '@/app/api/ops/tasks/_helpers';

// The cron (every 5 min) keeps both warm; a load only re-sweeps BC when the
// last sweep is older than this, so OPS opening/refreshing the page no longer
// costs 20+ BC round trips each time. `?fresh=1` forces one.
const REGISTRY_MAX_AGE_MS = 60_000;
const RECEIVING_MAX_AGE_MS = 3 * 60_000;

// Phase rules live in lib/transfer-order-phase.ts (shared with the Ops Dashboard).
const resolvePhase = (row: typeof itemTransferOrders.$inferSelect) => resolveTransferPhase(row, isWarehouseCode);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const actor = await getOpsActor(session.user.id);
  if (!actor) {
    return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
  }

  await ensureWarehouseCodes();
  const force = new URL(req.url).searchParams.get('fresh') === '1';
  // Registry first, then receiving: receiving works off the shipments the
  // registry sweep just recorded, so running them side by side would leave a
  // brand-new shipment waiting a full cycle to be checked.
  const registrySync = await refreshTransferRegistry({ maxAgeMs: force ? 0 : REGISTRY_MAX_AGE_MS });
  const receivingSync = await refreshReceivingStatus({ maxAgeMs: force ? 0 : RECEIVING_MAX_AGE_MS });

  // Left-joined to surface the employee's own confirmation photo/qty — both
  // transferOrderId FKs are unique, so each TO has at most one return entry
  // and at most one dropping entry (no row-duplication risk from the join).
  const joined = await db
    .select({
      to: itemTransferOrders,
      returnPhoto: itemReturnEntries.courierSignPhoto,
      returnQtyCounted: itemReturnEntries.qtyCounted,
      droppingPhoto: itemDroppingEntries.courierSignPhoto,
      droppingQtyCounted: itemDroppingEntries.qtyCounted,
    })
    .from(itemTransferOrders)
    .leftJoin(itemReturnEntries, eq(itemReturnEntries.transferOrderId, itemTransferOrders.id))
    .leftJoin(itemDroppingEntries, eq(itemDroppingEntries.transferOrderId, itemTransferOrders.id))
    .orderBy(desc(itemTransferOrders.updatedAt));

  // Every "DM…" code is the warehouse (isWarehouseCode) — never a store, whatever a store row
  // with that code (or an older link) says: that side carries no store, so no store name shows.
  const allRows = joined.map((j) => ({
    ...j.to,
    fromStoreId: isWarehouseCode(j.to.transferFromCode) ? null : j.to.fromStoreId,
    toStoreId: isWarehouseCode(j.to.transferToCode) ? null : j.to.toStoreId,
    returnPhoto: j.returnPhoto,
    returnQtyCounted: j.returnQtyCounted,
    droppingPhoto: j.droppingPhoto,
    droppingQtyCounted: j.droppingQtyCounted,
  }));

  // Only transfer orders that actually touch one of our registered stores —
  // transferFromCode/transferToCode get resolved to fromStoreId/toStoreId by
  // matching against stores.storeNo (see lib/db/utils/item-transfers.ts); a
  // row where BOTH stay null is between locations we don't manage (e.g. a
  // central "DM-RETURN" warehouse) and isn't actionable by any OPS user.
  const rows = allRows.filter((r) => r.fromStoreId != null || r.toStoreId != null);

  const storeIds = [...new Set(
    rows.flatMap((r) => [r.fromStoreId, r.toStoreId]).filter((v): v is number => v != null),
  )];

  const storeRows = storeIds.length
    ? await db
        .select({
          id: stores.id,
          name: stores.name,
          storeNo: stores.storeNo,
          areaId: stores.areaId,
          areaName: areas.name,
        })
        .from(stores)
        .leftJoin(areas, eq(areas.id, stores.areaId))
        .where(inArray(stores.id, storeIds))
    : [];
  const storeById = new Map(storeRows.map((s) => [s.id, s]));

  function serializeStore(id: number | null) {
    if (id == null) return null;
    const s = storeById.get(id);
    if (!s) return null;
    return { id: String(s.id), name: s.name, storeNo: s.storeNo, areaId: s.areaId != null ? String(s.areaId) : null, areaName: s.areaName ?? null };
  }

  // OPS Area only sees transfer orders touching a store in their own area;
  // OPS HO / IT see everything.
  const visibleRows = actor.isOpsHo
    ? rows
    : rows.filter((r) => {
        const from = r.fromStoreId ? storeById.get(r.fromStoreId) : null;
        const to = r.toStoreId ? storeById.get(r.toStoreId) : null;
        return (from?.areaId === actor.areaId) || (to?.areaId === actor.areaId);
      });

  const transfers = visibleRows.map((r) => ({
    id: String(r.id),
    toaNo: r.toaNo,
    transferFromCode: r.transferFromCode,
    transferToCode: r.transferToCode,
    fromStore: serializeStore(r.fromStoreId),
    toStore: serializeStore(r.toStoreId),
    qtyOrdered: r.qtyOrdered,
    bcStatus: r.bcStatus,
    postingDate: r.postingDate?.toISOString() ?? null,
    whseShipmentNo: r.whseShipmentNo,
    phase: resolvePhase(r),
    // Store legs nobody processed in PRISM on an order BC already posted — the
    // page marks those "Selesai Otomatis · tidak diproses di PRISM".
    notProcessedLegs: legsNotProcessedInPrism(r, isWarehouseCode),
    fromIsWarehouse: r.fromStoreId == null && isWarehouseCode(r.transferFromCode),
    toIsWarehouse: r.toStoreId == null && isWarehouseCode(r.transferToCode),
    // "TO Dibuat", never later than the shipment or the Item Return photo it led to.
    returnDetectedAt: effectiveToCreatedAt(r.returnDetectedAt, r.droppingDetectedAt, r.returnSubmittedAt)?.toISOString() ?? null,
    returnSubmittedAt: r.returnSubmittedAt?.toISOString() ?? null,
    droppingDetectedAt: r.droppingDetectedAt?.toISOString() ?? null,
    droppingSubmittedAt: r.droppingSubmittedAt?.toISOString() ?? null,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    returnPhoto: r.returnPhoto ?? null,
    returnQtyCounted: r.returnQtyCounted ?? null,
    droppingPhoto: r.droppingPhoto ?? null,
    droppingQtyCounted: r.droppingQtyCounted ?? null,
  }));

  const syncWarnings = [registrySync.error, receivingSync.error].filter((v): v is string => v != null);

  return NextResponse.json({
    success: true,
    scope: actor.isOpsHo ? 'all_areas' : 'area',
    transfers,
    syncWarnings,
  });
}

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
import { syncTransferOrderRegistry, syncReceivingStatus, isWarehouseCode } from '@/lib/db/utils/item-transfers';
import { getOpsActor } from '@/app/api/ops/tasks/_helpers';

type Phase = 'return' | 'shipping' | 'receiving' | 'received' | 'to_warehouse';

/**
 * A transfer order whose destination is a warehouse code (a store sending
 * stock/returns back to DM, not store-to-store) gets its receivedAt closed
 * by syncReceivingStatus as soon as the origin store submits its Item Return
 * (see lib/db/utils/item-transfers.ts) — there's no employee on the other
 * end to confirm receipt or a BC receipt to necessarily wait for the way a
 * store-to-store leg has. `to_warehouse` below is a defensive fallback for
 * the brief window before that sync has run (receivedAt takes priority the
 * moment it's set), instead of leaving the row stuck showing "Dalam
 * Perjalanan" forever.
 */
function resolvePhase(row: typeof itemTransferOrders.$inferSelect): Phase {
  if (row.receivedAt) return 'received';
  if (row.droppingSubmittedAt) return 'receiving';
  if (row.returnSubmittedAt) {
    const toIsWarehouse = row.toStoreId == null && isWarehouseCode(row.transferToCode);
    return toIsWarehouse ? 'to_warehouse' : 'shipping';
  }
  return 'return';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const actor = await getOpsActor(session.user.id);
  if (!actor) {
    return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
  }

  const [registrySync, receivingSync] = await Promise.all([
    syncTransferOrderRegistry(),
    syncReceivingStatus('all'),
  ]);

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

  const allRows = joined.map((j) => ({
    ...j.to,
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
    fromIsWarehouse: r.fromStoreId == null && isWarehouseCode(r.transferFromCode),
    toIsWarehouse: r.toStoreId == null && isWarehouseCode(r.transferToCode),
    returnDetectedAt: r.returnDetectedAt?.toISOString() ?? null,
    returnSubmittedAt: r.returnSubmittedAt?.toISOString() ?? null,
    droppingDetectedAt: r.droppingDetectedAt?.toISOString() ?? null,
    droppingSubmittedAt: r.droppingSubmittedAt?.toISOString() ?? null,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    returnPhoto: r.returnPhoto ?? null,
    returnQtyCounted: r.returnQtyCounted ?? null,
    droppingPhoto: r.droppingPhoto ?? null,
    droppingQtyCounted: r.droppingQtyCounted ?? null,
  }));

  const syncWarnings = [
    registrySync.success ? null : registrySync.error,
    receivingSync.success ? null : receivingSync.error,
  ].filter((v): v is string => v != null);

  return NextResponse.json({
    success: true,
    scope: actor.isOpsHo ? 'all_areas' : 'area',
    transfers,
    syncWarnings,
  });
}

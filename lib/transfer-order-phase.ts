// lib/transfer-order-phase.ts
//
// Which phase a Business Central transfer order is in. One definition for the Ops
// Transfer Order page (/api/ops/item-transfers) and the Ops Dashboard's "longest
// waiting" lists (lib/db/utils/ops-dashboard-queues.ts), so the two can never
// disagree about what is "Menunggu Diambil", "Dalam Perjalanan" or "Menunggu Diterima BC".
// Pure + client-safe: the warehouse test is passed in (it reads a cached DB list).

export type TransferPhase = 'return' | 'shipping' | 'receiving' | 'received' | 'to_warehouse';

export interface TransferPhaseInput {
  fromStoreId: number | null;
  toStoreId: number | null;
  transferFromCode: string;
  transferToCode: string;
  whseShipmentNo: string | null;
  returnSubmittedAt: Date | null;
  droppingSubmittedAt: Date | null;
  receivedAt: Date | null;
}

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
export function resolveTransferPhase(
  row: TransferPhaseInput,
  isWarehouseCode: (code: string | null | undefined) => boolean,
): TransferPhase {
  if (row.receivedAt) return 'received';
  if (row.droppingSubmittedAt) return 'receiving';
  if (row.returnSubmittedAt) {
    const toIsWarehouse = row.toStoreId == null && isWarehouseCode(row.transferToCode);
    return toIsWarehouse ? 'to_warehouse' : 'shipping';
  }
  // A DM warehouse origin has no employee to hand anything to a courier, so
  // returnSubmittedAt will never be set — the transfer is in transit the moment
  // BC creates its Warehouse Shipment. Without this every DM → store transfer
  // sat under "Menunggu Diambil" until BC posted the receipt (on staging:
  // 0 "Dalam Perjalanan" next to ~150 shipments that had already left).
  if (row.fromStoreId == null && isWarehouseCode(row.transferFromCode) && row.whseShipmentNo) {
    return 'shipping';
  }
  return 'return';
}

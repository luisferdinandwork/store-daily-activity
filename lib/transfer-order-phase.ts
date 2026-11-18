// lib/transfer-order-phase.ts
//
// Which phase a Business Central transfer order is in. One definition for the Ops
// Transfer Order page (/api/ops/item-transfers) and the Ops Dashboard's "longest
// waiting" lists (lib/db/utils/ops-dashboard-queues.ts), so the two can never
// disagree about what is "Menunggu Diambil", "Dalam Perjalanan" or "Menunggu Diterima BC".
// Pure + client-safe: the warehouse test is passed in (it reads a cached DB list).

/**
 * `received`       — finished, every store leg was processed in PRISM (photos
 *                    taken). A store → DM order whose store sent the Foto Serah
 *                    Terima is a normal finish once the warehouse posts the WR.
 * `auto_completed` — finished in Business Central (Posted Whse Receipt) while at
 *                    least one store leg was never processed in PRISM: no Foto
 *                    Serah Terima and/or no Terima Fisik photo. PRISM closed it
 *                    by itself because BC had already posted it.
 * `to_warehouse`   — the store handed the goods over for a DM warehouse; waiting
 *                    for the warehouse to post the Warehouse Receipt in BC.
 */
export type TransferPhase = 'return' | 'shipping' | 'receiving' | 'received' | 'auto_completed' | 'to_warehouse';

/** A store's side of a transfer: the origin hands over (return), the destination takes in (receiving). */
export type TransferLeg = 'return' | 'receiving';

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
 * stock/returns back to DM, not store-to-store) is `to_warehouse` once the
 * origin store has sent its Foto Serah Terima, and stays there until the
 * warehouse posts the Posted Whse Receipt in BC (syncReceivingStatus sets
 * receivedAt then — it used to be closed at the photo, before 2026-11-18).
 * With the store's photo that is a normal `received`; without it (BC posted the
 * WR while the store never did its step) it is `auto_completed`.
 */
export function resolveTransferPhase(
  row: TransferPhaseInput,
  isWarehouseCode: (code: string | null | undefined) => boolean,
): TransferPhase {
  if (row.receivedAt) return legsNotProcessedInPrism(row, isWarehouseCode).length > 0 ? 'auto_completed' : 'received';
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

/**
 * The store legs of a FINISHED transfer order that nobody processed in PRISM —
 * BC posted the Warehouse Receipt, so the sync completed the order on its own
 * (syncReceivingStatus / the registry reconcile in lib/db/utils/item-transfers.ts):
 *
 *   'return'    the origin is a store and it never sent the Foto Serah Terima;
 *   'receiving' the destination is a store and it never sent the Terima Fisik photo.
 *
 * A warehouse (DM / listed) end has no PRISM step, so it is never "missing": a
 * store → DM order with the store's Foto Serah Terima, received by the warehouse
 * in BC, is a normal finish. Empty while the order is still open, or when every
 * store leg was processed.
 */
export function legsNotProcessedInPrism(
  row: TransferPhaseInput,
  isWarehouseCode: (code: string | null | undefined) => boolean,
): TransferLeg[] {
  if (!row.receivedAt) return [];
  const out: TransferLeg[] = [];
  if (row.fromStoreId != null && !isWarehouseCode(row.transferFromCode) && !row.returnSubmittedAt) out.push('return');
  if (row.toStoreId != null && !isWarehouseCode(row.transferToCode) && !row.droppingSubmittedAt) out.push('receiving');
  return out;
}

/** The words OPS / the store app use for an order PRISM completed by itself. */
export const AUTO_COMPLETED_LABEL = 'Selesai Otomatis';
export const AUTO_COMPLETED_NOTE = 'Tidak diproses di PRISM — selesai otomatis karena sudah diposting di BC (Posted Whse Receipt).';
export const LEG_STEP_LABEL: Record<TransferLeg, string> = {
  return: 'Item Return · Foto Serah Terima',
  receiving: 'Item Receiving · Terima Fisik Barang di Toko',
};
/** Short name of a leg, for a photo slot. */
export const LEG_SHORT_LABEL: Record<TransferLeg, string> = {
  return: 'Item Return',
  receiving: 'Item Receiving',
};

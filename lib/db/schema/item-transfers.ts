// lib/db/schema/item-transfers.ts
// ─────────────────────────────────────────────────────────────────────────────
// BC-driven transfer order pipeline shared by the Item Return and Item
// Dropping task types.
//
// One `itemTransferOrders` row per Business Central Transfer Order (TOA no),
// tracking 3 phases end-to-end across two stores:
//
//   1. Item Return   (pickup at the FROM store)
//        start: returnDetectedAt  — first time our sync saw this TOA against
//                                   a matched store's transferFromCode
//        end:   returnSubmittedAt — employee confirms hand-off to courier
//   2. Shipping       (in transit) — derived, no separate columns:
//        start: returnSubmittedAt
//        end:   droppingSubmittedAt
//   3. Item Receiving (put-away at the TO store)
//        start: droppingSubmittedAt — employee confirms drop-off from courier
//        end:   receivedAt          — BC Posted Whse Receipts confirms
//                                     put-away (sourceNo match); no employee
//                                     action, closed by sync only.
//
// `itemReturnEntries`/`itemDroppingEntries` (lib/db/schema/tasks.ts) hold the
// per-employee confirmation (qty counted, courier-sign photo) for their leg
// and link back here via `transferOrderId`.
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

import { stores } from './core';

export const itemTransferOrders = pgTable('item_transfer_orders', {
  id: serial('id').primaryKey(),

  // Business Central Transfer Order no, e.g. "TOA26003644".
  toaNo: text('toa_no').notNull(),

  // Business Central location codes (ppQueryTransferOrders.transferFromCode /
  // transferToCode). Kept even when unmatched to a store, for audit/display.
  transferFromCode: text('transfer_from_code').notNull(),
  transferToCode:   text('transfer_to_code').notNull(),

  // Resolved by matching the code above against stores.storeNo. Null when
  // the code doesn't correspond to a store we manage (e.g. a central
  // "DM-RETURN" warehouse) — that leg simply has no task generated.
  fromStoreId: integer('from_store_id').references(() => stores.id),
  toStoreId:   integer('to_store_id').references(() => stores.id),

  qtyOrdered: integer('qty_ordered').default(0).notNull(),

  bcStatus:    text('bc_status'),
  postingDate: timestamp('posting_date', { mode: 'date' }),

  // ── Phase 1: Item Return ──────────────────────────────────────────────────
  returnDetectedAt:  timestamp('return_detected_at',  { mode: 'date' }),
  returnSubmittedAt: timestamp('return_submitted_at', { mode: 'date' }),

  // ── Phase 2 (shipping) surfaces + Phase 3 start ──────────────────────────
  whseShipmentNo:      text('whse_shipment_no'),
  // JSON array of { itemNo, variantCode, description, quantity } lines from
  // Posted Whse Shipments, summed per whseShipmentNo. Display-only.
  whseShipmentLines:   text('whse_shipment_lines'),
  droppingDetectedAt:  timestamp('dropping_detected_at',  { mode: 'date' }),
  droppingSubmittedAt: timestamp('dropping_submitted_at', { mode: 'date' }),

  // ── Phase 3: Item Receiving — closed by sync only ────────────────────────
  receivedAt: timestamp('received_at', { mode: 'date' }),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
  toaNoUnique:        unique('item_transfer_orders_toa_no_unique').on(t.toaNo),
  fromStoreIdx:        index('item_transfer_orders_from_store_idx').on(t.fromStoreId),
  toStoreIdx:          index('item_transfer_orders_to_store_idx').on(t.toStoreId),
  whseShipmentNoIdx:   index('item_transfer_orders_whse_shipment_no_idx').on(t.whseShipmentNo),
}));

export type ItemTransferOrder    = typeof itemTransferOrders.$inferSelect;
export type NewItemTransferOrder = typeof itemTransferOrders.$inferInsert;

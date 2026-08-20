// lib/db/utils/item-transfers.ts
// ─────────────────────────────────────────────────────────────────────────────
// BC-driven sync + confirm logic for the Item Return / Item Dropping
// transfer-order pipeline (see lib/db/schema/item-transfers.ts for the
// 3-phase model this maintains).
//
// Sync functions are called live, on demand — there is no cron. Employee
// task screens trigger the store-scoped sync every time they're opened;
// the OPS dashboard triggers the store-agnostic registry + receiving sync
// every time it's opened/refreshed.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  itemTransferOrders,
  itemReturnEntries,
  itemDroppingEntries,
  itemReturnTasks,
  itemDroppingTasks,
  stores,
  attendance,
  type ItemTransferOrder,
  type ItemReturnEntry,
  type ItemDroppingEntry,
} from '@/lib/db/schema';
import { getActiveBusinessCentralSettings } from '@/lib/performance/business-central-settings';
import { fetchAllBusinessCentralRows } from '@/lib/bc/client';
import {
  getOrCreateItemReturnRow,
  getActiveItemReturnTask,
} from '@/lib/db/utils/item-return';
import {
  getOrCreateItemDroppingRow,
  getActiveItemDroppingTask,
} from '@/lib/db/utils/item-dropping';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

// ─── Guard helpers (mirrors item-return.ts/item-dropping.ts) ──────────────────

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);

  if (!att?.checkInTime) {
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  }

  return null;
}

async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;

  const dist = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

async function assertCanProgressTask(
  scheduleId: number,
  storeId: number,
  geo: GeoPoint,
  skipGeo?: boolean,
): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;

  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }

  return null;
}

function jsonPhotos(paths: string[]): string | null {
  return paths.length > 0 ? JSON.stringify(paths) : null;
}

// ─── BC row shapes ──────────────────────────────────────────────────────────

interface BcTransferOrderRow {
  no: string;
  transferFromCode: string;
  transferToCode: string;
  postingDate?: string;
  status?: string;
  totalQtyOrder?: number;
}

function isBcTransferOrderRow(row: unknown): row is BcTransferOrderRow {
  if (!row || typeof row !== 'object') return false;
  const c = row as Partial<BcTransferOrderRow>;
  return (
    typeof c.no === 'string' && c.no.length > 0 &&
    typeof c.transferFromCode === 'string' &&
    typeof c.transferToCode === 'string'
  );
}

interface BcWhseShipmentRow {
  whseShipmentNo: string;
  transferOrderNo: string;
  transferFromCode: string;
  transferToCode: string;
  itemNo?: string;
  variantCode?: string;
  description?: string;
  quantity?: number;
}

function isBcWhseShipmentRow(row: unknown): row is BcWhseShipmentRow {
  if (!row || typeof row !== 'object') return false;
  const c = row as Partial<BcWhseShipmentRow>;
  return (
    typeof c.whseShipmentNo === 'string' && c.whseShipmentNo.length > 0 &&
    typeof c.transferOrderNo === 'string' && c.transferOrderNo.length > 0 &&
    typeof c.transferFromCode === 'string' &&
    typeof c.transferToCode === 'string'
  );
}

interface BcWhseReceiptRow {
  sourceNo: string;
}

function isBcWhseReceiptRow(row: unknown): row is BcWhseReceiptRow {
  if (!row || typeof row !== 'object') return false;
  const c = row as Partial<BcWhseReceiptRow>;
  return typeof c.sourceNo === 'string' && c.sourceNo.length > 0;
}

export interface WhseShipmentLine {
  itemNo?: string;
  variantCode?: string;
  description?: string;
  quantity: number;
}

interface WhseShipmentGroup {
  whseShipmentNo: string;
  transferOrderNo: string;
  transferFromCode: string;
  transferToCode: string;
  qty: number;
  lines: WhseShipmentLine[];
}

// ─── BC fetchers ────────────────────────────────────────────────────────────

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

/**
 * `storeNo` narrows the OData query itself (same $filter pattern proven in
 * lib/performance/business-central-sales.ts against this tenant) instead of
 * pulling every transfer order company-wide and filtering client-side —
 * this is what made the employee Item Transfers page and every OPS sync
 * slow: each load re-fetched the *entire* dataset regardless of which one
 * store actually needed it. Omit `storeNo` for the OPS-wide registry sync,
 * which genuinely needs every row.
 */
async function fetchTransferOrders(storeNo?: string): Promise<BcTransferOrderRow[]> {
  const settings = await getActiveBusinessCentralSettings('transfer_orders');
  if (!settings) {
    throw new Error(
      'BC Transfer Orders belum dikonfigurasi. Tambahkan business_central_settings dengan code=transfer_orders (OPS → BC Credentials).',
    );
  }
  const url = new URL(settings.apiUrl);
  if (storeNo) {
    url.searchParams.set('$filter', `transferFromCode eq '${escapeODataString(storeNo)}'`);
  }
  const rows = await fetchAllBusinessCentralRows(url.toString(), settings);
  return rows.filter(isBcTransferOrderRow);
}

// The `whse_shipments`/`whse_receipts` BC settings rows both store the API
// URL with a "startswith(..., 'TOA')" clause meant to keep these company-wide
// warehouse feeds (which also carry unrelated purchase-order traffic, e.g.
// "PORA..." receipts) scoped to transfer orders only — but the stored query
// string lost its `$filter=` key at some point (it's literally `?=2.0&=star
// tswith(...)`, verified against the live tenant), so BC silently ignores it
// and these calls return EVERY warehouse movement since the integration's
// inception. That is the actual cause of the OPS dashboard's multi-minute
// loads (confirmed: an unbounded fetchWhseReceipts() call alone took 4+
// minutes and returned enough rows to blow past Postgres's bound-parameter
// limit). Re-apply the intended filter explicitly here — proven to work
// against this tenant — instead of relying on the stored URL's broken one.
const TOA_RECEIPT_LOOKBACK_DAYS = 180;

async function fetchWhseShipments(storeNo?: string): Promise<BcWhseShipmentRow[]> {
  const settings = await getActiveBusinessCentralSettings('whse_shipments');
  if (!settings) {
    throw new Error(
      'BC Posted Whse Shipments belum dikonfigurasi. Tambahkan business_central_settings dengan code=whse_shipments (OPS → BC Credentials).',
    );
  }
  const url = new URL(settings.apiUrl);
  const filters = [`startswith(transferOrderNo,'TOA')`];
  if (storeNo) filters.push(`transferToCode eq '${escapeODataString(storeNo)}'`);
  url.searchParams.set('$filter', filters.join(' and '));
  const rows = await fetchAllBusinessCentralRows(url.toString(), settings);
  return rows.filter(isBcWhseShipmentRow);
}

async function fetchWhseReceipts(): Promise<BcWhseReceiptRow[]> {
  const settings = await getActiveBusinessCentralSettings('whse_receipts');
  if (!settings) {
    throw new Error(
      'BC Posted Whse Receipts belum dikonfigurasi. Tambahkan business_central_settings dengan code=whse_receipts (OPS → BC Credentials).',
    );
  }
  const url = new URL(settings.apiUrl);
  const since = new Date(Date.now() - TOA_RECEIPT_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  url.searchParams.set('$filter', `startswith(sourceNo,'TOA') and postingDate ge ${since}`);
  const rows = await fetchAllBusinessCentralRows(url.toString(), settings);
  return rows.filter(isBcWhseReceiptRow);
}

function groupWhseShipments(rows: BcWhseShipmentRow[]): Map<string, WhseShipmentGroup> {
  const groups = new Map<string, WhseShipmentGroup>();

  for (const r of rows) {
    const existing = groups.get(r.whseShipmentNo);
    const line: WhseShipmentLine = {
      itemNo: r.itemNo,
      variantCode: r.variantCode,
      description: r.description,
      quantity: r.quantity ?? 0,
    };

    if (existing) {
      existing.qty += line.quantity;
      existing.lines.push(line);
    } else {
      groups.set(r.whseShipmentNo, {
        whseShipmentNo: r.whseShipmentNo,
        transferOrderNo: r.transferOrderNo,
        transferFromCode: r.transferFromCode,
        transferToCode: r.transferToCode,
        qty: line.quantity,
        lines: [line],
      });
    }
  }

  return groups;
}

// ─── Upsert helpers ─────────────────────────────────────────────────────────

async function upsertTransferOrderFromToRow(
  row: BcTransferOrderRow,
  fromStoreId: number | null,
): Promise<ItemTransferOrder> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(itemTransferOrders)
    .where(eq(itemTransferOrders.toaNo, row.no))
    .limit(1);

  const postingDate = row.postingDate ? new Date(row.postingDate) : null;

  if (existing) {
    const [updated] = await db
      .update(itemTransferOrders)
      .set({
        transferFromCode: row.transferFromCode,
        transferToCode: row.transferToCode,
        qtyOrdered: row.totalQtyOrder ?? existing.qtyOrdered,
        bcStatus: row.status ?? existing.bcStatus,
        postingDate: postingDate ?? existing.postingDate,
        fromStoreId: fromStoreId ?? existing.fromStoreId,
        // BUG FIX: this row can already exist as a stub created by the
        // dropping/shipment leg (upsertTransferOrderFromShipmentGroup), which
        // never sets returnDetectedAt. Without this fallback, the "TO
        // created" timestamp stays null forever whenever the Warehouse
        // Shipment is detected before the Transfer Order itself — a very
        // real race once both legs sync independently per store/visit.
        returnDetectedAt: existing.returnDetectedAt ?? now,
        updatedAt: now,
      })
      .where(eq(itemTransferOrders.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(itemTransferOrders)
    .values({
      toaNo: row.no,
      transferFromCode: row.transferFromCode,
      transferToCode: row.transferToCode,
      fromStoreId,
      qtyOrdered: row.totalQtyOrder ?? 0,
      bcStatus: row.status ?? null,
      postingDate,
      returnDetectedAt: now,
    })
    .returning();
  return created;
}

async function upsertTransferOrderFromShipmentGroup(
  group: WhseShipmentGroup,
  toStoreId: number | null,
): Promise<ItemTransferOrder> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(itemTransferOrders)
    .where(eq(itemTransferOrders.toaNo, group.transferOrderNo))
    .limit(1);

  const linesJson = JSON.stringify(group.lines);

  if (existing) {
    const [updated] = await db
      .update(itemTransferOrders)
      .set({
        whseShipmentNo: group.whseShipmentNo,
        whseShipmentLines: linesJson,
        toStoreId: toStoreId ?? existing.toStoreId,
        droppingDetectedAt: existing.droppingDetectedAt ?? now,
        updatedAt: now,
      })
      .where(eq(itemTransferOrders.id, existing.id))
      .returning();
    return updated;
  }

  // The dropping (Posted Whse Shipments) leg can appear before we've ever
  // synced the matching Transfer Order — create a stub row from what we know.
  const [created] = await db
    .insert(itemTransferOrders)
    .values({
      toaNo: group.transferOrderNo,
      transferFromCode: group.transferFromCode,
      transferToCode: group.transferToCode,
      toStoreId,
      qtyOrdered: group.qty,
      whseShipmentNo: group.whseShipmentNo,
      whseShipmentLines: linesJson,
      droppingDetectedAt: now,
    })
    .returning();
  return created;
}

// ─── Batch upserts (registry sync only) ────────────────────────────────────
// The company-wide registry sync can touch hundreds of transfer orders per
// run. Doing a SELECT + INSERT/UPDATE per row (as the single-row helpers
// above do, fine for a store-scoped sync of a handful of rows) turned every
// OPS dashboard load/refresh into hundreds of sequential round trips against
// Neon's HTTP driver — this is what made the page "loading so long". These
// batch variants do the same upsert semantics (create fresh, freeze
// detected-at timestamps once set) in one statement each via
// ON CONFLICT ... DO UPDATE, using SQL COALESCE so a fresh INSERT and an
// UPDATE-that-preserves-existing-timestamps both fall out of the same query
// regardless of row ordering.

/** Last-one-wins de-dupe by key — a single INSERT ... ON CONFLICT statement
 *  errors out ("ON CONFLICT DO UPDATE command cannot affect row a second
 *  time") if the same conflict target appears twice, which the per-row
 *  sequential loop this replaces never had to worry about. */
function dedupeByKey<T>(items: T[], key: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item);
  return [...map.values()];
}

async function batchUpsertTransferOrdersFromToRows(
  rowsIn: BcTransferOrderRow[],
  storeIdByCode: Map<string, number>,
): Promise<void> {
  const rows = dedupeByKey(rowsIn, (r) => r.no);
  if (!rows.length) return;
  const now = new Date();

  const values = rows.map((row) => ({
    toaNo: row.no,
    transferFromCode: row.transferFromCode,
    transferToCode: row.transferToCode,
    fromStoreId: storeIdByCode.get(row.transferFromCode) ?? null,
    qtyOrdered: row.totalQtyOrder ?? 0,
    bcStatus: row.status ?? null,
    postingDate: row.postingDate ? new Date(row.postingDate) : null,
    returnDetectedAt: now,
  }));

  await db
    .insert(itemTransferOrders)
    .values(values)
    .onConflictDoUpdate({
      target: itemTransferOrders.toaNo,
      set: {
        transferFromCode: sql`excluded.transfer_from_code`,
        transferToCode: sql`excluded.transfer_to_code`,
        fromStoreId: sql`coalesce(excluded.from_store_id, item_transfer_orders.from_store_id)`,
        qtyOrdered: sql`excluded.qty_ordered`,
        bcStatus: sql`excluded.bc_status`,
        postingDate: sql`coalesce(excluded.posting_date, item_transfer_orders.posting_date)`,
        // Freeze-once: keep whatever was already recorded, only fall back to
        // this sync's "now" the first time the row is ever seen.
        returnDetectedAt: sql`coalesce(item_transfer_orders.return_detected_at, excluded.return_detected_at)`,
        updatedAt: now,
      },
    });
}

async function batchUpsertTransferOrdersFromShipmentGroups(
  groupsIn: WhseShipmentGroup[],
  storeIdByCode: Map<string, number>,
): Promise<void> {
  // A single TO can have multiple partial Warehouse Shipments (distinct
  // whseShipmentNo, same transferOrderNo) — itemTransferOrders only has room
  // for one whseShipmentNo/whseShipmentLines pair, so (matching the previous
  // sequential loop's behavior) the last one processed wins.
  const groups = dedupeByKey(groupsIn, (g) => g.transferOrderNo);
  if (!groups.length) return;
  const now = new Date();

  const values = groups.map((group) => ({
    toaNo: group.transferOrderNo,
    transferFromCode: group.transferFromCode,
    transferToCode: group.transferToCode,
    toStoreId: storeIdByCode.get(group.transferToCode) ?? null,
    // Only used as the initial value when this row doesn't exist yet (a
    // shipment-first stub) — an existing row's own qtyOrdered (from the
    // Transfer Order itself) is left untouched on conflict, matching the
    // single-row helper's behavior.
    qtyOrdered: group.qty,
    whseShipmentNo: group.whseShipmentNo,
    whseShipmentLines: JSON.stringify(group.lines),
    droppingDetectedAt: now,
  }));

  await db
    .insert(itemTransferOrders)
    .values(values)
    .onConflictDoUpdate({
      target: itemTransferOrders.toaNo,
      set: {
        whseShipmentNo: sql`excluded.whse_shipment_no`,
        whseShipmentLines: sql`excluded.whse_shipment_lines`,
        toStoreId: sql`coalesce(excluded.to_store_id, item_transfer_orders.to_store_id)`,
        droppingDetectedAt: sql`coalesce(item_transfer_orders.dropping_detected_at, excluded.dropping_detected_at)`,
        updatedAt: now,
      },
    });
}

// ─── Status recompute ───────────────────────────────────────────────────────
// Container status is fully derived from its entries: no entries yet →
// leave as-is (not_started); some entries still open → in_progress; every
// entry confirmed → completed. Re-running sync can reopen a completed
// container if a fresh transfer order shows up later the same day.

async function recomputeItemReturnStatus(taskId: number): Promise<void> {
  const entries = await db
    .select({ submittedAt: itemReturnEntries.submittedAt })
    .from(itemReturnEntries)
    .where(eq(itemReturnEntries.taskId, taskId));

  if (entries.length === 0) return;

  const allDone = entries.every((e) => e.submittedAt != null);
  const now = new Date();

  await db
    .update(itemReturnTasks)
    .set({
      hasReturn: true,
      status: allDone ? 'completed' : 'in_progress',
      completedAt: allDone ? now : null,
      updatedAt: now,
    })
    .where(eq(itemReturnTasks.id, taskId));
}

async function recomputeItemDroppingStatus(taskId: number): Promise<void> {
  const entries = await db
    .select({ submittedAt: itemDroppingEntries.submittedAt })
    .from(itemDroppingEntries)
    .where(eq(itemDroppingEntries.taskId, taskId));

  if (entries.length === 0) return;

  const allDone = entries.every((e) => e.submittedAt != null);
  const now = new Date();

  await db
    .update(itemDroppingTasks)
    .set({
      hasDropping: true,
      status: allDone ? 'completed' : 'in_progress',
      completedAt: allDone ? now : null,
      updatedAt: now,
    })
    .where(eq(itemDroppingTasks.id, taskId));
}

// ─── Store-scoped sync (employee task screens) ─────────────────────────────

export interface SyncContext {
  scheduleId: number;
  userId: string;
  date: Date;
  /**
   * The shift of the specific task row being synced (e.g. the task the
   * employee currently has open) — NOT necessarily the acting employee's own
   * shift. Item Dropping/Return are now genuinely per-shift, so the sync
   * must attach newly-synced entries to the exact row being displayed.
   */
  shiftId: number;
}

export async function syncItemReturnForStore(
  storeId: number,
  ctx: SyncContext,
): Promise<TaskResult<{ synced: number }>> {
  try {
    const [store] = await db
      .select({ id: stores.id, storeNo: stores.storeNo })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) return { success: false, error: 'Toko tidak ditemukan.' };

    const matched = await fetchTransferOrders(store.storeNo);
    if (!matched.length) return { success: true, data: { synced: 0 } };

    const task = await getOrCreateItemReturnRow(ctx.scheduleId, ctx.userId, storeId, ctx.shiftId, ctx.date);

    let synced = 0;
    for (const row of matched) {
      const toRow = await upsertTransferOrderFromToRow(row, storeId);

      // INSERT ... ON CONFLICT DO NOTHING instead of SELECT-then-INSERT: the
      // employee page's own React effect can fire this sync twice in a row
      // (StrictMode/fast re-navigation), and a full_day schedule syncs the
      // SAME store's morning + evening task rows concurrently via
      // Promise.all — both hit this loop for the same new toRow.id at the
      // same time. A separate existence check can't see the other
      // in-flight insert, so both pass it and the second insert throws a
      // unique-constraint violation on transferOrderId. Let Postgres itself
      // resolve the race atomically.
      const inserted = await db
        .insert(itemReturnEntries)
        .values({
          taskId: task.id,
          userId: ctx.userId,
          storeId,
          returnNumber: toRow.toaNo,
          quantity: toRow.qtyOrdered,
          returnTime: new Date(),
          transferOrderId: toRow.id,
          qtyOrdered: toRow.qtyOrdered,
        })
        .onConflictDoNothing({ target: itemReturnEntries.transferOrderId })
        .returning({ id: itemReturnEntries.id });
      if (inserted.length > 0) synced += 1;
    }

    if (synced > 0) await recomputeItemReturnStatus(task.id);

    return { success: true, data: { synced } };
  } catch (err) {
    return { success: false, error: `syncItemReturnForStore: ${err}` };
  }
}

export async function syncItemDroppingForStore(
  storeId: number,
  ctx: SyncContext,
): Promise<TaskResult<{ synced: number }>> {
  try {
    const [store] = await db
      .select({ id: stores.id, storeNo: stores.storeNo })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) return { success: false, error: 'Toko tidak ditemukan.' };

    const matched = await fetchWhseShipments(store.storeNo);
    if (!matched.length) return { success: true, data: { synced: 0 } };

    const groups = groupWhseShipments(matched);
    const task = await getOrCreateItemDroppingRow(ctx.scheduleId, ctx.userId, storeId, ctx.shiftId, ctx.date);

    let synced = 0;
    for (const group of groups.values()) {
      const toRow = await upsertTransferOrderFromShipmentGroup(group, storeId);

      // See the matching comment in syncItemReturnForStore — atomic
      // insert-or-skip instead of a racy SELECT-then-INSERT.
      const inserted = await db
        .insert(itemDroppingEntries)
        .values({
          taskId: task.id,
          userId: ctx.userId,
          storeId,
          toNumber: toRow.toaNo,
          quantity: group.qty,
          dropTime: new Date(),
          transferOrderId: toRow.id,
          qtyOrdered: group.qty,
        })
        .onConflictDoNothing({ target: itemDroppingEntries.transferOrderId })
        .returning({ id: itemDroppingEntries.id });
      if (inserted.length > 0) synced += 1;
    }

    if (synced > 0) await recomputeItemDroppingStatus(task.id);

    return { success: true, data: { synced } };
  } catch (err) {
    return { success: false, error: `syncItemDroppingForStore: ${err}` };
  }
}

// ─── Store-agnostic sync (OPS dashboard) ───────────────────────────────────
// Upserts itemTransferOrders across every known store WITHOUT touching any
// task/entry rows (those only get created when an employee actually opens
// their Item Return / Item Dropping task for their own store) — this just
// keeps the dashboard's registry current, including transfer orders no
// employee has looked at yet.

export async function syncTransferOrderRegistry(): Promise<TaskResult<{ synced: number }>> {
  try {
    const allStores = await db.select({ id: stores.id, storeNo: stores.storeNo }).from(stores);
    const storeIdByCode = new Map(allStores.map((s) => [s.storeNo, s.id]));

    const [toRows, shipmentRows] = await Promise.all([
      fetchTransferOrders(),
      fetchWhseShipments(),
    ]);

    const shipmentGroups = [...groupWhseShipments(shipmentRows).values()];

    // TO rows batch first, shipment groups second — a shipment group whose
    // TOA no isn't in the DB yet still needs the TO row to land first so it
    // updates the freshly-created row (and its returnDetectedAt) instead of
    // both racing to insert the same toaNo.
    await batchUpsertTransferOrdersFromToRows(toRows, storeIdByCode);
    await batchUpsertTransferOrdersFromShipmentGroups(shipmentGroups, storeIdByCode);

    return { success: true, data: { synced: toRows.length + shipmentGroups.length } };
  } catch (err) {
    return { success: false, error: `syncTransferOrderRegistry: ${err}` };
  }
}

/** Closes phase 3 (Item Receiving) for open transfer orders whose TOA no now appears in Posted Whse Receipts. */
export async function syncReceivingStatus(
  scope: 'all' | number[] = 'all',
): Promise<TaskResult<{ closed: number }>> {
  try {
    const receipts = await fetchWhseReceipts();
    const sourceNos = [...new Set(receipts.map((r) => r.sourceNo))];
    if (sourceNos.length === 0) return { success: true, data: { closed: 0 } };

    const closeConditions = [
      isNotNull(itemTransferOrders.droppingSubmittedAt),
      isNull(itemTransferOrders.receivedAt),
      inArray(itemTransferOrders.toaNo, sourceNos),
    ];
    if (scope !== 'all') closeConditions.push(inArray(itemTransferOrders.toStoreId, scope));

    const now = new Date();
    const closed = await db
      .update(itemTransferOrders)
      .set({ receivedAt: now, updatedAt: now })
      .where(and(...closeConditions))
      .returning({ id: itemTransferOrders.id });

    return { success: true, data: { closed: closed.length } };
  } catch (err) {
    return { success: false, error: `syncReceivingStatus: ${err}` };
  }
}

// ─── Confirm (per-transfer-order, employee action) ─────────────────────────

export interface ConfirmEntryInput {
  entryId: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
  qtyCounted: number;
  courierSignPhoto: string;
}

function validateConfirmInput(input: ConfirmEntryInput): string | null {
  if (!Number.isFinite(input.qtyCounted) || input.qtyCounted < 0) {
    return 'Jumlah yang dihitung wajib diisi dan tidak boleh negatif.';
  }
  if (!input.courierSignPhoto) {
    return 'Foto bukti tanda tangan kurir wajib diupload.';
  }
  return null;
}

export async function confirmItemReturn(
  input: ConfirmEntryInput,
): Promise<TaskResult<ItemReturnEntry>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateConfirmInput(input);
    if (validationErr) return { success: false, error: validationErr };

    const [entry] = await db.select().from(itemReturnEntries).where(eq(itemReturnEntries.id, input.entryId)).limit(1);
    if (!entry) return { success: false, error: 'Item return tidak ditemukan.' };
    if (entry.storeId !== input.storeId) return { success: false, error: 'Item return ini bukan milik toko ini.' };
    if (entry.submittedAt) return { success: false, error: 'Item return ini sudah dikonfirmasi.' };

    const now = new Date();
    const qtyCounted = Math.floor(input.qtyCounted);

    const [updated] = await db
      .update(itemReturnEntries)
      .set({
        qtyCounted,
        courierSignPhoto: input.courierSignPhoto,
        returnPhotos: jsonPhotos([input.courierSignPhoto]),
        returnTime: now,
        submittedAt: now,
        submittedBy: input.userId,
        updatedAt: now,
      })
      .where(eq(itemReturnEntries.id, input.entryId))
      .returning();

    if (entry.transferOrderId) {
      await db
        .update(itemTransferOrders)
        .set({ returnSubmittedAt: now, updatedAt: now })
        .where(eq(itemTransferOrders.id, entry.transferOrderId));
    }

    await recomputeItemReturnStatus(entry.taskId);

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `confirmItemReturn: ${err}` };
  }
}

export async function confirmItemDropping(
  input: ConfirmEntryInput,
): Promise<TaskResult<ItemDroppingEntry>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateConfirmInput(input);
    if (validationErr) return { success: false, error: validationErr };

    const [entry] = await db.select().from(itemDroppingEntries).where(eq(itemDroppingEntries.id, input.entryId)).limit(1);
    if (!entry) return { success: false, error: 'Item dropping tidak ditemukan.' };
    if (entry.storeId !== input.storeId) return { success: false, error: 'Item dropping ini bukan milik toko ini.' };
    if (entry.submittedAt) return { success: false, error: 'Item dropping ini sudah dikonfirmasi.' };

    const now = new Date();
    const qtyCounted = Math.floor(input.qtyCounted);

    const [updated] = await db
      .update(itemDroppingEntries)
      .set({
        qtyCounted,
        courierSignPhoto: input.courierSignPhoto,
        droppingPhotos: jsonPhotos([input.courierSignPhoto]),
        dropTime: now,
        submittedAt: now,
        submittedBy: input.userId,
        updatedAt: now,
      })
      .where(eq(itemDroppingEntries.id, input.entryId))
      .returning();

    if (entry.transferOrderId) {
      await db
        .update(itemTransferOrders)
        .set({ droppingSubmittedAt: now, updatedAt: now })
        .where(eq(itemTransferOrders.id, entry.transferOrderId));
    }

    await recomputeItemDroppingStatus(entry.taskId);

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `confirmItemDropping: ${err}` };
  }
}

// ─── Read helpers ───────────────────────────────────────────────────────────

export async function getItemReturnEntriesWithTransferOrder(taskId: number) {
  return db
    .select({ entry: itemReturnEntries, transferOrder: itemTransferOrders })
    .from(itemReturnEntries)
    .leftJoin(itemTransferOrders, eq(itemReturnEntries.transferOrderId, itemTransferOrders.id))
    .where(eq(itemReturnEntries.taskId, taskId))
    .orderBy(itemReturnEntries.createdAt);
}

export async function getItemDroppingEntriesWithTransferOrder(taskId: number) {
  return db
    .select({ entry: itemDroppingEntries, transferOrder: itemTransferOrders })
    .from(itemDroppingEntries)
    .leftJoin(itemTransferOrders, eq(itemDroppingEntries.transferOrderId, itemTransferOrders.id))
    .where(eq(itemDroppingEntries.taskId, taskId))
    .orderBy(itemDroppingEntries.createdAt);
}

export { getActiveItemReturnTask, getActiveItemDroppingTask };

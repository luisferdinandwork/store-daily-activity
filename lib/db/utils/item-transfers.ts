// lib/db/utils/item-transfers.ts
// ─────────────────────────────────────────────────────────────────────────────
// BC-driven sync + confirm logic for the Item Return / Item Dropping
// transfer-order pipeline (see lib/db/schema/item-transfers.ts for the
// 3-phase model this maintains).
//
// Business Central is pulled company-wide by refreshTransferRegistry /
// refreshReceivingStatus (transfer-order-refresh.ts): a 5-minute cron
// (/api/cron/transfer-orders) keeps the registry warm, and the employee page,
// the badge poll and the OPS dashboard trigger the same single-flight,
// throttled refresh as a fallback — so a new transfer order is noticed (and
// its time recorded) within minutes instead of whenever somebody happened to
// open a page. The per-store functions below are database-only: they turn the
// registry into entries on today's task.
// ─────────────────────────────────────────────────────────────────────────────

import type { GeoPoint } from '@/lib/geo';
import { assertInGeofence } from '@/lib/db/utils/geofence';
import { db } from '@/lib/db';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
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
import { getActiveItemReturnTask } from '@/lib/db/utils/item-return';
import { getActiveItemDroppingTask } from '@/lib/db/utils/item-dropping';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type { GeoPoint };

// ─── Guard helpers (mirrors item-return.ts/item-dropping.ts) ──────────────────

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

/**
 * Panatrade's central warehouse/distribution location codes all start with
 * "DM" (seen so far: DM, DM-RETURN, DM-BAD) — none of them are a real store
 * with a scheduled employee using this app, so neither Item Return nor Item
 * Receiving ever gets a human confirmation on that side of the transfer.
 */
export function isWarehouseCode(code: string): boolean {
  return /^dm/i.test(code.trim());
}

// ─── BC row shapes ──────────────────────────────────────────────────────────

interface BcTransferOrderRow {
  no: string;
  transferFromCode: string;
  transferToCode: string;
  /**
   * NOT in ppQueryTransferOrders today (it only carries dates). If BC's team
   * adds the field to that query, "TO created" becomes exact on its own — see
   * the returnDetectedAt handling in batchUpsertTransferOrdersFromToRows.
   */
  systemCreatedAt?: string;
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
  /** BC's own creation instant (UTC, e.g. "2026-10-22T02:59:08.68Z"). */
  systemCreatedAt?: string;
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
  /** Earliest BC `systemCreatedAt` among the shipment's lines, if BC sent one. */
  createdAt: Date | null;
}

// ─── BC fetchers ────────────────────────────────────────────────────────────

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

/**
 * Build a BC OData request URL from the stored endpoint, ignoring whatever
 * query string it currently carries. The stored `apiUrl` is edited by hand in
 * OPS → BC Credentials and has been saved broken before (e.g. `?=2.0` after
 * someone deleted a `$filter`, dropping `$schemaversion` with it), which
 * silently changed every result. Only the origin + path are trusted; we
 * always re-apply `$schemaversion=2.0` and our own `$filter`.
 */
function bcRequestUrl(apiUrl: string, filter?: string): string {
  const stored = new URL(apiUrl);
  const url = new URL(stored.origin + stored.pathname);
  url.searchParams.set('$schemaversion', '2.0');
  if (filter) url.searchParams.set('$filter', filter);
  return url.toString();
}

/**
 * Every transfer order company-wide (any status — Open ones matter to OPS)
 * posted in the recency window. There is deliberately no per-store variant:
 * the store-filtered query (`transferFromCode eq '<storeNo>'`) was shown to
 * drop rows this unscoped feed returns, and this tenant's OData rejects `OR`
 * across distinct fields, so one company-wide pull (shared by every store, see
 * refreshTransferRegistry) is both the most complete and the cheapest option.
 */
async function fetchTransferOrders(lookbackDays: number): Promise<BcTransferOrderRow[]> {
  const settings = await getActiveBusinessCentralSettings('transfer_orders');
  if (!settings) {
    throw new Error(
      'BC Transfer Orders belum dikonfigurasi. Tambahkan business_central_settings dengan code=transfer_orders (OPS → BC Credentials).',
    );
  }
  const filter = `postingDate ge ${lookbackDate(lookbackDays)}`;
  const rows = await fetchAllBusinessCentralRows(bcRequestUrl(settings.apiUrl, filter), settings);
  return rows.filter(isBcTransferOrderRow);
}

// The `whse_shipments`/`whse_receipts` feeds are company-wide and carry
// unrelated warehouse traffic (PORA receipts, etc.). We always rebuild the
// `$filter` explicitly here rather than trusting the stored URL's query
// string. For Posted Whse Receipts especially, a broad
// "startswith(sourceNo,'TOA') and postingDate ge <N days>" pull returns
// >140k rows / 25s+ against the live tenant — enough to time the OPS
// dashboard out. `syncReceivingStatus` instead asks BC only about the
// specific transfer orders it is still waiting on (see fetchWhseReceiptsFor).
const RECEIPT_FILTER_CHUNK = 15;

// The registry/receiving syncs only care about transfers that could still be
// in flight. Anything posted more than this many days ago is long since
// received — bounding the company-wide pulls by postingDate keeps them fast.
// The frequent "light" refresh (see transfer-order-refresh.ts) looks back
// only LIGHT_LOOKBACK_DAYS: it exists to notice NEW orders/shipments quickly,
// the full window is what reconciles (prunes) old ones.
export const REGISTRY_LOOKBACK_DAYS = 90;
export const LIGHT_LOOKBACK_DAYS = 14;

function lookbackDate(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function fetchWhseShipments(lookbackDays: number): Promise<BcWhseShipmentRow[]> {
  const settings = await getActiveBusinessCentralSettings('whse_shipments');
  if (!settings) {
    throw new Error(
      'BC Posted Whse Shipments belum dikonfigurasi. Tambahkan business_central_settings dengan code=whse_shipments (OPS → BC Credentials).',
    );
  }
  const filters = [`startswith(transferOrderNo,'TOA')`, `postingDate ge ${lookbackDate(lookbackDays)}`];
  const rows = await fetchAllBusinessCentralRows(
    bcRequestUrl(settings.apiUrl, filters.join(' and ')),
    settings,
  );
  return rows.filter(isBcWhseShipmentRow);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const RECEIPT_FETCH_CONCURRENCY = 4;

/**
 * Fetches Posted Whse Receipts for a specific set of transfer-order numbers
 * only — `sourceNo eq 'TOA…' or sourceNo eq 'TOA…'`, chunked so no single
 * OData URL gets unreasonably long (and fetched a few chunks at a time — with
 * a few hundred shipped orders open this used to be 20+ sequential round
 * trips). This replaces the old unbounded "every TOA receipt in the last N
 * days" pull.
 */
async function fetchWhseReceiptsFor(sourceNos: string[]): Promise<BcWhseReceiptRow[]> {
  const unique = [...new Set(sourceNos.filter(Boolean))];
  if (unique.length === 0) return [];

  const settings = await getActiveBusinessCentralSettings('whse_receipts');
  if (!settings) {
    throw new Error(
      'BC Posted Whse Receipts belum dikonfigurasi. Tambahkan business_central_settings dengan code=whse_receipts (OPS → BC Credentials).',
    );
  }

  const perChunk = await mapPool(chunk(unique, RECEIPT_FILTER_CHUNK), RECEIPT_FETCH_CONCURRENCY, async (group) => {
    const filter = group.map((n) => `sourceNo eq '${escapeODataString(n)}'`).join(' or ');
    const rows = await fetchAllBusinessCentralRows(bcRequestUrl(settings.apiUrl, filter), settings);
    return rows.filter(isBcWhseReceiptRow);
  });
  return perChunk.flat();
}

function parseBcInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function earlierOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
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
    const createdAt = parseBcInstant(r.systemCreatedAt);

    if (existing) {
      existing.qty += line.quantity;
      existing.lines.push(line);
      existing.createdAt = earlierOf(existing.createdAt, createdAt);
    } else {
      groups.set(r.whseShipmentNo, {
        whseShipmentNo: r.whseShipmentNo,
        transferOrderNo: r.transferOrderNo,
        transferFromCode: r.transferFromCode,
        transferToCode: r.transferToCode,
        qty: line.quantity,
        lines: [line],
        createdAt,
      });
    }
  }

  return groups;
}

// ─── Upserts ────────────────────────────────────────────────────────────────
// Every sync (the 5-minute cron, an OPS dashboard load, an employee opening
// the page) can touch hundreds of transfer orders. A SELECT + INSERT/UPDATE
// per row turned the OPS dashboard into hundreds of sequential round trips, so
// both feeds go in as ONE statement each via ON CONFLICT ... DO UPDATE.
//
// Timestamps:
//  • createdAt/updatedAt are always set from JS (`new Date()`), never left to
//    `defaultNow()`: the DB session runs in Asia/Jakarta and a timestamp
//    WITHOUT time zone then reads back 7h ahead through Drizzle (confirmed on
//    staging: created_at 09:42 vs return_detected_at 02:42 for the same
//    instant), which also scrambled the OPS "latest first" ordering.
//  • Detected-at columns are frozen once set and may only move EARLIER:
//    droppingDetectedAt = BC's own shipment creation time, so a row first
//    seen late is healed down to the truth; returnDetectedAt is clamped to it
//    (a shipment cannot predate its order).
//  • `setWhere` skips rows that did not change, so a 5-minute sweep of the
//    whole window rewrites nothing in the steady state and `updatedAt` keeps
//    meaning "last real change" for the OPS ordering.

/** Every store's code → id, for resolving BC transferFrom/ToCode. */
async function storeIdByCodeMap(): Promise<Map<string, number>> {
  const rows = await db.select({ id: stores.id, storeNo: stores.storeNo }).from(stores);
  return new Map(rows.map((s) => [s.storeNo, s.id]));
}

/** Last-one-wins de-dupe by key — a single INSERT ... ON CONFLICT statement
 *  errors out ("ON CONFLICT DO UPDATE command cannot affect row a second
 *  time") if the same conflict target appears twice. */
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
    // Resolve the DESTINATION store too — an inbound transfer with no
    // Warehouse Shipment yet would otherwise never get a toStoreId and stay
    // invisible on the OPS dashboard (which hides rows where both are null).
    toStoreId: storeIdByCode.get(row.transferToCode) ?? null,
    qtyOrdered: row.totalQtyOrder ?? 0,
    bcStatus: row.status ?? null,
    postingDate: row.postingDate ? new Date(row.postingDate) : null,
    // BC's own creation instant when the feed has one, else "first seen".
    returnDetectedAt: parseBcInstant(row.systemCreatedAt) ?? now,
    createdAt: now,
    updatedAt: now,
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
        toStoreId: sql`coalesce(excluded.to_store_id, item_transfer_orders.to_store_id)`,
        qtyOrdered: sql`excluded.qty_ordered`,
        bcStatus: sql`excluded.bc_status`,
        postingDate: sql`coalesce(excluded.posting_date, item_transfer_orders.posting_date)`,
        // Freeze-once: keep whatever was already recorded, only fall back to
        // this sync's "now" the first time the row is ever seen. A row that
        // began life as a shipment-first stub already has droppingDetectedAt
        // (BC's real shipment time) — `least` ignores NULLs, so the order can
        // never be recorded as created after its own shipment.
        // Like droppingDetectedAt it only ever moves earlier, so an exact BC
        // instant (if the feed ever carries one) replaces a "first seen" guess
        // while a later "first seen" never overwrites anything.
        returnDetectedAt: sql`least(item_transfer_orders.return_detected_at, excluded.return_detected_at, item_transfer_orders.dropping_detected_at)`,
        updatedAt: now,
      },
      setWhere: sql`(
        item_transfer_orders.transfer_from_code is distinct from excluded.transfer_from_code
        or item_transfer_orders.transfer_to_code is distinct from excluded.transfer_to_code
        or item_transfer_orders.qty_ordered is distinct from excluded.qty_ordered
        or item_transfer_orders.bc_status is distinct from excluded.bc_status
        or item_transfer_orders.posting_date is distinct from coalesce(excluded.posting_date, item_transfer_orders.posting_date)
        or (excluded.from_store_id is not null and item_transfer_orders.from_store_id is distinct from excluded.from_store_id)
        or (excluded.to_store_id is not null and item_transfer_orders.to_store_id is distinct from excluded.to_store_id)
        or item_transfer_orders.return_detected_at is null
        or excluded.return_detected_at < item_transfer_orders.return_detected_at
        or item_transfer_orders.return_detected_at > item_transfer_orders.dropping_detected_at
      )`,
    });
}

async function batchUpsertTransferOrdersFromShipmentGroups(
  groupsIn: WhseShipmentGroup[],
  storeIdByCode: Map<string, number>,
): Promise<void> {
  if (!groupsIn.length) return;
  const now = new Date();

  // A single TO can have multiple partial Warehouse Shipments (distinct
  // whseShipmentNo, same transferOrderNo) — itemTransferOrders only has room
  // for one whseShipmentNo/whseShipmentLines pair, so the last one processed
  // wins for those. The TIME, though, is when the FIRST shipment appeared.
  const firstCreated = new Map<string, Date>();
  for (const g of groupsIn) {
    const prev = firstCreated.get(g.transferOrderNo) ?? null;
    const best = earlierOf(prev, g.createdAt);
    if (best) firstCreated.set(g.transferOrderNo, best);
  }

  const groups = dedupeByKey(groupsIn, (g) => g.transferOrderNo);

  const values = groups.map((group) => ({
    toaNo: group.transferOrderNo,
    transferFromCode: group.transferFromCode,
    transferToCode: group.transferToCode,
    toStoreId: storeIdByCode.get(group.transferToCode) ?? null,
    // Only used as the initial value when this row doesn't exist yet (a
    // shipment-first stub) — an existing row's own qtyOrdered (from the
    // Transfer Order itself) is left untouched on conflict.
    qtyOrdered: group.qty,
    whseShipmentNo: group.whseShipmentNo,
    whseShipmentLines: JSON.stringify(group.lines),
    // BC's own "Warehouse Shipment created" instant; the sync time only if BC
    // sent none.
    droppingDetectedAt: firstCreated.get(group.transferOrderNo) ?? now,
    createdAt: now,
    updatedAt: now,
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
        // Only ever moves earlier (see the header note). `least` ignores NULL.
        droppingDetectedAt: sql`least(item_transfer_orders.dropping_detected_at, excluded.dropping_detected_at)`,
        // Never leave the order "created" after its shipment — but don't
        // invent a creation time for a stub the TO feed has not shown yet.
        returnDetectedAt: sql`case when item_transfer_orders.return_detected_at is null then null else least(item_transfer_orders.return_detected_at, excluded.dropping_detected_at) end`,
        updatedAt: now,
      },
      setWhere: sql`(
        item_transfer_orders.whse_shipment_no is distinct from excluded.whse_shipment_no
        or item_transfer_orders.whse_shipment_lines is distinct from excluded.whse_shipment_lines
        or (excluded.to_store_id is not null and item_transfer_orders.to_store_id is distinct from excluded.to_store_id)
        or item_transfer_orders.dropping_detected_at is null
        or excluded.dropping_detected_at < item_transfer_orders.dropping_detected_at
        or item_transfer_orders.return_detected_at > excluded.dropping_detected_at
      )`,
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

// ─── Store-scoped backfill (employee task screens) ─────────────────────────

export interface SyncContext {
  scheduleId: number;
  userId: string;
  date: Date;
  /**
   * The single per-store/day Item Return or Item Dropping task row to attach
   * newly-synced entries to. Item transfers are store-scoped now — every
   * shift sees the same list — so the caller resolves the one task and passes
   * its id here.
   */
  taskId: number;
}

/**
 * THE single definition of "still open" for a store, on both sides of the
 * pipeline. The header badge (`pending-count`), the entry backfill below, and
 * the "new transfer order" notification (transfer-order-notifications.ts) all
 * build on these two predicates — they cannot drift apart from each other.
 *
 * `receivedAt` closes BOTH legs: once BC has posted the receipt (or the
 * warehouse-bound return was handed over) there is nothing left for either
 * store to do. Before, only the dropping leg checked it, so a transfer the
 * destination had already received kept the ORIGIN store's badge lit forever
 * while the employee page (which already treats receivedAt as done) showed it
 * under "Sudah dikonfirmasi".
 *
 * Pass no `storeId` for "any managed store" (the notification sweep).
 */
export function returnOpenWhere(storeId?: number) {
  return and(
    storeId != null ? eq(itemTransferOrders.fromStoreId, storeId) : isNotNull(itemTransferOrders.fromStoreId),
    isNull(itemTransferOrders.returnSubmittedAt),
    isNull(itemTransferOrders.receivedAt),
  );
}

export function droppingOpenWhere(storeId?: number) {
  return and(
    storeId != null ? eq(itemTransferOrders.toStoreId, storeId) : isNotNull(itemTransferOrders.toStoreId),
    isNotNull(itemTransferOrders.whseShipmentNo),
    isNull(itemTransferOrders.droppingSubmittedAt),
    isNull(itemTransferOrders.receivedAt),
  );
}

export async function getOpenTransferOrdersForStore(storeId: number): Promise<{
  returnOpen: ItemTransferOrder[];
  droppingOpen: ItemTransferOrder[];
}> {
  const [returnOpen, droppingOpen] = await Promise.all([
    db.select().from(itemTransferOrders).where(returnOpenWhere(storeId)),
    db.select().from(itemTransferOrders).where(droppingOpenWhere(storeId)),
  ]);
  return { returnOpen, droppingOpen };
}

/**
 * Counts only — what the header badge polls. Same predicates as
 * getOpenTransferOrdersForStore, but `count(*)` instead of dragging every
 * column (including the whseShipmentLines JSON blob) over the wire once per
 * employee per minute.
 */
export async function countOpenTransferOrdersForStore(storeId: number): Promise<{
  returnOpen: number;
  droppingOpen: number;
}> {
  const [[r], [d]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(itemTransferOrders).where(returnOpenWhere(storeId)),
    db.select({ n: sql<number>`count(*)::int` }).from(itemTransferOrders).where(droppingOpenWhere(storeId)),
  ]);
  return { returnOpen: r?.n ?? 0, droppingOpen: d?.n ?? 0 };
}

/**
 * Ensures an Item Return entry on today's task for EVERY transfer order that
 * is open for this store (getOpenTransferOrdersForStore) — database only.
 * Business Central is NOT called here any more: the company-wide registry
 * refresh (transfer-order-refresh.ts, kept warm by cron) already pulled
 * everything, and its feed is more complete than the per-store filtered
 * query this function used to run on every page open.
 */
export async function syncItemReturnForStore(
  storeId: number,
  ctx: SyncContext,
): Promise<TaskResult<{ synced: number }>> {
  try {
    const { returnOpen } = await getOpenTransferOrdersForStore(storeId);
    if (returnOpen.length === 0) return { success: true, data: { synced: 0 } };

    const now = new Date();

    // One INSERT ... ON CONFLICT for all of them. Postgres resolves the race
    // atomically when the page's effect fires twice (StrictMode / fast
    // re-navigation) or a full_day schedule syncs the same store from two
    // task rows at once — a separate existence check can't see the other
    // in-flight insert.
    //
    // On conflict, RE-HOME rather than no-op: a TO not confirmed the day it
    // was first synced would otherwise stay pinned to that earlier day's task
    // (transferOrderId is unique) and vanish from the employee's page from
    // the next day on. `setWhere` leaves a confirmed entry untouched and
    // skips an entry that is already on today's task, so reopening the page
    // writes nothing.
    const inserted = await db
      .insert(itemReturnEntries)
      .values(returnOpen.map((toRow) => ({
        taskId: ctx.taskId,
        userId: ctx.userId,
        storeId,
        returnNumber: toRow.toaNo,
        quantity: toRow.qtyOrdered,
        returnTime: now,
        transferOrderId: toRow.id,
        qtyOrdered: toRow.qtyOrdered,
        createdAt: now,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: itemReturnEntries.transferOrderId,
        set: {
          taskId: ctx.taskId,
          userId: ctx.userId,
          storeId,
          quantity: sql`excluded.quantity`,
          qtyOrdered: sql`excluded.qty_ordered`,
          updatedAt: now,
        },
        setWhere: sql`${itemReturnEntries.submittedAt} is null and (
          ${itemReturnEntries.taskId} is distinct from excluded.task_id
          or ${itemReturnEntries.storeId} is distinct from excluded.store_id
          or ${itemReturnEntries.qtyOrdered} is distinct from excluded.qty_ordered
        )`,
      })
      .returning({ id: itemReturnEntries.id });

    if (inserted.length > 0) await recomputeItemReturnStatus(ctx.taskId);
    return { success: true, data: { synced: inserted.length } };
  } catch (err) {
    return { success: false, error: `syncItemReturnForStore: ${err}` };
  }
}

export async function syncItemDroppingForStore(
  storeId: number,
  ctx: SyncContext,
): Promise<TaskResult<{ synced: number }>> {
  try {
    // See syncItemReturnForStore — same database-only backfill.
    const { droppingOpen } = await getOpenTransferOrdersForStore(storeId);
    if (droppingOpen.length === 0) return { success: true, data: { synced: 0 } };

    const now = new Date();

    const inserted = await db
      .insert(itemDroppingEntries)
      .values(droppingOpen.map((toRow) => ({
        taskId: ctx.taskId,
        userId: ctx.userId,
        storeId,
        toNumber: toRow.toaNo,
        quantity: toRow.qtyOrdered,
        dropTime: now,
        transferOrderId: toRow.id,
        qtyOrdered: toRow.qtyOrdered,
        createdAt: now,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: itemDroppingEntries.transferOrderId,
        set: {
          taskId: ctx.taskId,
          userId: ctx.userId,
          storeId,
          quantity: sql`excluded.quantity`,
          qtyOrdered: sql`excluded.qty_ordered`,
          updatedAt: now,
        },
        setWhere: sql`${itemDroppingEntries.submittedAt} is null and (
          ${itemDroppingEntries.taskId} is distinct from excluded.task_id
          or ${itemDroppingEntries.storeId} is distinct from excluded.store_id
          or ${itemDroppingEntries.qtyOrdered} is distinct from excluded.qty_ordered
        )`,
      })
      .returning({ id: itemDroppingEntries.id });

    if (inserted.length > 0) await recomputeItemDroppingStatus(ctx.taskId);
    return { success: true, data: { synced: inserted.length } };
  } catch (err) {
    return { success: false, error: `syncItemDroppingForStore: ${err}` };
  }
}

// ─── Store-agnostic sync (cron / OPS dashboard) ────────────────────────────
// Upserts itemTransferOrders across every known store WITHOUT touching any
// task/entry rows (those only get created when an employee actually opens
// their Item Return / Item Dropping page for their own store) — this just
// keeps the registry current, including transfer orders no employee has
// looked at yet. Callers go through refreshTransferRegistry() (single-flight +
// throttle) rather than calling this directly.

export async function syncTransferOrderRegistry(
  opts: { lookbackDays?: number; prune?: boolean } = {},
): Promise<TaskResult<{ synced: number; pruned: number }>> {
  const lookbackDays = opts.lookbackDays ?? REGISTRY_LOOKBACK_DAYS;
  // Pruning compares the DB against the feeds, so it is only sound over the
  // FULL window — the light, frequent refresh never prunes.
  const prune = opts.prune ?? true;

  try {
    const storeIdByCode = await storeIdByCodeMap();

    const [toRows, shipmentRows] = await Promise.all([
      fetchTransferOrders(lookbackDays),
      fetchWhseShipments(lookbackDays),
    ]);

    const shipmentGroups = [...groupWhseShipments(shipmentRows).values()];

    // TO rows batch first, shipment groups second — a shipment group whose
    // TOA no isn't in the DB yet still needs the TO row to land first so it
    // updates the freshly-created row (and its returnDetectedAt) instead of
    // both racing to insert the same toaNo.
    await batchUpsertTransferOrdersFromToRows(toRows, storeIdByCode);
    await batchUpsertTransferOrdersFromShipmentGroups(shipmentGroups, storeIdByCode);

    let pruned = 0;
    if (prune) {
      // Reconcile: drop rows BC no longer knows about in EITHER feed, as long
      // as nobody has acted on them and they aren't already received. This
      // clears "shows on the website but not in BC" ghosts (e.g. a TO deleted
      // in BC after its stub was created from a posted shipment).
      const seen = new Set<string>([
        ...toRows.map((r) => r.no),
        ...shipmentGroups.map((g) => g.transferOrderNo),
      ]);
      const candidates = await db
        .select({ id: itemTransferOrders.id, toaNo: itemTransferOrders.toaNo })
        .from(itemTransferOrders)
        .where(
          and(
            isNull(itemTransferOrders.receivedAt),
            isNull(itemTransferOrders.returnSubmittedAt),
            isNull(itemTransferOrders.droppingSubmittedAt),
          ),
        );
      const maybeStale = candidates.filter((c) => !seen.has(c.toaNo)).map((c) => c.id);
      if (maybeStale.length) {
        // Never delete one an employee has actually CONFIRMED (submittedAt
        // set — real qty/photo/timestamp, genuine audit trail). An
        // unconfirmed entry is just an empty placeholder no one ever acted
        // on — same reasoning as syncReceivingStatus's delete path — so it's
        // deleted alongside the parent (no onDelete cascade on
        // transferOrderId, so it has to go first or the parent delete fails).
        const [returnRefs, droppingRefs] = await Promise.all([
          db.select({ id: itemReturnEntries.transferOrderId, confirmed: itemReturnEntries.submittedAt })
            .from(itemReturnEntries).where(inArray(itemReturnEntries.transferOrderId, maybeStale)),
          db.select({ id: itemDroppingEntries.transferOrderId, confirmed: itemDroppingEntries.submittedAt })
            .from(itemDroppingEntries).where(inArray(itemDroppingEntries.transferOrderId, maybeStale)),
        ]);
        const confirmed = new Set<number>([
          ...returnRefs.filter((r) => r.confirmed != null).map((r) => r.id).filter((v): v is number => v != null),
          ...droppingRefs.filter((r) => r.confirmed != null).map((r) => r.id).filter((v): v is number => v != null),
        ]);
        const staleIds = maybeStale.filter((id) => !confirmed.has(id));
        if (staleIds.length) {
          await Promise.all([
            db.delete(itemReturnEntries)
              .where(and(inArray(itemReturnEntries.transferOrderId, staleIds), isNull(itemReturnEntries.submittedAt))),
            db.delete(itemDroppingEntries)
              .where(and(inArray(itemDroppingEntries.transferOrderId, staleIds), isNull(itemDroppingEntries.submittedAt))),
          ]);
          const deleted = await db
            .delete(itemTransferOrders)
            .where(inArray(itemTransferOrders.id, staleIds))
            .returning({ id: itemTransferOrders.id });
          pruned = deleted.length;
        }
      }
    }

    return { success: true, data: { synced: toRows.length + shipmentGroups.length, pruned } };
  } catch (err) {
    return { success: false, error: `syncTransferOrderRegistry: ${err}` };
  }
}

/**
 * Closes phase 3 (Item Receiving) two different ways depending on the leg:
 *
 *  - Shipped legs of any kind (store-bound OR a leg to/from a store this app
 *    doesn't manage, e.g. a real Panatrade store not onboarded here): as
 *    soon as Business Central posts the matching Warehouse Receipt
 *    (`sourceNo` = TOA no), whether or not anyone ever tapped "confirm
 *    receiving" locally — BC's own record is authoritative on its own.
 *    Deliberately NOT narrowed to `toStoreId IS NOT NULL` — a TO whose
 *    destination is some other real store this app has no employee for
 *    (e.g. FF014) will otherwise never get checked at all and lingers
 *    forever, which is exactly how zombie rows accumulate.
 *  - Warehouse-bound legs (Item Return → a DM* code, see isWarehouseCode):
 *    there is no destination store to ever confirm receiving, and BC may
 *    never post a matching receipt the way a store-to-store leg does — the
 *    origin store's photo-verified return submission (returnSubmittedAt) IS
 *    the completion event instead, so receivedAt is stamped with THAT
 *    moment, not with whenever this sweep happened to run.
 *
 * Either way, once BC confirms a TO is done: if a real employee already
 * confirmed their own leg (a submitted item_return_entries/
 * item_dropping_entries row — real qty/photo/timestamp, worth keeping), the
 * row is preserved with receivedAt set, same as before. If NOBODY ever
 * confirmed anything locally, there's no audit trail to protect — the whole
 * point of this app's copy of the TO is done, so it (and its empty,
 * never-acted-on entry) is deleted outright instead of lingering as a
 * permanently-"open" ghost that a stale-BC-view backfill keeps recreating.
 */
export async function syncReceivingStatus(
  scope: 'all' | number[] = 'all',
): Promise<TaskResult<{ closed: number; removed: number }>> {
  try {
    const now = new Date();
    let closed = 0;
    let removed = 0;

    const warehouseCandidates = await db
      .select({ id: itemTransferOrders.id, transferToCode: itemTransferOrders.transferToCode })
      .from(itemTransferOrders)
      .where(and(
        isNull(itemTransferOrders.receivedAt),
        isNotNull(itemTransferOrders.returnSubmittedAt),
        isNull(itemTransferOrders.toStoreId),
      ));
    const warehouseIds = warehouseCandidates
      .filter((r) => isWarehouseCode(r.transferToCode))
      .map((r) => r.id);

    // Warehouse-bound legs always have a confirmed return entry by
    // construction (returnSubmittedAt only gets set via confirmItemReturn,
    // which requires a photo) — always preserve, never delete.
    if (warehouseIds.length > 0) {
      const warehouseClosed = await db
        .update(itemTransferOrders)
        .set({ receivedAt: sql`${itemTransferOrders.returnSubmittedAt}`, updatedAt: now })
        .where(inArray(itemTransferOrders.id, warehouseIds))
        .returning({ id: itemTransferOrders.id });
      closed += warehouseClosed.length;
    }

    // Any other shipped-but-unreceived TO, regardless of which side (or
    // neither side) is a store this app manages.
    const openConditions = [
      isNull(itemTransferOrders.receivedAt),
      isNotNull(itemTransferOrders.whseShipmentNo),
    ];
    if (scope !== 'all') {
      openConditions.push(or(
        inArray(itemTransferOrders.fromStoreId, scope),
        inArray(itemTransferOrders.toStoreId, scope),
      )!);
    }

    const openOrders = await db
      .select({ id: itemTransferOrders.id, toaNo: itemTransferOrders.toaNo })
      .from(itemTransferOrders)
      .where(and(...openConditions));

    if (openOrders.length > 0) {
      const receipts = await fetchWhseReceiptsFor(openOrders.map((o) => o.toaNo));
      const receivedNos = new Set(receipts.map((r) => r.sourceNo));
      const doneIds = openOrders.filter((o) => receivedNos.has(o.toaNo)).map((o) => o.id);

      if (doneIds.length > 0) {
        const [confirmedReturn, confirmedDropping] = await Promise.all([
          db.select({ transferOrderId: itemReturnEntries.transferOrderId }).from(itemReturnEntries)
            .where(and(inArray(itemReturnEntries.transferOrderId, doneIds), isNotNull(itemReturnEntries.submittedAt))),
          db.select({ transferOrderId: itemDroppingEntries.transferOrderId }).from(itemDroppingEntries)
            .where(and(inArray(itemDroppingEntries.transferOrderId, doneIds), isNotNull(itemDroppingEntries.submittedAt))),
        ]);
        const hasConfirmedEntry = new Set<number>([
          ...confirmedReturn.map((r) => r.transferOrderId).filter((v): v is number => v != null),
          ...confirmedDropping.map((r) => r.transferOrderId).filter((v): v is number => v != null),
        ]);

        const toClose = doneIds.filter((id) => hasConfirmedEntry.has(id));
        const toDelete = doneIds.filter((id) => !hasConfirmedEntry.has(id));

        if (toClose.length > 0) {
          const storeClosed = await db
            .update(itemTransferOrders)
            .set({ receivedAt: now, updatedAt: now })
            .where(inArray(itemTransferOrders.id, toClose))
            .returning({ id: itemTransferOrders.id });
          closed += storeClosed.length;
        }

        if (toDelete.length > 0) {
          // No confirmed entry exists for any of these (guaranteed by the
          // filter above), so any entry still pointing at them is an empty,
          // never-acted-on placeholder — safe to delete alongside the
          // parent row (the FK has no onDelete cascade, so the parent
          // delete would otherwise fail while these still reference it).
          await Promise.all([
            db.delete(itemReturnEntries)
              .where(and(inArray(itemReturnEntries.transferOrderId, toDelete), isNull(itemReturnEntries.submittedAt))),
            db.delete(itemDroppingEntries)
              .where(and(inArray(itemDroppingEntries.transferOrderId, toDelete), isNull(itemDroppingEntries.submittedAt))),
          ]);
          const deleted = await db
            .delete(itemTransferOrders)
            .where(inArray(itemTransferOrders.id, toDelete))
            .returning({ id: itemTransferOrders.id });
          removed += deleted.length;
        }
      }
    }

    return { success: true, data: { closed, removed } };
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
      // `submittedAt IS NULL` makes the confirm atomic: two employees (or one
      // double-tap) passing the check above can no longer both "win" and
      // overwrite the first one's qty, photo and timestamp.
      .where(and(eq(itemReturnEntries.id, input.entryId), isNull(itemReturnEntries.submittedAt)))
      .returning();
    if (!updated) return { success: false, error: 'Item return ini sudah dikonfirmasi.' };

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
      .where(and(eq(itemDroppingEntries.id, input.entryId), isNull(itemDroppingEntries.submittedAt)))
      .returning();
    if (!updated) return { success: false, error: 'Item dropping ini sudah dikonfirmasi.' };

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

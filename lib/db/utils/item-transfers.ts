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
  warehouseCodes,
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
import { legsNotProcessedInPrism } from '@/lib/transfer-order-phase';
import { jakartaDateKey } from '@/lib/day-bucket';

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
export function isWarehouseCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.trim();
  return /^dm/i.test(c) || listedWarehouseCodes.has(c.toUpperCase());
}

// Codes IT added at /it/warehouse-codes (table `warehouse_codes`) that don't
// start with "DM". isWarehouseCode stays synchronous, so this set is filled by
// ensureWarehouseCodes() — call it once at the top of an API route or sync
// before using isWarehouseCode; it re-reads the table at most every 30 s.
let listedWarehouseCodes = new Set<string>();
let listedLoadedAt = 0;
const LISTED_TTL_MS = 30_000;

export async function ensureWarehouseCodes(force = false): Promise<void> {
  if (!force && Date.now() - listedLoadedAt < LISTED_TTL_MS) return;
  try {
    const rows = await db.select({ code: warehouseCodes.code }).from(warehouseCodes);
    listedWarehouseCodes = new Set(rows.map((r) => r.code.trim().toUpperCase()));
    listedLoadedAt = Date.now();
  } catch (err) {
    // Fail safe to the "DM…" rule (e.g. before the migration ran).
    console.error('[warehouse-codes] could not load the list', err);
  }
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
  /**
   * Shipping state of the order itself. BC fills these when ANY shipment is
   * posted — through a Warehouse Shipment or straight from the transfer order
   * ("Post → Ship", no WS at all). `lastShipmentNo` is the posted Transfer
   * Shipment (TSA…).
   */
  totalQtyShipped?: number;
  completelyShipped?: boolean;
  lastShipmentNo?: string;
}

/**
 * The posted Transfer Shipment no when BC says the order has shipped, else null.
 * Used as the shipment marker when the Warehouse Shipment feed never showed one.
 */
function shippedTransferShipmentNo(row: BcTransferOrderRow): string | null {
  const shipped = (row.totalQtyShipped ?? 0) > 0 || row.completelyShipped === true;
  const no = typeof row.lastShipmentNo === 'string' ? row.lastShipmentNo.trim() : '';
  return shipped && no ? no : null;
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
  /** Date only ("2026-11-18") — the feed has no time of day (systemCreatedAt etc. are rejected). */
  postingDate?: string;
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

/**
 * Which of these TO numbers BC's transfer-order feed still lists — asked by
 * number (`no eq 'A' or no eq 'B'`, one field so OData accepts the OR), with
 * no posting-date window. The reconcile uses it as a second opinion before it
 * calls an order gone: an order the windowed company-wide pull did not return
 * may simply have had its posting date moved, and a missing row is never
 * trusted on one query alone.
 */
async function fetchTransferOrderNosStillInBc(nos: string[]): Promise<Set<string>> {
  const unique = [...new Set(nos.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const settings = await getActiveBusinessCentralSettings('transfer_orders');
  if (!settings) throw new Error('BC Transfer Orders belum dikonfigurasi.');
  const perChunk = await mapPool(chunk(unique, RECEIPT_FILTER_CHUNK), RECEIPT_FETCH_CONCURRENCY, async (group) => {
    const filter = group.map((n) => `no eq '${escapeODataString(n)}'`).join(' or ');
    const rows = await fetchAllBusinessCentralRows(bcRequestUrl(settings.apiUrl, filter), settings);
    return rows.filter(isBcTransferOrderRow).map((r) => r.no);
  });
  return new Set(perChunk.flat());
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
/**
 * The TO numbers among `sourceNos` that have a Posted Whse Receipt in BC, each
 * with the Jakarta day its earliest receipt was posted (null if BC sent none).
 */
async function receivedInBc(sourceNos: string[]): Promise<Map<string, string | null>> {
  const receipts = await fetchWhseReceiptsFor(sourceNos);
  const out = new Map<string, string | null>();
  for (const r of receipts) {
    const day = typeof r.postingDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.postingDate) ? r.postingDate.slice(0, 10) : null;
    const prev = out.get(r.sourceNo);
    out.set(r.sourceNo, prev == null ? day : day != null && day < prev ? day : prev);
  }
  return out;
}

/**
 * "WR Diposting" for an order the sweep just found received. BC's receipt feed
 * has a date but no time: the cron sees a new receipt within minutes, so
 * "first seen" (`now`) is the honest time — unless the receipt was posted on
 * an EARLIER day (a backlog after the sweep was down), where `now` would add
 * whole days to Delivery / Item Receiving; then it is the last moment of the
 * posting day (Jakarta), the latest the posting can have happened.
 */
function wrPostedAt(postingDay: string | null | undefined, now: Date): Date {
  if (!postingDay || postingDay >= jakartaDateKey(now)) return now;
  return new Date(`${postingDay}T23:59:59+07:00`);
}

/** Sets receivedAt on still-open rows, each to its own WR time; returns the updated rows. */
async function markReceived(
  rows: { id: number; toaNo: string }[],
  received: Map<string, string | null>,
  now: Date,
): Promise<ItemTransferOrder[]> {
  const byTime = new Map<number, number[]>();
  for (const r of rows) {
    const at = wrPostedAt(received.get(r.toaNo), now).getTime();
    byTime.set(at, [...(byTime.get(at) ?? []), r.id]);
  }
  const out: ItemTransferOrder[] = [];
  for (const [at, ids] of byTime) {
    out.push(...await db
      .update(itemTransferOrders)
      .set({ receivedAt: new Date(at), updatedAt: now })
      .where(and(inArray(itemTransferOrders.id, ids), isNull(itemTransferOrders.receivedAt)))
      .returning());
  }
  return out;
}

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
  await ensureWarehouseCodes();
  const rows = await db.select({ id: stores.id, storeNo: stores.storeNo }).from(stores);
  // A "DM…" code is the warehouse, not a store — never link a transfer to a store row that carries one.
  return new Map(rows.filter((s) => !isWarehouseCode(s.storeNo)).map((s) => [s.storeNo, s.id]));
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
    // Shipped, seen on the ORDER itself — a fallback for the Warehouse Shipment
    // feed (see the onConflict rules below): the posted Transfer Shipment no and
    // "first seen". BC drops a TO's shipment rows from the WS feed as soon as the
    // order is fully received, and an order shipped without a WS never has any,
    // so without this such an order never reached the destination's Item
    // Receiving list and its WS Diposting stayed "tidak tercatat" for good.
    whseShipmentNo: shippedTransferShipmentNo(row),
    droppingDetectedAt: shippedTransferShipmentNo(row) ? now : null,
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
        // Fill-only: a WS number / BC's WS time from the shipment feed always
        // wins (that upsert runs right after this one and moves the time to
        // BC's own `systemCreatedAt` via least()).
        whseShipmentNo: sql`coalesce(item_transfer_orders.whse_shipment_no, excluded.whse_shipment_no)`,
        droppingDetectedAt: sql`coalesce(item_transfer_orders.dropping_detected_at, excluded.dropping_detected_at)`,
        updatedAt: now,
      },
      setWhere: sql`(
        (item_transfer_orders.whse_shipment_no is null and excluded.whse_shipment_no is not null)
        or item_transfer_orders.transfer_from_code is distinct from excluded.transfer_from_code
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
 * `receivedAt` closes BOTH legs: once BC has posted the receipt there is
 * nothing left for either store to do. Before, only the dropping leg checked it, so a transfer the
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

/** What the registry reconcile did: orders BC dropped, sorted into the two outcomes. */
export interface ReconcileResult {
  /** Gone from BC with NO Posted Whse Receipt — cancelled in BC, removed from PRISM. */
  cancelled: number;
  /** Gone from BC WITH a Posted Whse Receipt — completed (receivedAt set), row kept. */
  autoCompleted: number;
}

/**
 * A TO whose stored posting date sits this close to the fetch window's edge is
 * never judged by a windowed sweep (a date rounding / time-zone hair could
 * leave it just outside the window while BC still has it).
 */
const WINDOW_EDGE_DAYS = 2;

/**
 * The two rules for a transfer order BC's transfer-order feed no longer lists.
 * BC removes a TO in exactly two situations, and the Posted Whse Receipts feed
 * (which keeps its records after the TO is gone) tells them apart:
 *
 *  1. **Cancelled** — deleted in BC before it was received: no Posted Whse
 *     Receipt for it. PRISM removes it too (the row and every Item Return /
 *     Item Receiving entry pointing at it, confirmed or not), so neither the
 *     store nor OPS keeps seeing an order that no longer exists.
 *  2. **Completed** — BC deletes a TO once it is fully received: a Posted Whse
 *     Receipt exists. PRISM completes it (`receivedAt`) and keeps the row,
 *     whether or not the stores ever took their photos — a store leg nobody
 *     processed shows as "Selesai Otomatis · tidak diproses di PRISM"
 *     (legsNotProcessedInPrism in lib/transfer-order-phase.ts).
 *
 * `seen` = the TO numbers the windowed company-wide pull just returned.
 * `judgeSince` = only rows whose stored posting date is on/after it are judged
 * (the light sweep only looked back 14 days, so it can't speak for older
 * rows); null = every open row (the full sweep). Before anything is removed,
 * BC is asked again by number, without a date window — an order still listed
 * there is not gone, whatever the windowed pull said.
 */
async function reconcileVanishedTransferOrders(
  seen: Set<string>,
  judgeSince: string | null,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { cancelled: 0, autoCompleted: 0 };

  const open = await db
    .select({ id: itemTransferOrders.id, toaNo: itemTransferOrders.toaNo })
    .from(itemTransferOrders)
    .where(and(
      isNull(itemTransferOrders.receivedAt),
      judgeSince ? sql`${itemTransferOrders.postingDate} >= ${judgeSince}::timestamp` : undefined,
    ));

  // Warehouse-bound orders too: they stay open until the DM posts its receipt.
  const candidates = open.filter((r) => !seen.has(r.toaNo));
  if (candidates.length === 0) return result;

  const stillInBc = await fetchTransferOrderNosStillInBc(candidates.map((c) => c.toaNo));
  const vanished = candidates.filter((c) => !stillInBc.has(c.toaNo));
  if (vanished.length === 0) return result;

  const received = await receivedInBc(vanished.map((v) => v.toaNo));
  const now = new Date();

  const toComplete = vanished.filter((v) => received.has(v.toaNo));
  if (toComplete.length > 0) {
    const done = await markReceived(toComplete, received, now);
    result.autoCompleted = done.length;
  }

  const cancelled = vanished.filter((v) => !received.has(v.toaNo));
  if (cancelled.length > 0) {
    const ids = cancelled.map((c) => c.id);
    // Entries first — transferOrderId has no ON DELETE cascade.
    const [ret, drop] = await Promise.all([
      db.delete(itemReturnEntries).where(inArray(itemReturnEntries.transferOrderId, ids))
        .returning({ id: itemReturnEntries.id, submittedAt: itemReturnEntries.submittedAt }),
      db.delete(itemDroppingEntries).where(inArray(itemDroppingEntries.transferOrderId, ids))
        .returning({ id: itemDroppingEntries.id, submittedAt: itemDroppingEntries.submittedAt }),
    ]);
    const deleted = await db
      .delete(itemTransferOrders)
      .where(and(inArray(itemTransferOrders.id, ids), isNull(itemTransferOrders.receivedAt)))
      .returning({ id: itemTransferOrders.id });
    result.cancelled = deleted.length;
    const confirmedLost = [...ret, ...drop].filter((e) => e.submittedAt != null).length;
    console.warn(
      `[transfer-orders] removed ${deleted.length} TO(s) cancelled in BC (no Posted Whse Receipt): ` +
      `${cancelled.map((c) => c.toaNo).join(', ')}` +
      (confirmedLost > 0 ? ` — incl. ${confirmedLost} store confirmation(s) already sent` : ''),
    );
  }

  return result;
}

export async function syncTransferOrderRegistry(
  opts: { lookbackDays?: number; prune?: boolean } = {},
): Promise<TaskResult<{ synced: number } & ReconcileResult>> {
  const lookbackDays = opts.lookbackDays ?? REGISTRY_LOOKBACK_DAYS;
  // `prune` = the full sweep: judge EVERY open row against BC. The light sweep
  // (prune: false) still judges the rows its 14-day window can speak for, so a
  // cancelled / completed recent order is settled within minutes, not hours.
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

    // Reconcile against the TRANSFER ORDER feed only: it lists every order BC
    // still has open (Open + Released) and drops one only when it is cancelled
    // or fully received. The shipment feed keeps posted shipments forever, so
    // it can't say whether an order still exists. An empty TO pull is far more
    // likely a BC hiccup than "every order vanished" — never judge on one.
    let reconcile: ReconcileResult = { cancelled: 0, autoCompleted: 0 };
    if (toRows.length > 0) {
      const judgeSince = prune ? null : lookbackDate(Math.max(0, lookbackDays - WINDOW_EDGE_DAYS));
      reconcile = await reconcileVanishedTransferOrders(new Set(toRows.map((r) => r.no)), judgeSince);
    } else {
      console.warn('[transfer-orders] BC returned no transfer orders — reconcile skipped');
    }

    return { success: true, data: { synced: toRows.length + shipmentGroups.length, ...reconcile } };
  } catch (err) {
    return { success: false, error: `syncTransferOrderRegistry: ${err}` };
  }
}

/**
 * Closes a transfer order (receivedAt = "WR Diposting") as soon as Business
 * Central posts the matching Warehouse Receipt (`sourceNo` = TOA no), whether
 * or not anyone ever tapped "confirm receiving" locally — BC's own record is
 * authoritative on its own. Checked: every shipped order, plus every order the
 * origin store already handed over (a DM-RETURN / DM-BAD return can be received
 * with no WS in our feed). Deliberately NOT narrowed to `toStoreId IS NOT NULL`
 * — a TO whose destination is some other real store this app has no employee
 * for (e.g. FF014) would otherwise never get checked and linger forever.
 *
 * A warehouse-bound order (→ a DM / listed code) is closed the SAME way: when
 * the warehouse posts its receipt, not at the store's photo (that was the rule
 * before 2026-11-18 — `redateWarehouseReceipts` moves those old rows to the
 * warehouse's real WR). With the store's Foto Serah Terima it is a normal
 * finish; without it, "Selesai Otomatis" like any other order.
 *
 * Once BC has posted the receipt the TO is COMPLETE in PRISM too — always kept,
 * never deleted (it used to be deleted when no store had confirmed anything,
 * which made a store that ignores the app look better than it is in the TO
 * Report). A store leg nobody processed shows as "Selesai Otomatis · tidak
 * diproses di PRISM" (legsNotProcessedInPrism in lib/transfer-order-phase.ts);
 * `autoCompleted` counts the orders closed that way.
 */
export async function syncReceivingStatus(
  scope: 'all' | number[] = 'all',
): Promise<TaskResult<{ closed: number; autoCompleted: number }>> {
  try {
    const now = new Date();
    let closed = 0;
    let autoCompleted = 0;

    await ensureWarehouseCodes();
    if (scope === 'all') await redateWarehouseReceipts(now);

    // Every shipped-or-handed-over but unreceived TO, regardless of which side
    // (or neither side) is a store this app manages.
    const openConditions = [
      isNull(itemTransferOrders.receivedAt),
      or(isNotNull(itemTransferOrders.whseShipmentNo), isNotNull(itemTransferOrders.returnSubmittedAt))!,
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
      const received = await receivedInBc(openOrders.map((o) => o.toaNo));
      const toClose = openOrders.filter((o) => received.has(o.toaNo));

      if (toClose.length > 0) {
        const done = await markReceived(toClose, received, now);
        closed += done.length;
        autoCompleted += done.filter((r) => legsNotProcessedInPrism(r, isWarehouseCode).length > 0).length;
      }
    }

    return { success: true, data: { closed, autoCompleted } };
  } catch (err) {
    return { success: false, error: `syncReceivingStatus: ${err}` };
  }
}

/**
 * Before 2026-11-18 a warehouse-bound order was closed the moment the origin
 * store sent its Foto Serah Terima (receivedAt = returnSubmittedAt, within a
 * second). The warehouse posts its own receipt later (often days), so those
 * rows are moved to the real WR Diposting when BC has it, and reopened
 * ("Dikirim ke Gudang", waiting for the warehouse) when it has none yet — the
 * normal sweep closes them at the WR then. Idempotent: neither kind matches
 * again (receivedAt is no longer the photo time, or is null). Only rows of the
 * last REGISTRY_LOOKBACK_DAYS are touched; older ones stay as they were.
 */
async function redateWarehouseReceipts(now: Date): Promise<number> {
  const legacy = await db
    .select({ id: itemTransferOrders.id, toaNo: itemTransferOrders.toaNo, transferToCode: itemTransferOrders.transferToCode })
    .from(itemTransferOrders)
    .where(and(
      isNull(itemTransferOrders.toStoreId),
      isNotNull(itemTransferOrders.returnSubmittedAt),
      isNotNull(itemTransferOrders.receivedAt),
      sql`abs(extract(epoch from (${itemTransferOrders.receivedAt} - ${itemTransferOrders.returnSubmittedAt}))) < 60`,
      sql`${itemTransferOrders.returnSubmittedAt} >= ${lookbackDate(REGISTRY_LOOKBACK_DAYS)}::timestamp`,
    ));
  const rows = legacy.filter((r) => isWarehouseCode(r.transferToCode));
  if (rows.length === 0) return 0;

  const received = await receivedInBc(rows.map((r) => r.toaNo));
  let moved = 0;
  const waiting: number[] = [];
  for (const r of rows) {
    if (!received.has(r.toaNo)) {
      waiting.push(r.id);
      continue;
    }
    const done = await db
      .update(itemTransferOrders)
      .set({ receivedAt: wrPostedAt(received.get(r.toaNo), now), updatedAt: now })
      .where(eq(itemTransferOrders.id, r.id))
      .returning({ id: itemTransferOrders.id });
    moved += done.length;
  }
  let reopened = 0;
  if (waiting.length > 0) {
    const done = await db
      .update(itemTransferOrders)
      .set({ receivedAt: null, updatedAt: now })
      .where(inArray(itemTransferOrders.id, waiting))
      .returning({ id: itemTransferOrders.id });
    reopened = done.length;
  }
  if (moved > 0 || reopened > 0) {
    console.warn(
      `[transfer-orders] warehouse-bound TOs closed at the store's photo: ${moved} moved to the warehouse's WR Diposting, ` +
      `${reopened} reopened to wait for it`,
    );
  }
  return moved + reopened;
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

const TO_FINISHED_IN_BC =
  'TO ini sudah selesai otomatis karena sudah diposting di BC — tidak perlu dikonfirmasi lagi. Muat ulang halaman.';

/**
 * The order is already finished (BC posted the receipt). A late confirm from a
 * page left open would rewrite an order PRISM completed by itself as
 * "processed in PRISM", so it is refused.
 */
async function finishedInBc(transferOrderId: number | null): Promise<boolean> {
  if (transferOrderId == null) return false;
  const [row] = await db
    .select({ receivedAt: itemTransferOrders.receivedAt })
    .from(itemTransferOrders)
    .where(eq(itemTransferOrders.id, transferOrderId))
    .limit(1);
  return row?.receivedAt != null;
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
    if (await finishedInBc(entry.transferOrderId)) return { success: false, error: TO_FINISHED_IN_BC };

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
    if (await finishedInBc(entry.transferOrderId)) return { success: false, error: TO_FINISHED_IN_BC };

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


/**
 * A code just became a warehouse: unlink it from any store row on existing
 * transfer orders (a BC location code that happens to match a store's storeNo
 * had linked them), so Ops / the employee app show "Gudang (code)" instead of a
 * store name. Returns how many orders were changed.
 */
export async function unlinkWarehouseCodeFromStores(code: string): Promise<number> {
  const c = code.trim();
  const fromRows = await db
    .update(itemTransferOrders)
    .set({ fromStoreId: null })
    .where(and(isNotNull(itemTransferOrders.fromStoreId), sql`upper(trim(${itemTransferOrders.transferFromCode})) = ${c.toUpperCase()}`))
    .returning({ id: itemTransferOrders.id });
  const toRows = await db
    .update(itemTransferOrders)
    .set({ toStoreId: null })
    .where(and(isNotNull(itemTransferOrders.toStoreId), sql`upper(trim(${itemTransferOrders.transferToCode})) = ${c.toUpperCase()}`))
    .returning({ id: itemTransferOrders.id });
  return new Set([...fromRows, ...toRows].map((r) => r.id)).size;
}

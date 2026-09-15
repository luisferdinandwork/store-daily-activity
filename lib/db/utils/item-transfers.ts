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
 * `storeNo` narrows the query to transfer orders where that store is the
 * ORIGIN (transferFromCode) — the Item Return leg. Omit it for the OPS-wide
 * registry sync, which pulls every recent transfer order company-wide.
 *
 * NOTE: this tenant's OData rejects `OR` across distinct fields
 * ("501 The 'OR' operator is not supported on distinct fields"), so a
 * store's INBOUND transfers are covered separately — by the shipment feed
 * (fetchWhseShipments) and by the company-wide registry sync.
 */
async function fetchTransferOrders(storeNo?: string): Promise<BcTransferOrderRow[]> {
  const settings = await getActiveBusinessCentralSettings('transfer_orders');
  if (!settings) {
    throw new Error(
      'BC Transfer Orders belum dikonfigurasi. Tambahkan business_central_settings dengan code=transfer_orders (OPS → BC Credentials).',
    );
  }
  const filter = storeNo
    ? `transferFromCode eq '${escapeODataString(storeNo)}'`
    // Registry: every transfer order (any status — Open ones matter to OPS)
    // posted in the recency window.
    : `postingDate ge ${lookbackDate()}`;
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

// The store-agnostic registry/receiving syncs only care about transfers that
// could still be in flight. Anything posted more than this many days ago is
// long since received — bounding the company-wide pulls by postingDate keeps
// the OPS dashboard fast (the store-scoped employee syncs stay unbounded, a
// single store has few enough rows).
const REGISTRY_LOOKBACK_DAYS = 90;

function lookbackDate(days = REGISTRY_LOOKBACK_DAYS): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function fetchWhseShipments(storeNo?: string): Promise<BcWhseShipmentRow[]> {
  const settings = await getActiveBusinessCentralSettings('whse_shipments');
  if (!settings) {
    throw new Error(
      'BC Posted Whse Shipments belum dikonfigurasi. Tambahkan business_central_settings dengan code=whse_shipments (OPS → BC Credentials).',
    );
  }
  const filters = [`startswith(transferOrderNo,'TOA')`];
  if (storeNo) filters.push(`transferToCode eq '${escapeODataString(storeNo)}'`);
  else filters.push(`postingDate ge ${lookbackDate()}`);
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

/**
 * Fetches Posted Whse Receipts for a specific set of transfer-order numbers
 * only — `sourceNo eq 'TOA…' or sourceNo eq 'TOA…'`, chunked so no single
 * OData URL gets unreasonably long. This replaces the old unbounded
 * "every TOA receipt in the last N days" pull.
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

  const all: BcWhseReceiptRow[] = [];
  for (const group of chunk(unique, RECEIPT_FILTER_CHUNK)) {
    const filter = group.map((n) => `sourceNo eq '${escapeODataString(n)}'`).join(' or ');
    const rows = await fetchAllBusinessCentralRows(bcRequestUrl(settings.apiUrl, filter), settings);
    all.push(...rows.filter(isBcWhseReceiptRow));
  }
  return all;
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
  storeIdByCode: Map<string, number>,
): Promise<ItemTransferOrder> {
  const now = new Date();
  const fromStoreId = storeIdByCode.get(row.transferFromCode) ?? null;
  const toStoreId = storeIdByCode.get(row.transferToCode) ?? null;

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
        toStoreId: toStoreId ?? existing.toStoreId,
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
      toStoreId,
      qtyOrdered: row.totalQtyOrder ?? 0,
      bcStatus: row.status ?? null,
      postingDate,
      returnDetectedAt: now,
    })
    .returning();
  return created;
}

/** Every store's code → id, for resolving BC transferFrom/ToCode. */
async function storeIdByCodeMap(): Promise<Map<string, number>> {
  const rows = await db.select({ id: stores.id, storeNo: stores.storeNo }).from(stores);
  return new Map(rows.map((s) => [s.storeNo, s.id]));
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
    // Resolve the DESTINATION store too — an inbound transfer with no
    // Warehouse Shipment yet would otherwise never get a toStoreId and stay
    // invisible on the OPS dashboard (which hides rows where both are null).
    toStoreId: storeIdByCode.get(row.transferToCode) ?? null,
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
        toStoreId: sql`coalesce(excluded.to_store_id, item_transfer_orders.to_store_id)`,
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
   * The single per-store/day Item Return or Item Dropping task row to attach
   * newly-synced entries to. Item transfers are store-scoped now — every
   * shift sees the same list — so the caller resolves the one task and passes
   * its id here.
   */
  taskId: number;
}

/**
 * THE single definition of "still open" for a store, on both sides of the
 * pipeline. `pending-count/route.ts` (the header badge) and the two sync
 * functions below (what actually gets an entry on the employee's page) both
 * call this — they can no longer drift apart from each other, because
 * they're no longer two independently-maintained queries.
 */
export async function getOpenTransferOrdersForStore(storeId: number): Promise<{
  returnOpen: ItemTransferOrder[];
  droppingOpen: ItemTransferOrder[];
}> {
  const [returnOpen, droppingOpen] = await Promise.all([
    db.select().from(itemTransferOrders).where(and(
      eq(itemTransferOrders.fromStoreId, storeId),
      isNull(itemTransferOrders.returnSubmittedAt),
    )),
    db.select().from(itemTransferOrders).where(and(
      eq(itemTransferOrders.toStoreId, storeId),
      isNotNull(itemTransferOrders.whseShipmentNo),
      isNull(itemTransferOrders.droppingSubmittedAt),
      isNull(itemTransferOrders.receivedAt),
    )),
  ]);
  return { returnOpen, droppingOpen };
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

    // Best-effort freshness pass: pulls in brand-new TOs and refreshes
    // bcStatus/qty for whatever this store-filtered OData query does return.
    // This filter has proven unreliable at returning EVERY row that
    // transferFromCode eq '<storeNo>' actually matches (confirmed against
    // live data: the unscoped registry sync, and other stores' own syncs,
    // routinely resolve fromStoreId for TOs this filtered query never
    // surfaces) — so it is no longer the thing that decides what the
    // employee sees. The backfill below is.
    let bcError: string | null = null;
    try {
      const matched = await fetchTransferOrders(store.storeNo);
      if (matched.length) {
        const codeMap = await storeIdByCodeMap();
        for (const row of matched) {
          await upsertTransferOrderFromToRow(row, codeMap);
        }
      }
    } catch (err) {
      bcError = `${err}`;
    }

    // Authoritative pass: ensure/re-home an entry for EVERY transfer order
    // already on record (item_transfer_orders) with this store as the
    // origin and not yet returned — regardless of whether the BC fetch just
    // above happened to return it this time. A row can get its fromStoreId
    // resolved by this store's own past sync, another store's shipment
    // sync, or the OPS-wide registry sync; this is the exact same query
    // getOpenTransferOrdersForStore/pending-count use, so the employee page
    // can never again show fewer open items than the header badge counts.
    const { returnOpen } = await getOpenTransferOrdersForStore(storeId);

    let synced = 0;
    for (const toRow of returnOpen) {
      // INSERT ... ON CONFLICT instead of SELECT-then-INSERT: the employee
      // page's own React effect can fire this sync twice in a row
      // (StrictMode/fast re-navigation), and a full_day schedule syncs the
      // SAME store's morning + evening task rows concurrently via
      // Promise.all — both hit this loop for the same toRow.id at the same
      // time. A separate existence check can't see the other in-flight
      // insert, so both pass it and the second insert throws a
      // unique-constraint violation on transferOrderId. Let Postgres itself
      // resolve the race atomically.
      //
      // On conflict, RE-HOME rather than no-op: a TO not confirmed the same
      // day it was first synced would otherwise keep its entry pinned to
      // that earlier day's task forever (transferOrderId is unique, so every
      // later day's insert would just no-op) — it silently vanishes from the
      // employee's page from the next day on. setWhere leaves an
      // already-confirmed entry untouched.
      const inserted = await db
        .insert(itemReturnEntries)
        .values({
          taskId: ctx.taskId,
          userId: ctx.userId,
          storeId,
          returnNumber: toRow.toaNo,
          quantity: toRow.qtyOrdered,
          returnTime: new Date(),
          transferOrderId: toRow.id,
          qtyOrdered: toRow.qtyOrdered,
        })
        .onConflictDoUpdate({
          target: itemReturnEntries.transferOrderId,
          set: {
            taskId: ctx.taskId,
            userId: ctx.userId,
            storeId,
            quantity: toRow.qtyOrdered,
            qtyOrdered: toRow.qtyOrdered,
            updatedAt: new Date(),
          },
          setWhere: isNull(itemReturnEntries.submittedAt),
        })
        .returning({ id: itemReturnEntries.id });
      if (inserted.length > 0) synced += 1;
    }

    if (synced > 0) await recomputeItemReturnStatus(ctx.taskId);

    if (bcError) return { success: false, error: `syncItemReturnForStore: ${bcError}` };
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

    // See the matching comment in syncItemReturnForStore — best-effort
    // freshness pass, no longer what decides what the employee sees.
    let bcError: string | null = null;
    try {
      const matched = await fetchWhseShipments(store.storeNo);
      if (matched.length) {
        const groups = groupWhseShipments(matched);
        for (const group of groups.values()) {
          await upsertTransferOrderFromShipmentGroup(group, storeId);
        }
      }
    } catch (err) {
      bcError = `${err}`;
    }

    // Authoritative pass — see the matching comment in syncItemReturnForStore.
    const { droppingOpen } = await getOpenTransferOrdersForStore(storeId);

    let synced = 0;
    for (const toRow of droppingOpen) {
      const inserted = await db
        .insert(itemDroppingEntries)
        .values({
          taskId: ctx.taskId,
          userId: ctx.userId,
          storeId,
          toNumber: toRow.toaNo,
          quantity: toRow.qtyOrdered,
          dropTime: new Date(),
          transferOrderId: toRow.id,
          qtyOrdered: toRow.qtyOrdered,
        })
        .onConflictDoUpdate({
          target: itemDroppingEntries.transferOrderId,
          set: {
            taskId: ctx.taskId,
            userId: ctx.userId,
            storeId,
            quantity: toRow.qtyOrdered,
            qtyOrdered: toRow.qtyOrdered,
            updatedAt: new Date(),
          },
          setWhere: isNull(itemDroppingEntries.submittedAt),
        })
        .returning({ id: itemDroppingEntries.id });
      if (inserted.length > 0) synced += 1;
    }

    if (synced > 0) await recomputeItemDroppingStatus(ctx.taskId);

    if (bcError) return { success: false, error: `syncItemDroppingForStore: ${bcError}` };
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

export async function syncTransferOrderRegistry(): Promise<TaskResult<{ synced: number; pruned: number }>> {
  try {
    const storeIdByCode = await storeIdByCodeMap();

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

    // Reconcile: drop rows BC no longer knows about in EITHER feed, as long as
    // nobody has acted on them and they aren't already received. This clears
    // "shows on the website but not in BC" ghosts (e.g. a TO deleted in BC
    // after its stub was created from a posted shipment).
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
    let pruned = 0;
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
 *    the completion event instead.
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
        .set({ receivedAt: now, updatedAt: now })
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

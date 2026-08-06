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
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
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

async function fetchTransferOrders(): Promise<BcTransferOrderRow[]> {
  const settings = await getActiveBusinessCentralSettings('transfer_orders');
  if (!settings) {
    throw new Error(
      'BC Transfer Orders belum dikonfigurasi. Tambahkan business_central_settings dengan code=transfer_orders (OPS → BC Credentials).',
    );
  }
  const rows = await fetchAllBusinessCentralRows(settings.apiUrl, settings);
  return rows.filter(isBcTransferOrderRow);
}

async function fetchWhseShipments(): Promise<BcWhseShipmentRow[]> {
  const settings = await getActiveBusinessCentralSettings('whse_shipments');
  if (!settings) {
    throw new Error(
      'BC Posted Whse Shipments belum dikonfigurasi. Tambahkan business_central_settings dengan code=whse_shipments (OPS → BC Credentials).',
    );
  }
  const rows = await fetchAllBusinessCentralRows(settings.apiUrl, settings);
  return rows.filter(isBcWhseShipmentRow);
}

async function fetchWhseReceipts(): Promise<BcWhseReceiptRow[]> {
  const settings = await getActiveBusinessCentralSettings('whse_receipts');
  if (!settings) {
    throw new Error(
      'BC Posted Whse Receipts belum dikonfigurasi. Tambahkan business_central_settings dengan code=whse_receipts (OPS → BC Credentials).',
    );
  }
  const rows = await fetchAllBusinessCentralRows(settings.apiUrl, settings);
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

    const rows = await fetchTransferOrders();
    const matched = rows.filter((r) => r.transferFromCode === store.storeNo);
    if (!matched.length) return { success: true, data: { synced: 0 } };

    const task = await getOrCreateItemReturnRow(ctx.scheduleId, ctx.userId, storeId, ctx.shiftId, ctx.date);

    let synced = 0;
    for (const row of matched) {
      const toRow = await upsertTransferOrderFromToRow(row, storeId);

      const [existingEntry] = await db
        .select({ id: itemReturnEntries.id })
        .from(itemReturnEntries)
        .where(eq(itemReturnEntries.transferOrderId, toRow.id))
        .limit(1);
      if (existingEntry) continue;

      await db.insert(itemReturnEntries).values({
        taskId: task.id,
        userId: ctx.userId,
        storeId,
        returnNumber: toRow.toaNo,
        quantity: toRow.qtyOrdered,
        returnTime: new Date(),
        transferOrderId: toRow.id,
        qtyOrdered: toRow.qtyOrdered,
      });
      synced += 1;
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

    const rows = await fetchWhseShipments();
    const matched = rows.filter((r) => r.transferToCode === store.storeNo);
    if (!matched.length) return { success: true, data: { synced: 0 } };

    const groups = groupWhseShipments(matched);
    const task = await getOrCreateItemDroppingRow(ctx.scheduleId, ctx.userId, storeId, ctx.shiftId, ctx.date);

    let synced = 0;
    for (const group of groups.values()) {
      const toRow = await upsertTransferOrderFromShipmentGroup(group, storeId);

      const [existingEntry] = await db
        .select({ id: itemDroppingEntries.id })
        .from(itemDroppingEntries)
        .where(eq(itemDroppingEntries.transferOrderId, toRow.id))
        .limit(1);
      if (existingEntry) continue;

      await db.insert(itemDroppingEntries).values({
        taskId: task.id,
        userId: ctx.userId,
        storeId,
        toNumber: toRow.toaNo,
        quantity: group.qty,
        dropTime: new Date(),
        transferOrderId: toRow.id,
        qtyOrdered: group.qty,
      });
      synced += 1;
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

    let synced = 0;

    for (const row of toRows) {
      await upsertTransferOrderFromToRow(row, storeIdByCode.get(row.transferFromCode) ?? null);
      synced += 1;
    }

    for (const group of groupWhseShipments(shipmentRows).values()) {
      await upsertTransferOrderFromShipmentGroup(group, storeIdByCode.get(group.transferToCode) ?? null);
      synced += 1;
    }

    return { success: true, data: { synced } };
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
    const sourceNos = new Set(receipts.map((r) => r.sourceNo));
    if (sourceNos.size === 0) return { success: true, data: { closed: 0 } };

    const openConditions = [
      isNotNull(itemTransferOrders.droppingSubmittedAt),
      isNull(itemTransferOrders.receivedAt),
    ];
    if (scope !== 'all') openConditions.push(inArray(itemTransferOrders.toStoreId, scope));

    const open = await db.select().from(itemTransferOrders).where(and(...openConditions));

    let closed = 0;
    const now = new Date();
    for (const row of open) {
      if (!sourceNos.has(row.toaNo)) continue;
      await db
        .update(itemTransferOrders)
        .set({ receivedAt: now, updatedAt: now })
        .where(eq(itemTransferOrders.id, row.id));
      closed += 1;
    }

    return { success: true, data: { closed } };
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

// lib/db/utils/item-dropping.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated utilities for the Item Dropping task.
//
// Item Dropping is a SHARED morning task — one active row per (storeId, date).
// Any employee scheduled on the morning/full_day shift for that store can
// interact with the same task row (auto-save + submit).
//
// Two sub-scenarios:
//
// A) No dropping (hasDropping = false)
//      Employee confirms no delivery today → status 'completed' immediately.
//      No photos required.
//
// B) Item dropped (hasDropping = true)
//      1. Employee records dropTime + droppingPhotos (min 1).
//      2. When item is received: isReceived=true + receiveTime + receivePhotos
//         (min 1). Status → 'completed'.
//      3. If end-of-shift and isReceived is still false:
//           • status 'discrepancy' → carry-forward to next morning.
//           • Next-day employee opens the SAME row and completes receipt
//             with receiveTime + receivePhotos via confirmItemReceipt().
//
// Access rules:
//   • Employee must be checked in (attendance row for this schedule).
//   • Employee must be inside the store's geofence (unless skipGeo).
// ─────────────────────────────────────────────────────────────────────────────

import { db }                                              from '@/lib/db';
import { eq, and, gte, lte, inArray, isNull, or }         from 'drizzle-orm';
import {
  itemDroppingTasks, stores, shifts, attendance, schedules,
  type ItemDroppingTask,
} from '@/lib/db/schema';

// ─── Public types ─────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

// ─── Photo rules (single source of truth) ────────────────────────────────────

export const ITEM_DROPPING_PHOTO_RULES = {
  dropping: { min: 1, max: 5 },
  receive:  { min: 1, max: 5 },
} as const;

// ─── Input types ──────────────────────────────────────────────────────────────

/**
 * Initial / re-submission of an Item Dropping task.
 *
 * Scenario A (no dropping): hasDropping=false — nothing else needed.
 *
 * Scenario B (dropping):
 *   • Always: dropTime + droppingPhotos (min 1)
 *   • If received same shift: isReceived=true + receiveTime + receivePhotos (min 1)
 *   • If NOT yet received:    isReceived=false → status 'discrepancy'
 */
export interface SubmitItemDroppingInput {
  scheduleId:       number;
  userId:           string;
  storeId:          number;
  geo:              GeoPoint;
  skipGeo?:         boolean;

  hasDropping:      boolean;
  dropTime?:        Date | string;
  droppingPhotos?:  string[];

  isReceived?:       boolean;
  receiveTime?:      Date | string;
  receivePhotos?:    string[];
  receivedByUserId?: string;

  notes?:           string;
  parentTaskId?:    number; // set when continuing a prior-day discrepancy row
}

/**
 * Confirm receipt of a prior-day carry-forward task.
 * Requires receivePhotos (min 1).
 */
export interface ConfirmReceiptInput {
  taskId:            number;
  scheduleId:        number;
  userId:            string;
  storeId:           number;
  geo:               GeoPoint;
  skipGeo?:          boolean;
  receiveTime?:      Date | string;
  receivePhotos:     string[];         // min 1 — required
  receivedByUserId?: string;
  notes?:            string;
}

export interface AutoSaveItemDroppingPatch {
  hasDropping?:      boolean;
  dropTime?:         string | null;
  droppingPhotos?:   string[];
  isReceived?:       boolean;
  receiveTime?:      string | null;
  receivePhotos?:    string[];
  receivedByUserId?: string | null;
  notes?:            string;
}

export interface VerifyTaskInput {
  taskId:  number;
  actorId: string;
  storeId: number;
  approve: boolean;
  notes?:  string;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R  = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function jsonPhotos(paths: string[] | undefined): string | undefined {
  return paths && paths.length > 0 ? JSON.stringify(paths) : undefined;
}

let _morningShiftIdCache: number | null = null;
async function getMorningShiftId(): Promise<number> {
  if (_morningShiftIdCache != null) return _morningShiftIdCache;
  const [row] = await db.select({ id: shifts.id }).from(shifts)
    .where(eq(shifts.code, 'morning')).limit(1);
  if (!row) throw new Error('Morning shift not found in shifts table.');
  _morningShiftIdCache = row.id;
  return row.id;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);
  if (!att?.checkInTime)
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  return null;
}

async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store)                   return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;

  const dist   = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

async function assertCanProgressTask(
  scheduleId: number,
  storeId:    number,
  geo:        GeoPoint,
  skipGeo?:   boolean,
): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;
  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }
  return null;
}

// ─── Payload validation ───────────────────────────────────────────────────────

function validateSubmitPayload(input: SubmitItemDroppingInput): string | null {
  // Scenario A — nothing more to validate
  if (!input.hasDropping) return null;

  // Scenario B — drop details
  if (!input.dropTime)
    return 'Waktu dropping wajib diisi ketika ada item dropping.';

  const dropCount = input.droppingPhotos?.length ?? 0;
  if (dropCount < ITEM_DROPPING_PHOTO_RULES.dropping.min)
    return `Foto dropping wajib minimal ${ITEM_DROPPING_PHOTO_RULES.dropping.min}.`;
  if (dropCount > ITEM_DROPPING_PHOTO_RULES.dropping.max)
    return `Foto dropping maksimal ${ITEM_DROPPING_PHOTO_RULES.dropping.max}.`;

  // Receipt details — only required when isReceived=true
  if (input.isReceived) {
    if (!input.receiveTime)
      return 'Waktu penerimaan wajib diisi ketika item sudah diterima.';

    const rcvCount = input.receivePhotos?.length ?? 0;
    if (rcvCount < ITEM_DROPPING_PHOTO_RULES.receive.min)
      return `Foto penerimaan wajib minimal ${ITEM_DROPPING_PHOTO_RULES.receive.min}.`;
    if (rcvCount > ITEM_DROPPING_PHOTO_RULES.receive.max)
      return `Foto penerimaan maksimal ${ITEM_DROPPING_PHOTO_RULES.receive.max}.`;
  }

  return null;
}

function validateConfirmPayload(input: ConfirmReceiptInput): string | null {
  const rcvCount = input.receivePhotos?.length ?? 0;
  if (rcvCount < ITEM_DROPPING_PHOTO_RULES.receive.min)
    return `Foto penerimaan wajib minimal ${ITEM_DROPPING_PHOTO_RULES.receive.min}.`;
  if (rcvCount > ITEM_DROPPING_PHOTO_RULES.receive.max)
    return `Foto penerimaan maksimal ${ITEM_DROPPING_PHOTO_RULES.receive.max}.`;
  return null;
}

// ─── Active task query ────────────────────────────────────────────────────────

export async function getActiveItemDroppingTask(
  storeId: number,
  date:    Date,
): Promise<ItemDroppingTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [today] = await db
    .select()
    .from(itemDroppingTasks)
    .where(and(
      eq(itemDroppingTasks.storeId, storeId),
      gte(itemDroppingTasks.date, dayStart),
      lte(itemDroppingTasks.date, dayEnd),
      inArray(itemDroppingTasks.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .orderBy(itemDroppingTasks.createdAt)
    .limit(1);

  if (today) return today;

  // Surface unresolved discrepancy from a prior day (root row only)
  const [prior] = await db
    .select()
    .from(itemDroppingTasks)
    .where(and(
      eq(itemDroppingTasks.storeId, storeId),
      eq(itemDroppingTasks.status, 'discrepancy'),
      isNull(itemDroppingTasks.parentTaskId),
    ))
    .orderBy(itemDroppingTasks.createdAt)
    .limit(1);

  return prior ?? null;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitItemDropping(
  input: SubmitItemDroppingInput,
): Promise<TaskResult<ItemDroppingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateSubmitPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const TERMINAL = ['verified', 'rejected'] as const;
    const morningShiftId = await getMorningShiftId();
    const now            = new Date();

    // ── Carry-forward path ────────────────────────────────────────────────────
    if (input.parentTaskId) {
      const [existing] = await db
        .select()
        .from(itemDroppingTasks)
        .where(eq(itemDroppingTasks.id, input.parentTaskId))
        .limit(1);

      if (!existing)
        return { success: false, error: 'Task carry-forward tidak ditemukan.' };
      if (existing.status !== 'discrepancy')
        return { success: false, error: 'Task ini tidak dalam status discrepancy.' };

      const newStatus = (input.isReceived === true) ? 'completed' as const : 'discrepancy' as const;

      const row = (await db
        .update(itemDroppingTasks)
        .set({
          scheduleId:        input.scheduleId,
          userId:            input.userId,
          hasDropping:       input.hasDropping,
          dropTime:          input.dropTime ? new Date(input.dropTime) : existing.dropTime,
          droppingPhotos:    jsonPhotos(input.droppingPhotos) ?? existing.droppingPhotos ?? undefined,
          isReceived:        input.isReceived ?? false,
          receiveTime:       input.receiveTime ? new Date(input.receiveTime) : null,
          receivePhotos:     jsonPhotos(input.receivePhotos),
          receivedByUserId:  input.isReceived ? (input.receivedByUserId ?? input.userId) : null,
          submittedLat:      String(input.geo.lat),
          submittedLng:      String(input.geo.lng),
          notes:             input.notes,
          status:            newStatus,
          completedAt:       newStatus === 'completed' ? now : null,
          updatedAt:         now,
        })
        .where(eq(itemDroppingTasks.id, input.parentTaskId))
        .returning())[0];

      return { success: true, data: row };
    }

    // ── Fresh / re-submit ─────────────────────────────────────────────────────
    const [existing] = await db
      .select()
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status != null && (TERMINAL as readonly string[]).includes(existing.status))
      return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

    const newStatus = !input.hasDropping
      ? 'completed' as const
      : (input.isReceived === true)
        ? 'completed' as const
        : 'discrepancy' as const;

    const values = {
      scheduleId:        input.scheduleId,
      userId:            input.userId,
      storeId:           input.storeId,
      shiftId:           morningShiftId,
      date:              startOfDay(now),
      parentTaskId:      null as number | null,
      hasDropping:       input.hasDropping,
      dropTime:          input.dropTime ? new Date(input.dropTime) : null,
      droppingPhotos:    jsonPhotos(input.droppingPhotos),
      isReceived:        input.isReceived ?? false,
      receiveTime:       input.receiveTime ? new Date(input.receiveTime) : null,
      receivePhotos:     jsonPhotos(input.receivePhotos),
      receivedByUserId:  input.isReceived ? (input.receivedByUserId ?? input.userId) : null,
      submittedLat:      String(input.geo.lat),
      submittedLng:      String(input.geo.lng),
      notes:             input.notes,
      status:            newStatus,
      completedAt:       newStatus === 'completed' ? now : null,
      updatedAt:         now,
    };

    const row = existing
      ? (await db.update(itemDroppingTasks).set(values)
          .where(eq(itemDroppingTasks.id, existing.id)).returning())[0]
      : (await db.insert(itemDroppingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitItemDropping: ${err}` };
  }
}

// ─── Confirm receipt ──────────────────────────────────────────────────────────

/**
 * Mark an existing discrepancy task as received.
 * Called from the next-day carry-forward flow.
 * receivePhotos is REQUIRED (min 1).
 */
export async function confirmItemReceipt(
  input: ConfirmReceiptInput,
): Promise<TaskResult<ItemDroppingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateConfirmPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const [task] = await db
      .select()
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.id, input.taskId))
      .limit(1);

    if (!task)
      return { success: false, error: 'Task tidak ditemukan.' };
    if (task.status !== 'discrepancy')
      return { success: false, error: 'Hanya task dengan status discrepancy yang bisa dikonfirmasi.' };
    if (!task.hasDropping)
      return { success: false, error: 'Task ini tidak memiliki item dropping.' };

    const now = new Date();
    const row = (await db
      .update(itemDroppingTasks)
      .set({
        isReceived:       true,
        receiveTime:      input.receiveTime ? new Date(input.receiveTime) : now,
        receivePhotos:    jsonPhotos(input.receivePhotos),
        receivedByUserId: input.receivedByUserId ?? input.userId,
        scheduleId:       input.scheduleId,
        notes:            input.notes,
        status:           'completed' as const,
        completedAt:      now,
        updatedAt:        now,
        submittedLat:     String(input.geo.lat),
        submittedLng:     String(input.geo.lng),
      })
      .where(eq(itemDroppingTasks.id, input.taskId))
      .returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `confirmItemReceipt: ${err}` };
  }
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export async function autoSaveItemDropping(
  scheduleId: number,
  patch:      AutoSaveItemDroppingPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: itemDroppingTasks.id, status: itemDroppingTasks.status })
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.scheduleId, scheduleId))
      .limit(1);

    if (!existing) return { success: false, error: 'Item dropping task not found.' };
    if (existing.status === 'completed' || existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('hasDropping'      in patch) update.hasDropping      = Boolean(patch.hasDropping);
    if ('dropTime'         in patch) update.dropTime         = patch.dropTime ? new Date(patch.dropTime) : null;
    if ('droppingPhotos'   in patch) update.droppingPhotos   = jsonPhotos(patch.droppingPhotos);
    if ('isReceived'       in patch) update.isReceived       = Boolean(patch.isReceived);
    if ('receiveTime'      in patch) update.receiveTime      = patch.receiveTime ? new Date(patch.receiveTime) : null;
    if ('receivePhotos'    in patch) update.receivePhotos    = jsonPhotos(patch.receivePhotos);
    if ('receivedByUserId' in patch) update.receivedByUserId = patch.receivedByUserId ?? null;
    if ('notes'            in patch) update.notes            = patch.notes;

    if (existing.status === 'pending') update.status = 'in_progress';

    await db
      .update(itemDroppingTasks)
      .set(update)
      .where(eq(itemDroppingTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveItemDropping: ${err}` };
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export async function verifyItemDropping(
  input: VerifyTaskInput,
): Promise<TaskResult<void>> {
  try {
    const { canManageSchedule } = await import('@/lib/schedule-utils');
    const auth = await canManageSchedule(input.actorId, input.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason! };

    const [row] = await db
      .select({ id: itemDroppingTasks.id, status: itemDroppingTasks.status })
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.id, input.taskId))
      .limit(1);

    if (!row) return { success: false, error: 'Task tidak ditemukan.' };
    if (row.status !== 'completed')
      return { success: false, error: `Tidak bisa verifikasi task dengan status "${row.status}".` };

    await db
      .update(itemDroppingTasks)
      .set({
        status:     input.approve ? 'verified' : 'rejected',
        verifiedBy: input.actorId,
        verifiedAt: new Date(),
        notes:      input.notes,
        updatedAt:  new Date(),
      })
      .where(eq(itemDroppingTasks.id, input.taskId));

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `verifyItemDropping: ${err}` };
  }
}

// ─── Materialise helper ───────────────────────────────────────────────────────

export async function materialiseItemDroppingTask(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  shiftId:    number,
  date:       Date,
): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [active] = await db
    .select({ id: itemDroppingTasks.id })
    .from(itemDroppingTasks)
    .where(and(
      eq(itemDroppingTasks.storeId, storeId),
      gte(itemDroppingTasks.date, dayStart),
      lte(itemDroppingTasks.date, dayEnd),
      inArray(itemDroppingTasks.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .limit(1);

  if (active) return 'skipped';

  await db.insert(itemDroppingTasks).values({
    scheduleId,
    userId,
    storeId,
    shiftId,
    date:         dayStart,
    parentTaskId: null,
    hasDropping:  false,
    isReceived:   false,
    status:       'pending',
  });

  return 'created';
}

// ─── Discrepancy chain query ──────────────────────────────────────────────────

export async function getItemDroppingChain(
  originalTaskId: number,
): Promise<ItemDroppingTask[]> {
  return db
    .select()
    .from(itemDroppingTasks)
    .where(or(
      eq(itemDroppingTasks.id, originalTaskId),
      eq(itemDroppingTasks.parentTaskId, originalTaskId),
    ))
    .orderBy(itemDroppingTasks.createdAt) as Promise<ItemDroppingTask[]>;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getItemDroppingBySchedule(
  scheduleId: number,
): Promise<ItemDroppingTask | null> {
  const [row] = await db
    .select()
    .from(itemDroppingTasks)
    .where(eq(itemDroppingTasks.scheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

export async function getItemDroppingById(id: number): Promise<ItemDroppingTask | null> {
  const [row] = await db
    .select()
    .from(itemDroppingTasks)
    .where(eq(itemDroppingTasks.id, id))
    .limit(1);
  return row ?? null;
}
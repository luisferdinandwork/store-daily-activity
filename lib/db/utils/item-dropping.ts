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
//      No photos or timestamps required.
//
// B) Item dropped (hasDropping = true)
//      1. Employee records dropTime + droppingPhotos (min 1).
//      2. Task is submitted as 'completed' only when isReceived = true AND
//         receiveTime + receivedByUserId are set.
//      3. If end-of-shift and isReceived is still false:
//           • Employee submits the task as-is (partially) → status 'discrepancy'.
//           • Next morning, the SAME row is updated via parentTaskId carry-forward
//             (same pattern as evening discrepancy tasks).
//
// Access rules:
//   • Employee must be checked in (attendance row for this schedule).
//   • Employee must be inside the store's geofence (unless skipGeo).
// ─────────────────────────────────────────────────────────────────────────────

import { db }                         from '@/lib/db';
import { eq, and, gte, lte, inArray, isNull, or } from 'drizzle-orm';
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

// ─── Photo rules ─────────────────────────────────────────────────────────────

export const ITEM_DROPPING_PHOTO_RULES = {
  dropping: { min: 1, max: 5 },
} as const;

// ─── Submit input types ───────────────────────────────────────────────────────

/**
 * Initial submission of an Item Dropping task.
 *
 * Scenario A (no dropping): set hasDropping=false, omit everything else.
 * Scenario B (dropping happened):
 *   - set hasDropping=true
 *   - provide dropTime + droppingPhotos (min 1)
 *   - if item already received: set isReceived=true, receiveTime, receivedByUserId
 *   - if item NOT yet received at submit time: isReceived=false →
 *       status becomes 'discrepancy' for carry-forward next morning
 */
export interface SubmitItemDroppingInput {
  scheduleId:        number;
  userId:            string;
  storeId:           number;
  geo:               GeoPoint;
  skipGeo?:          boolean;

  /** false = no drop today; true = item arrived at store */
  hasDropping:       boolean;

  /** Required when hasDropping=true */
  dropTime?:         Date | string;

  /** Required when hasDropping=true (min 1 photo) */
  droppingPhotos?:   string[];

  /** true if the store employee received the items during this submission */
  isReceived?:       boolean;

  /** Required when isReceived=true */
  receiveTime?:      Date | string;

  /** userId of the employee receiving the item; defaults to submitting userId */
  receivedByUserId?: string;

  notes?:            string;

  /**
   * Set when carrying forward a discrepancy row from a prior day.
   * The function will UPDATE that existing row rather than insert a new one.
   */
  parentTaskId?:     number;
}

/**
 * Mark an already-submitted (discrepancy) item as received.
 * Used when a next-day employee confirms receipt of a prior-day drop.
 */
export interface ConfirmReceiptInput {
  taskId:            number;
  scheduleId:        number;
  userId:            string;
  storeId:           number;
  geo:               GeoPoint;
  skipGeo?:          boolean;
  receiveTime?:      Date | string;
  receivedByUserId?: string;
  notes?:            string;
}

export interface AutoSaveItemDroppingPatch {
  hasDropping?:      boolean;
  dropTime?:         string | null;
  droppingPhotos?:   string[];
  isReceived?:       boolean;
  receiveTime?:      string | null;
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

function validateItemDroppingPayload(input: SubmitItemDroppingInput): string | null {
  if (!input.hasDropping) return null; // Scenario A: nothing else to validate

  // Scenario B: dropping happened
  if (!input.dropTime)
    return 'Waktu dropping wajib diisi ketika ada item dropping.';

  const photoCount = input.droppingPhotos?.length ?? 0;
  if (photoCount < ITEM_DROPPING_PHOTO_RULES.dropping.min)
    return `Foto dropping wajib minimal ${ITEM_DROPPING_PHOTO_RULES.dropping.min}.`;
  if (photoCount > ITEM_DROPPING_PHOTO_RULES.dropping.max)
    return `Foto dropping maksimal ${ITEM_DROPPING_PHOTO_RULES.dropping.max}.`;

  // If isReceived is explicitly true, receiveTime must be provided
  if (input.isReceived && !input.receiveTime)
    return 'Waktu penerimaan wajib diisi ketika item sudah diterima.';

  return null;
}

// ─── Active task query (shared helper) ───────────────────────────────────────

/**
 * Returns the active (pending / in_progress / discrepancy) Item Dropping task
 * for a given store and date. Also surfaces unresolved discrepancies from prior
 * days (e.g. item not received yesterday).
 */
export async function getActiveItemDroppingTask(
  storeId: number,
  date:    Date,
): Promise<ItemDroppingTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  // Check today first
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

  // Check for unresolved discrepancy from a prior day (root row only)
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

    const validationErr = validateItemDroppingPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const TERMINAL = ['verified', 'rejected'] as const;
    const morningShiftId = await getMorningShiftId();
    const now            = new Date();

    // ── Carry-forward path (updating a discrepancy row from a prior day) ──────
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

      // Determine new status:
      //   - isReceived=true  → completed
      //   - isReceived=false → discrepancy (still waiting)
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

    // ── Fresh submit (or re-submit of own pending row) ────────────────────────
    const [existing] = await db
      .select()
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status != null && (TERMINAL as readonly string[]).includes(existing.status))
      return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

    // Compute status:
    //   Scenario A (hasDropping=false) → always completed
    //   Scenario B, isReceived=true    → completed
    //   Scenario B, isReceived=false   → discrepancy (carry-forward tomorrow)
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

// ─── Confirm receipt (standalone action for next-day carry-forward) ───────────

/**
 * Standalone action to mark an existing discrepancy task as received.
 * Called when: the next-day employee arrives and the dropped item is finally
 * accepted by a store employee, WITHOUT needing to re-do the full form.
 */
export async function confirmItemReceipt(
  input: ConfirmReceiptInput,
): Promise<TaskResult<ItemDroppingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

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
    // Import here to avoid circular dependency
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

// ─── Materialise helper (called by materialiseTasksForSchedule) ───────────────

/**
 * Creates an item_dropping_tasks row for a given schedule if one doesn't
 * already exist (or if there is no active pending/in_progress row for today).
 * Mirrors the pattern used for morning shared tasks.
 */
export async function materialiseItemDroppingTask(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  shiftId:    number,
  date:       Date,
): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  // Check if an active row already exists for this store today
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
    date:        dayStart,
    parentTaskId: null,
    hasDropping:  false,
    isReceived:   false,
    status:       'pending',
  });

  return 'created';
}

// ─── Discrepancy chain query ──────────────────────────────────────────────────

/**
 * Returns the full history of an item dropping carry-forward chain.
 * Pass the original (root) task id — returns all rows in the chain ordered
 * chronologically.
 */
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

export async function getItemDroppingById(
  id: number,
): Promise<ItemDroppingTask | null> {
  const [row] = await db
    .select()
    .from(itemDroppingTasks)
    .where(eq(itemDroppingTasks.id, id))
    .limit(1);
  return row ?? null;
}
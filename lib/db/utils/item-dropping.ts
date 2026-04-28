// lib/db/utils/item-dropping.ts
import { db }                                    from '@/lib/db';
import { eq, and, gte, lte, desc, lt }           from 'drizzle-orm';
import {
  itemDroppingTasks,
  itemDroppingEntries,
  stores,
  shifts,
  attendance,
  type ItemDroppingTask,
  type ItemDroppingEntry,
} from '@/lib/db/schema';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const ITEM_DROPPING_PHOTO_RULES = {
  dropping: { min: 1, max: 5 },
} as const;

export interface ToEntry {
  toNumber:       string;
  dropTime:       Date | string;
  droppingPhotos: string[];
  notes?:         string;
}

export interface SubmitItemDroppingInput {
  scheduleId:  number;
  userId:      string;
  storeId:     number;
  geo:         GeoPoint;
  skipGeo?:    boolean;
  hasDropping: boolean;
  entries?:    ToEntry[];
  notes?:      string;
}

export interface AddToEntryInput {
  taskId:         number;
  scheduleId:     number;
  userId:         string;
  storeId:        number;
  geo:            GeoPoint;
  skipGeo?:       boolean;
  toNumber:       string;
  dropTime:       Date | string;
  droppingPhotos: string[];
  notes?:         string;
}

export interface RemoveToEntryInput {
  entryId:    number;
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  skipGeo?:   boolean;
}

export interface AutoSaveItemDroppingPatch {
  hasDropping?: boolean;
  notes?:       string;
}

export interface VerifyTaskInput {
  taskId:  number;
  actorId: string;
  storeId: number;
  approve: boolean;
  notes?:  string;
}

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

function jsonPhotos(paths: string[] | undefined): string | null {
  return paths && paths.length > 0 ? JSON.stringify(paths) : null;
}

const _shiftIdCache: Record<string, number> = {};
async function getShiftIdByCode(code: string): Promise<number> {
  if (_shiftIdCache[code] != null) return _shiftIdCache[code];
  const [row] = await db.select({ id: shifts.id }).from(shifts)
    .where(eq(shifts.code, code)).limit(1);
  if (!row) throw new Error(`Shift not found for code: ${code}`);
  _shiftIdCache[code] = row.id;
  return row.id;
}

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

function validateToEntry(entry: ToEntry, index: number): string | null {
  if (!entry.toNumber?.trim())
    return `TO #${index + 1}: Nomor TO wajib diisi.`;
  if (!entry.dropTime)
    return `TO #${index + 1}: Waktu dropping wajib diisi.`;
  const photoCount = entry.droppingPhotos?.length ?? 0;
  if (photoCount < ITEM_DROPPING_PHOTO_RULES.dropping.min)
    return `TO #${index + 1}: Foto dropping wajib minimal ${ITEM_DROPPING_PHOTO_RULES.dropping.min}.`;
  if (photoCount > ITEM_DROPPING_PHOTO_RULES.dropping.max)
    return `TO #${index + 1}: Foto dropping maksimal ${ITEM_DROPPING_PHOTO_RULES.dropping.max}.`;
  return null;
}

export async function getActiveItemDroppingTask(
  storeId: number,
  shiftId: number,
  date:    Date,
): Promise<ItemDroppingTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [today] = await db
    .select()
    .from(itemDroppingTasks)
    .where(and(
      eq(itemDroppingTasks.storeId, storeId),
      eq(itemDroppingTasks.shiftId, shiftId), // Now filters by exact shift
      gte(itemDroppingTasks.date, dayStart),
      lte(itemDroppingTasks.date, dayEnd),
    ))
    .limit(1);

  return today ?? null;
}

export async function getItemDroppingEntries(
  taskId: number,
): Promise<ItemDroppingEntry[]> {
  return db
    .select()
    .from(itemDroppingEntries)
    .where(eq(itemDroppingEntries.taskId, taskId))
    .orderBy(itemDroppingEntries.dropTime);
}

export async function submitItemDropping(
  input: SubmitItemDroppingInput,
): Promise<TaskResult<ItemDroppingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    if (input.hasDropping && input.entries) {
      for (let i = 0; i < input.entries.length; i++) {
        const err = validateToEntry(input.entries[i], i);
        if (err) return { success: false, error: err };
      }
    }

    const TERMINAL = ['verified', 'rejected'] as const;
    const now      = new Date();
    const today    = startOfDay(now);

    const [existing] = await db
      .select()
      .from(itemDroppingTasks)
      .where(and(
        eq(itemDroppingTasks.storeId, input.storeId),
        eq(itemDroppingTasks.shiftId, input.scheduleId), // Find exact shift task
        gte(itemDroppingTasks.date, today),
        lte(itemDroppingTasks.date, endOfDay(now)),
      ))
      .limit(1);

    if (existing?.status != null && (TERMINAL as readonly string[]).includes(existing.status))
      return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

    const newStatus = 'completed' as const;

    const taskValues = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shiftId:      existing?.shiftId, // Use exact shift from DB
      date:         today,
      hasDropping:  input.hasDropping,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes:        input.notes,
      status:       newStatus,
      completedAt:  now,
      updatedAt:    now,
    };

    let task: ItemDroppingTask;
    if (existing) {
      task = (await db.update(itemDroppingTasks).set(taskValues)
        .where(eq(itemDroppingTasks.id, existing.id)).returning())[0];
    } else {
      task = (await db.insert(itemDroppingTasks).values(taskValues).returning())[0];
    }

    if (input.hasDropping && input.entries && input.entries.length > 0) {
      await db.insert(itemDroppingEntries).values(
        input.entries.map(e => ({
          taskId:         task.id,
          userId:         input.userId,
          storeId:        input.storeId,
          toNumber:       e.toNumber.trim(),
          dropTime:       new Date(e.dropTime),
          droppingPhotos: jsonPhotos(e.droppingPhotos),
          notes:          e.notes,
        }))
      );
    }

    return { success: true, data: task };
  } catch (err) {
    return { success: false, error: `submitItemDropping: ${err}` };
  }
}

export async function addToEntry(
  input: AddToEntryInput,
): Promise<TaskResult<ItemDroppingEntry>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const entryData: ToEntry = {
      toNumber:       input.toNumber,
      dropTime:       input.dropTime,
      droppingPhotos: input.droppingPhotos,
      notes:          input.notes,
    };
    const validationErr = validateToEntry(entryData, 0);
    if (validationErr) return { success: false, error: validationErr };

    const [task] = await db
      .select({ id: itemDroppingTasks.id, status: itemDroppingTasks.status })
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.id, input.taskId))
      .limit(1);

    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    const TERMINAL = ['verified', 'rejected'];
    if (TERMINAL.includes(task.status))
      return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

    const [entry] = await db.insert(itemDroppingEntries).values({
      taskId:         input.taskId,
      userId:         input.userId,
      storeId:        input.storeId,
      toNumber:       input.toNumber.trim(),
      dropTime:       new Date(input.dropTime),
      droppingPhotos: jsonPhotos(input.droppingPhotos),
      notes:          input.notes,
    }).returning();

    await db.update(itemDroppingTasks).set({
      hasDropping: true,
      status:      'completed',
      completedAt: new Date(),
      updatedAt:   new Date(),
    }).where(eq(itemDroppingTasks.id, input.taskId));

    return { success: true, data: entry };
  } catch (err) {
    return { success: false, error: `addToEntry: ${err}` };
  }
}

export async function removeToEntry(
  input: RemoveToEntryInput,
): Promise<TaskResult<void>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [entry] = await db
      .select()
      .from(itemDroppingEntries)
      .where(eq(itemDroppingEntries.id, input.entryId))
      .limit(1);

    if (!entry) return { success: false, error: 'Entry tidak ditemukan.' };

    const [task] = await db
      .select({ id: itemDroppingTasks.id, status: itemDroppingTasks.status })
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.id, entry.taskId))
      .limit(1);

    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    const TERMINAL = ['verified', 'rejected'];
    if (TERMINAL.includes(task.status))
      return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

    await db.delete(itemDroppingEntries).where(eq(itemDroppingEntries.id, input.entryId));

    const remaining = await db
      .select({ id: itemDroppingEntries.id })
      .from(itemDroppingEntries)
      .where(eq(itemDroppingEntries.taskId, entry.taskId))
      .limit(1);

    if (remaining.length === 0) {
      await db.update(itemDroppingTasks).set({
        hasDropping: false,
        updatedAt:   new Date(),
      }).where(eq(itemDroppingTasks.id, entry.taskId));
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `removeToEntry: ${err}` };
  }
}

export async function autoSaveItemDroppingById(
  taskId: number,
  patch:  AutoSaveItemDroppingPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: itemDroppingTasks.id, status: itemDroppingTasks.status })
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.id, taskId))
      .limit(1);

    if (!existing) return { success: false, error: 'Item dropping task not found.' };
    if (existing.status === 'completed' || existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('hasDropping' in patch) update.hasDropping = Boolean(patch.hasDropping);
    if ('notes'       in patch) update.notes       = patch.notes;

    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(itemDroppingTasks).set(update).where(eq(itemDroppingTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveItemDroppingById: ${err}` };
  }
}

export async function autoSaveItemDropping(
  scheduleId: number,
  patch:      AutoSaveItemDroppingPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  const [existing] = await db
    .select({ id: itemDroppingTasks.id })
    .from(itemDroppingTasks)
    .where(eq(itemDroppingTasks.scheduleId, scheduleId))
    .limit(1);
  if (!existing) return { success: false, error: 'Item dropping task not found.' };
  return autoSaveItemDroppingById(existing.id, patch);
}

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

    await db.update(itemDroppingTasks).set({
      status:     input.approve ? 'verified' : 'rejected',
      verifiedBy: input.actorId,
      verifiedAt: new Date(),
      notes:      input.notes,
      updatedAt:  new Date(),
    }).where(eq(itemDroppingTasks.id, input.taskId));

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `verifyItemDropping: ${err}` };
  }
}

export async function materialiseItemDroppingTask(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  shiftId:    number,
  date:       Date,
): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [existing] = await db
    .select({ id: itemDroppingTasks.id })
    .from(itemDroppingTasks)
    .where(and(
      eq(itemDroppingTasks.storeId, storeId),
      eq(itemDroppingTasks.shiftId, shiftId), // Check specific shift
      gte(itemDroppingTasks.date, dayStart),
      lte(itemDroppingTasks.date, dayEnd),
    ))
    .limit(1);

  if (existing) return 'skipped';

  await db.insert(itemDroppingTasks).values({
    scheduleId,
    userId,
    storeId,
    shiftId,
    date:        dayStart,
    hasDropping: false,
    status:      'pending',
  });

  return 'created';
}

export async function getOrCreateItemDroppingForSchedule(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  shiftId:    number,
  date:       Date,
): Promise<ItemDroppingTask> {
  const existing = await getActiveItemDroppingTask(storeId, shiftId, date);
  if (existing) return existing;

  const dayStart = startOfDay(date);

  const [row] = await db
    .insert(itemDroppingTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId,
      date:        dayStart,
      hasDropping: false,
      status:      'pending',
    })
    .onConflictDoNothing()
    .returning();

  // Race condition: another request inserted first — re-fetch
  return row ?? (await getActiveItemDroppingTask(storeId, shiftId, date))!;
}

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

export async function getItemDroppingWithEntries(
  taskId: number,
): Promise<{ task: ItemDroppingTask; entries: ItemDroppingEntry[] } | null> {
  const task = await getItemDroppingById(taskId);
  if (!task) return null;
  const entries = await getItemDroppingEntries(taskId);
  return { task, entries };
}
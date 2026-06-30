// lib/db/utils/item-return.ts
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  itemReturnTasks,
  itemReturnEntries,
  stores,
  schedules,
  attendance,
  type ItemReturnTask,
  type ItemReturnEntry,
} from '@/lib/db/schema';
import { getMorningShiftId } from '@/lib/db/utils/shared-daily-morning-task';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const ITEM_RETURN_PHOTO_RULES = {
  return: { min: 1, max: 5 },
} as const;

export interface ReturnEntry {
  returnNumber: string;
  description?: string | null;
  expectedAt?: Date | string | null;
  quantity: number;
  returnTime: Date | string;
  returnPhotos: string[];
  notes?: string;
}

export interface SubmitItemReturnInput {
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
  hasReturn: boolean;
  entries?: ReturnEntry[];
  notes?: string;
}

export interface AddReturnEntryInput {
  taskId: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
  returnNumber: string;
  description?: string | null;
  expectedAt?: Date | string | null;
  quantity: number;
  returnTime: Date | string;
  returnPhotos: string[];
  notes?: string;
}

export interface RemoveReturnEntryInput {
  entryId: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
}

export interface AutoSaveItemReturnPatch {
  hasReturn?: boolean;
  notes?: string;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

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

function jsonPhotos(paths: string[] | undefined): string | null {
  return paths && paths.length > 0 ? JSON.stringify(paths) : null;
}

function nullableDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

  const dist = haversineMetres(geo, {
    lat: parseFloat(store.lat),
    lng: parseFloat(store.lng),
  });

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

function validateReturnEntry(entry: ReturnEntry, index: number): string | null {
  const label = `Return #${index + 1}`;

  if (!entry.returnNumber?.trim()) {
    return `${label}: Nomor return wajib diisi.`;
  }

  const qty = Number(entry.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return `${label}: Quantity wajib lebih dari 0.`;
  }

  if (!entry.returnTime) {
    return `${label}: Waktu return wajib diisi.`;
  }

  const photoCount = entry.returnPhotos?.length ?? 0;

  if (photoCount < ITEM_RETURN_PHOTO_RULES.return.min) {
    return `${label}: Foto bukti return wajib minimal ${ITEM_RETURN_PHOTO_RULES.return.min}.`;
  }

  if (photoCount > ITEM_RETURN_PHOTO_RULES.return.max) {
    return `${label}: Foto bukti return maksimal ${ITEM_RETURN_PHOTO_RULES.return.max}.`;
  }

  return null;
}

export async function getActiveItemReturnTask(
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<ItemReturnTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const morningShiftId = await getMorningShiftId();

  const [today] = await db
    .select()
    .from(itemReturnTasks)
    .where(and(
      eq(itemReturnTasks.storeId, storeId),
      eq(itemReturnTasks.shiftId, morningShiftId),
      gte(itemReturnTasks.date, dayStart),
      lte(itemReturnTasks.date, dayEnd),
    ))
    .limit(1);

  return today ?? null;
}

export async function getItemReturnEntries(taskId: number): Promise<ItemReturnEntry[]> {
  return db
    .select()
    .from(itemReturnEntries)
    .where(eq(itemReturnEntries.taskId, taskId))
    .orderBy(itemReturnEntries.returnTime);
}

export async function submitItemReturn(
  input: SubmitItemReturnInput,
): Promise<TaskResult<ItemReturnTask>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );

    if (gateErr) return { success: false, error: gateErr };

    if (input.hasReturn) {
      if (!input.entries || input.entries.length === 0) {
        return { success: false, error: 'Ada item return hari ini, minimal satu return harus dicatat.' };
      }

      for (let i = 0; i < input.entries.length; i++) {
        const err = validateReturnEntry(input.entries[i], i);
        if (err) return { success: false, error: err };
      }
    }

    const now = new Date();
    const morningShiftId = await getMorningShiftId();

    const [schedule] = await db
      .select({ date: schedules.date })
      .from(schedules)
      .where(eq(schedules.id, input.scheduleId))
      .limit(1);

    const taskDate = schedule?.date ?? now;

    let existing = await getActiveItemReturnTask(input.storeId, morningShiftId, taskDate);

    if (!existing) {
      existing = await getOrCreateItemReturnForSchedule(
        input.scheduleId,
        input.userId,
        input.storeId,
        morningShiftId,
        taskDate,
      );
    }

    if (!existing) {
      return { success: false, error: 'Item Return task belum dibuat. Buka ulang halaman task terlebih dahulu.' };
    }

    if (existing.status === 'completed') {
      return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };
    }

    const [task] = await db
      .update(itemReturnTasks)
      .set({
        scheduleId: input.scheduleId,
        userId: input.userId,
        storeId: input.storeId,
        shiftId: morningShiftId,
        date: startOfDay(taskDate),
        hasReturn: input.hasReturn,
        submittedLat: input.skipGeo ? null : String(input.geo.lat),
        submittedLng: input.skipGeo ? null : String(input.geo.lng),
        notes: input.notes,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(itemReturnTasks.id, existing.id))
      .returning();

    await db.delete(itemReturnEntries).where(eq(itemReturnEntries.taskId, task.id));

    if (input.hasReturn && input.entries && input.entries.length > 0) {
      await db.insert(itemReturnEntries).values(
        input.entries.map((entry) => ({
          taskId: task.id,
          userId: input.userId,
          storeId: input.storeId,
          returnNumber: entry.returnNumber.trim(),
          description: entry.description ?? null,
          expectedAt: nullableDate(entry.expectedAt),
          quantity: Math.floor(Number(entry.quantity)),
          returnTime: new Date(entry.returnTime),
          returnPhotos: jsonPhotos(entry.returnPhotos),
          notes: entry.notes,
        })),
      );
    }

    return { success: true, data: task };
  } catch (err) {
    return { success: false, error: `submitItemReturn: ${err}` };
  }
}

export async function addReturnEntry(
  input: AddReturnEntryInput,
): Promise<TaskResult<ItemReturnEntry>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );

    if (gateErr) return { success: false, error: gateErr };

    const entryData: ReturnEntry = {
      returnNumber: input.returnNumber,
      description: input.description,
      expectedAt: input.expectedAt,
      quantity: input.quantity,
      returnTime: input.returnTime,
      returnPhotos: input.returnPhotos,
      notes: input.notes,
    };

    const validationErr = validateReturnEntry(entryData, 0);
    if (validationErr) return { success: false, error: validationErr };

    const [task] = await db
      .select({ id: itemReturnTasks.id, status: itemReturnTasks.status })
      .from(itemReturnTasks)
      .where(eq(itemReturnTasks.id, input.taskId))
      .limit(1);

    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    if (task.status === 'completed') return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

    const [entry] = await db
      .insert(itemReturnEntries)
      .values({
        taskId: input.taskId,
        userId: input.userId,
        storeId: input.storeId,
        returnNumber: input.returnNumber.trim(),
        description: input.description ?? null,
        expectedAt: nullableDate(input.expectedAt),
        quantity: Math.floor(Number(input.quantity)),
        returnTime: new Date(input.returnTime),
        returnPhotos: jsonPhotos(input.returnPhotos),
        notes: input.notes,
      })
      .returning();

    await db
      .update(itemReturnTasks)
      .set({ hasReturn: true, status: 'in_progress', updatedAt: new Date() })
      .where(eq(itemReturnTasks.id, input.taskId));

    return { success: true, data: entry };
  } catch (err) {
    return { success: false, error: `addReturnEntry: ${err}` };
  }
}

export async function removeReturnEntry(input: RemoveReturnEntryInput): Promise<TaskResult<void>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [entry] = await db
      .select()
      .from(itemReturnEntries)
      .where(eq(itemReturnEntries.id, input.entryId))
      .limit(1);

    if (!entry) return { success: false, error: 'Entry tidak ditemukan.' };

    const [task] = await db
      .select({ id: itemReturnTasks.id, status: itemReturnTasks.status })
      .from(itemReturnTasks)
      .where(eq(itemReturnTasks.id, entry.taskId))
      .limit(1);

    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    if (task.status === 'completed') return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

    await db.delete(itemReturnEntries).where(eq(itemReturnEntries.id, input.entryId));

    const remaining = await db
      .select({ id: itemReturnEntries.id })
      .from(itemReturnEntries)
      .where(eq(itemReturnEntries.taskId, entry.taskId))
      .limit(1);

    if (remaining.length === 0) {
      await db
        .update(itemReturnTasks)
        .set({ hasReturn: false, updatedAt: new Date() })
        .where(eq(itemReturnTasks.id, entry.taskId));
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `removeReturnEntry: ${err}` };
  }
}

export async function autoSaveItemReturnById(
  taskId: number,
  patch: AutoSaveItemReturnPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: itemReturnTasks.id, status: itemReturnTasks.status })
      .from(itemReturnTasks)
      .where(eq(itemReturnTasks.id, taskId))
      .limit(1);

    if (!existing) return { success: false, error: 'Item return task not found.' };
    if (existing.status === 'completed') return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ('hasReturn' in patch) update.hasReturn = Boolean(patch.hasReturn);
    if ('notes' in patch) update.notes = patch.notes;
    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(itemReturnTasks).set(update).where(eq(itemReturnTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter((key) => key !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveItemReturnById: ${err}` };
  }
}

export async function autoSaveItemReturn(
  scheduleId: number,
  patch: AutoSaveItemReturnPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return { success: false, error: 'Schedule not found.' };

  const morningShiftId = await getMorningShiftId();
  const existing = await getActiveItemReturnTask(schedule.storeId, morningShiftId, schedule.date);

  if (!existing) return { success: false, error: 'Item return task not found.' };
  return autoSaveItemReturnById(existing.id, patch);
}

export async function materialiseItemReturnTask(
  scheduleId: number,
  userId: string,
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const morningShiftId = await getMorningShiftId();

  const [existing] = await db
    .select({ id: itemReturnTasks.id })
    .from(itemReturnTasks)
    .where(and(
      eq(itemReturnTasks.storeId, storeId),
      eq(itemReturnTasks.shiftId, morningShiftId),
      gte(itemReturnTasks.date, dayStart),
      lte(itemReturnTasks.date, dayEnd),
    ))
    .limit(1);

  if (existing) return 'skipped';

  await db.insert(itemReturnTasks).values({
    scheduleId,
    userId,
    storeId,
    shiftId: morningShiftId,
    date: dayStart,
    hasReturn: false,
    status: 'pending',
  });

  return 'created';
}

export async function getOrCreateItemReturnForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<ItemReturnTask> {
  const morningShiftId = await getMorningShiftId();
  const existing = await getActiveItemReturnTask(storeId, morningShiftId, date);
  if (existing) return existing;

  const dayStart = startOfDay(date);

  const [row] = await db
    .insert(itemReturnTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: morningShiftId,
      date: dayStart,
      hasReturn: false,
      status: 'pending',
    })
    .onConflictDoNothing()
    .returning();

  return row ?? (await getActiveItemReturnTask(storeId, morningShiftId, date))!;
}

export async function getItemReturnBySchedule(scheduleId: number): Promise<ItemReturnTask | null> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return null;
  const morningShiftId = await getMorningShiftId();
  return getActiveItemReturnTask(schedule.storeId, morningShiftId, schedule.date);
}

export async function getItemReturnById(id: number): Promise<ItemReturnTask | null> {
  const [row] = await db.select().from(itemReturnTasks).where(eq(itemReturnTasks.id, id)).limit(1);
  return row ?? null;
}

export async function getItemReturnWithEntries(
  taskId: number,
): Promise<{ task: ItemReturnTask; entries: ItemReturnEntry[] } | null> {
  const task = await getItemReturnById(taskId);
  if (!task) return null;
  const entries = await getItemReturnEntries(taskId);
  return { task, entries };
}

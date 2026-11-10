// lib/db/utils/cek-bin.ts
//
// Cek Bin task row (one shared row per store/day). What was checked and what is
// wrong is NOT stored here: the staff app and the Ops task detail read it live from
// Business Central (lib/bc/bin-content-check.ts → "Hasil scan BC"). This file only
// keeps the task's lifecycle: created lazily when an employee opens it, and marked
// done the moment they open it (completeCekBin — no submit button, nothing to fill
// in) behind the check-in / geofence gate.
import type { GeoPoint } from '@/lib/geo';
import { assertInGeofence } from '@/lib/db/utils/geofence';
import { db } from '@/lib/db';
import { taskShiftIdFor } from '@/lib/db/utils/shift-lookup';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { attendance, cekBinTasks, type CekBinTask } from '@/lib/db/schema';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type { GeoPoint };

export interface CompleteCekBinInput {
  scheduleId: number;
  userId: string;
  storeId: number;
  shiftId?: number;
  geo: GeoPoint;
  skipGeo?: boolean;
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

async function findCekBinByStoreDate(storeId: number, date: Date): Promise<CekBinTask | null> {
  const [row] = await db
    .select()
    .from(cekBinTasks)
    .where(and(
      eq(cekBinTasks.storeId, storeId),
      gte(cekBinTasks.date, startOfDay(date)),
      lte(cekBinTasks.date, endOfDay(date)),
    ))
    .limit(1);

  return row ?? null;
}

export async function getOrCreateCekBinForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  rawShiftId: number,
  date: Date,
): Promise<TaskResult<CekBinTask>> {
  // JKP shifts work their base shift's store-level row (JP → morning, JS → evening).
  const shiftId = await taskShiftIdFor(rawShiftId);
  try {
    const day = startOfDay(date);

    let task = await findCekBinByStoreDate(storeId, day);

    if (!task) {
      const [created] = await db
        .insert(cekBinTasks)
        .values({
          scheduleId,
          userId,
          storeId,
          shiftId,
          date: day,
          status: 'not_started',
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      task = created ?? (await findCekBinByStoreDate(storeId, day));
    }

    if (!task) return { success: false, error: 'Gagal membuat task Cek BIN.' };

    return { success: true, data: task };
  } catch (err) {
    return { success: false, error: `getOrCreateCekBinForSchedule: ${err}` };
  }
}

/** Statuses that are already past "open": a repeat call just hands the task back. */
const FINISHED_STATUSES = new Set<string>(['completed', 'verified', 'rejected']);

/** Statuses an employee opening the task may take over. */
const OPEN_STATUSES = ['not_started', 'in_progress', 'pending'] as const;

/**
 * Marks the day's Cek Bin done — called when an employee OPENS the task (there is no
 * submit step: the scan itself happens in Business Central and the page only shows
 * the result). Behind the same check-in + geofence gate as every task. Idempotent:
 * a task that is already completed / verified / rejected is returned untouched and
 * without the gate, so re-opening it (or two colleagues opening it at once) is safe
 * and never rewinds a status or overwrites who finished it.
 */
export async function completeCekBin(input: CompleteCekBinInput): Promise<TaskResult<CekBinTask>> {
  try {
    const now = new Date();
    let task = await findCekBinByStoreDate(input.storeId, now);

    if (task && FINISHED_STATUSES.has(task.status)) return { success: true, data: task };

    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      ...(input.shiftId ? { shiftId: input.shiftId } : {}),
      date: startOfDay(now),
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
    };

    if (task) {
      // Only an open row is taken over; if a colleague finished it a moment ago the
      // guarded update touches nothing and we hand back their result.
      const [updated] = await db
        .update(cekBinTasks)
        .set(values)
        .where(and(eq(cekBinTasks.id, task.id), inArray(cekBinTasks.status, [...OPEN_STATUSES])))
        .returning();
      task = updated ?? (await findCekBinByStoreDate(input.storeId, now)) ?? task;
    } else {
      if (!input.shiftId) {
        return { success: false, error: 'shiftId wajib dikirim saat task Cek BIN belum dibuat.' };
      }
      const [created] = await db
        .insert(cekBinTasks)
        .values({ ...values, shiftId: input.shiftId })
        .onConflictDoNothing()
        .returning();
      task = created ?? (await findCekBinByStoreDate(input.storeId, now));
      if (!task) return { success: false, error: 'Gagal membuat task Cek BIN.' };
    }

    return { success: true, data: task };
  } catch (err) {
    return { success: false, error: `completeCekBin: ${err}` };
  }
}

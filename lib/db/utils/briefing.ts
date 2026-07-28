// lib/db/utils/briefing.ts
//
// Briefing is a per-SHIFT, shared task: every employee working the same
// shift at the same store/day sees and completes the SAME row. A full_day
// employee works both halves of the day, so they get (and can complete)
// BOTH the morning row and the evening row.
import { and, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  attendance,
  briefingTasks,
  schedules,
  stores,
  type BriefingTask,
} from '@/lib/db/schema';
import {
  getMorningShiftId,
  getEveningShiftId,
  getFullDayShiftId,
  startOfDay,
  endOfDay,
} from '@/lib/db/utils/shift-lookup';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface SubmitBriefingInput {
  taskId?: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  shiftId?: number;
  geo: GeoPoint;
  notes?: string;
  skipGeo?: boolean;
}

const DEFAULT_GEOFENCE_RADIUS_M = 100;

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;

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

async function assertInGeofence(
  storeId: number,
  geo: GeoPoint,
): Promise<string | null> {
  const [store] = await db
    .select({
      lat: stores.latitude,
      lng: stores.longitude,
      radius: stores.geofenceRadiusM,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;

  const radiusM = store.radius
    ? Number(store.radius)
    : DEFAULT_GEOFENCE_RADIUS_M;

  const distanceM = haversineMetres(geo, {
    lat: Number(store.lat),
    lng: Number(store.lng),
  });

  if (distanceM > radiusM) {
    return `Kamu berada ${Math.round(distanceM)}m dari toko (batas: ${radiusM}m). Pastikan kamu berada di dalam toko dan coba lagi.`;
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

async function getOrCreateSingleBriefingRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  targetShiftId: number,
  dayStart: Date,
  dayEnd: Date,
): Promise<BriefingTask> {
  const [existing] = await db
    .select()
    .from(briefingTasks)
    .where(
      and(
        eq(briefingTasks.storeId, storeId),
        eq(briefingTasks.shiftId, targetShiftId),
        gte(briefingTasks.date, dayStart),
        lte(briefingTasks.date, dayEnd),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(briefingTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: targetShiftId,
      date: dayStart,
      done: false,
      isBalanced: null,
      status: 'not_started',
    })
    .onConflictDoNothing({
      target: [briefingTasks.storeId, briefingTasks.date, briefingTasks.shiftId],
    })
    .returning();

  if (created) return created;

  // Lost the race to a concurrent request — read back what it created.
  const [row] = await db
    .select()
    .from(briefingTasks)
    .where(
      and(
        eq(briefingTasks.storeId, storeId),
        eq(briefingTasks.shiftId, targetShiftId),
        gte(briefingTasks.date, dayStart),
        lte(briefingTasks.date, dayEnd),
      ),
    )
    .limit(1);

  if (!row) throw new Error('Failed to create or find briefing row after conflict.');
  return row;
}

/**
 * Ensures the briefing row(s) for this schedule's shift exist.
 * A full_day schedule gets BOTH the morning and evening rows (they work
 * both halves of the day); a morning/evening schedule gets its own single
 * row, shared with every other employee on that same shift/store/day.
 */
export async function getOrCreateBriefingForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<TaskResult<BriefingTask[]>> {
  try {
    const dayStart = startOfDay(date);
    const dayEnd   = endOfDay(date);

    const morningShiftId = await getMorningShiftId();
    const eveningShiftId = await getEveningShiftId();
    const fullDayShiftId = await getFullDayShiftId();

    const targetShiftIds =
      shiftId === fullDayShiftId ? [morningShiftId, eveningShiftId] : [shiftId];

    const rows: BriefingTask[] = [];
    for (const targetShiftId of targetShiftIds) {
      rows.push(
        await getOrCreateSingleBriefingRow(scheduleId, userId, storeId, targetShiftId, dayStart, dayEnd),
      );
    }

    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: `getOrCreateBriefingForSchedule: ${err}` };
  }
}

/**
 * Briefing is intentionally simple:
 * - no balanced/discrepancy flow
 * - no carry-forward
 * - completion means the shift briefing was done
 */
export async function submitBriefing(
  input: SubmitBriefingInput,
): Promise<TaskResult<BriefingTask>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );

    if (gateErr) return { success: false, error: gateErr };

    const now = new Date();

    let existing: BriefingTask | undefined;

    if (input.taskId) {
      [existing] = await db
        .select()
        .from(briefingTasks)
        .where(eq(briefingTasks.id, input.taskId))
        .limit(1);
    }

    if (!existing) {
      const [schedule] = await db
        .select({ date: schedules.date, shiftId: schedules.shiftId })
        .from(schedules)
        .where(eq(schedules.id, input.scheduleId))
        .limit(1);

      const shiftId = input.shiftId ?? schedule?.shiftId;
      if (!shiftId) {
        return { success: false, error: 'Shift tidak ditemukan untuk schedule ini.' };
      }

      const result = await getOrCreateBriefingForSchedule(
        input.scheduleId,
        input.userId,
        input.storeId,
        shiftId,
        schedule?.date ?? now,
      );

      if (!result.success) return result;
      existing = result.data[0];
    }

    if (!existing) {
      return { success: false, error: 'Task briefing tidak ditemukan.' };
    }

    if (existing.status === 'completed') {
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };
    }

    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: existing.shiftId,
      date: startOfDay(existing.date ?? now),
      parentTaskId: null,
      done: true,
      isBalanced: true,
      submittedLat: input.skipGeo ? null : String(input.geo.lat),
      submittedLng: input.skipGeo ? null : String(input.geo.lng),
      notes: input.notes,
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
    };

    const [row] = await db
      .update(briefingTasks)
      .set(values)
      .where(eq(briefingTasks.id, existing.id))
      .returning();

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitBriefing: ${err}` };
  }
}

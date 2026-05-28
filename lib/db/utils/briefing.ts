// lib/db/utils/briefing.ts
import { and, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  attendance,
  briefingTasks,
  schedules,
  stores,
  type BriefingTask,
} from '@/lib/db/schema';
import { getMorningShiftId } from '@/lib/db/utils/shared-daily-morning-task';

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


export async function getOrCreateBriefingForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<TaskResult<BriefingTask>> {
  try {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    const morningShiftId = await getMorningShiftId();

    const [existing] = await db
      .select()
      .from(briefingTasks)
      .where(
        and(
          eq(briefingTasks.storeId, storeId),
          eq(briefingTasks.shiftId, morningShiftId),
          gte(briefingTasks.date, dayStart),
          lte(briefingTasks.date, dayEnd),
        ),
      )
      .limit(1);

    if (existing) return { success: true, data: existing };

    const [created] = await db
      .insert(briefingTasks)
      .values({
        scheduleId,
        userId,
        storeId,
        shiftId: morningShiftId,
        date: dayStart,
        done: false,
        isBalanced: null,
        status: 'pending',
      })
      .returning();

    return { success: true, data: created };
  } catch (err) {
    return { success: false, error: `getOrCreateBriefingForSchedule: ${err}` };
  }
}

/**
 * Briefing is now intentionally simple:
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
    const morningShiftId = await getMorningShiftId();

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
        .select({ date: schedules.date })
        .from(schedules)
        .where(eq(schedules.id, input.scheduleId))
        .limit(1);

      const result = await getOrCreateBriefingForSchedule(
        input.scheduleId,
        input.userId,
        input.storeId,
        morningShiftId,
        schedule?.date ?? now,
      );

      if (!result.success) return result;
      existing = result.data;
    }

    if (existing.status === 'completed') {
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };
    }

    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: morningShiftId,
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

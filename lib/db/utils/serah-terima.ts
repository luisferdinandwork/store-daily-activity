// lib/db/utils/serah-terima.ts
import { and, eq, gte, isNull, lte, asc } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  attendance,
  schedules,
  serahTerimaItems,
  serahTerimaTasks,
  stores,
  type SerahTerimaTask,
} from '@/lib/db/schema';
import { getMorningShiftId } from '@/lib/db/utils/shared-daily-morning-task';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface SubmitSerahTerimaInput {
  taskId?: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  shiftId?: number;
  geo: GeoPoint;
  handoverText: string;
  notes?: string;
  skipGeo?: boolean;
}

export interface CompleteSerahTerimaItemInput {
  itemId: number;
  userId: string;
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

  const radiusM = store.radius ? Number(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;
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

function splitHandoverText(raw: string): string[] {
  return raw
    .split(/\r?\n|;/)
    .map((line) =>
      line
        .replace(/^[-*•\d.)\s]+/, '')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Links unassigned incoming items to a morning task.
 *
 * The evening shift submits on date D (e.g. May 28 at 22:00).
 * The morning task opens on date D+1 (e.g. May 29 at 08:00).
 *
 * Because items are created on D but the morning task date is D+1, a simple
 * same-day window would never match them. We therefore look back 36 hours from
 * the end of the morning task's day, which reliably captures any items written
 * the previous evening without picking up items from two days ago.
 *
 * The query intentionally excludes items that are already linked
 * (receiverTaskId IS NULL) to avoid double-assigning.
 */
async function linkPendingIncomingItems(
  taskId: number,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<void> {
  // Look back 36 h from the end of the morning task's calendar day.
  // This window captures evening submissions from the night before (D−1 18:00
  // through D 23:59) without ever reaching two days back.
  const windowEnd   = endOfDay(date);
  const windowStart = new Date(windowEnd.getTime() - 36 * 60 * 60 * 1000);

  await db
    .update(serahTerimaItems)
    .set({ receiverTaskId: taskId, updatedAt: new Date() })
    .where(
      and(
        eq(serahTerimaItems.storeId, storeId),
        eq(serahTerimaItems.targetShiftId, shiftId),
        // Only link items that have not yet been assigned to a receiver task.
        // Without this guard a re-create / refresh would steal items that
        // already belong to a different morning task.
        isNull(serahTerimaItems.receiverTaskId),
        gte(serahTerimaItems.createdAt, windowStart),
        lte(serahTerimaItems.createdAt, windowEnd),
      ),
    );
}

export async function getOrCreateSerahTerimaForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<TaskResult<SerahTerimaTask>> {
  try {
    const dayStart = startOfDay(date);
    const dayEnd   = endOfDay(date);
    const morningShiftId = await getMorningShiftId();

    const [existing] = await db
      .select()
      .from(serahTerimaTasks)
      .where(
        and(
          eq(serahTerimaTasks.storeId, storeId),
          eq(serahTerimaTasks.shiftId, morningShiftId),
          gte(serahTerimaTasks.date, dayStart),
          lte(serahTerimaTasks.date, dayEnd),
        ),
      )
      .limit(1);

    if (existing) {
      await linkPendingIncomingItems(existing.id, storeId, morningShiftId, date);
      return { success: true, data: existing };
    }

    const [created] = await db
      .insert(serahTerimaTasks)
      .values({
        scheduleId,
        userId,
        storeId,
        shiftId: morningShiftId,
        date: dayStart,
        handoverText: '',
        status: 'pending',
      })
      .returning();

    await linkPendingIncomingItems(created.id, storeId, morningShiftId, date);

    return { success: true, data: created };
  } catch (err) {
    return { success: false, error: `getOrCreateSerahTerimaForSchedule: ${err}` };
  }
}

export async function getSerahTerimaById(taskId: number) {
  const [task] = await db
    .select()
    .from(serahTerimaTasks)
    .where(eq(serahTerimaTasks.id, taskId))
    .limit(1);

  if (!task) return null;

  const outgoingItems = await db
    .select()
    .from(serahTerimaItems)
    .where(eq(serahTerimaItems.taskId, task.id))
    .orderBy(asc(serahTerimaItems.id));

  const incomingItems = await db
    .select()
    .from(serahTerimaItems)
    .where(eq(serahTerimaItems.receiverTaskId, task.id))
    .orderBy(asc(serahTerimaItems.id));

  return { task, outgoingItems, incomingItems };
}

export async function submitSerahTerima(
  input: SubmitSerahTerimaInput,
): Promise<TaskResult<Awaited<ReturnType<typeof getSerahTerimaById>>>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );

    if (gateErr) return { success: false, error: gateErr };

    const messages = splitHandoverText(input.handoverText);

    // ── Determine which task record to update ──────────────────────────────
    let task: SerahTerimaTask | undefined;

    if (input.taskId) {
      [task] = await db
        .select()
        .from(serahTerimaTasks)
        .where(eq(serahTerimaTasks.id, input.taskId))
        .limit(1);
    } else {
      const [schedule] = await db
        .select({ shiftId: schedules.shiftId, date: schedules.date })
        .from(schedules)
        .where(eq(schedules.id, input.scheduleId))
        .limit(1);

      const shiftId = input.shiftId ?? schedule?.shiftId;

      if (!shiftId) {
        return { success: false, error: 'Shift tidak ditemukan untuk schedule ini.' };
      }

      const result = await getOrCreateSerahTerimaForSchedule(
        input.scheduleId,
        input.userId,
        input.storeId,
        shiftId,
        schedule?.date ?? new Date(),
      );

      if (!result.success) return result;
      task = result.data;
    }

    if (!task) {
      return { success: false, error: 'Task serah terima tidak ditemukan.' };
    }

    if (task.status === 'completed') {
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };
    }

    // ── Determine targetShiftId and targetDate for the items ───────────────
    //
    // The items written by the EVENING shift must appear in the NEXT DAY's
    // morning task, not today's.  We resolve this by:
    //
    //   1. Always targeting the morning shift id.
    //   2. Setting `createdAt` on the items to the start of TOMORROW (D+1
    //      00:00:00 local-server time).  This means `linkPendingIncomingItems`
    //      run by the next morning's task will find them inside its 36-hour
    //      lookback window, while the CURRENT morning task (whose window ends
    //      at today 23:59:59) will NOT pick them up if it re-links.
    //
    // If the evening shift submits after midnight (edge case), "tomorrow" is
    // actually the same calendar day — that is fine because the morning task
    // for that calendar day has not been created yet.
    const morningShiftId = await getMorningShiftId();

    const now      = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Set to 00:00:00.000 of the next calendar day so the items sit cleanly
    // at the boundary and are unambiguously "for tomorrow".
    tomorrow.setHours(0, 0, 0, 0);

    // ── Persist ────────────────────────────────────────────────────────────
    const [updated] = await db
      .update(serahTerimaTasks)
      .set({
        userId:       input.userId,
        handoverText: input.handoverText,
        shiftId:      morningShiftId,
        submittedLat: input.skipGeo ? null : String(input.geo.lat),
        submittedLng: input.skipGeo ? null : String(input.geo.lng),
        notes:        input.notes,
        status:       'completed',
        completedAt:  now,
        updatedAt:    now,
      })
      .where(eq(serahTerimaTasks.id, task.id))
      .returning();

    // Replace previous outgoing items wholesale so re-submits stay clean.
    await db
      .delete(serahTerimaItems)
      .where(eq(serahTerimaItems.taskId, task.id));

    if (messages.length > 0) {
      await db.insert(serahTerimaItems).values(
        messages.map((message) => ({
          taskId:         task!.id,
          storeId:        input.storeId,
          sourceUserId:   input.userId,
          targetShiftId:  morningShiftId,
          message,
          isCompleted:    false,
          // createdAt = tomorrow 00:00 so the morning task on D+1 finds these
          // items inside its 36-hour lookback window, but today's morning task
          // (window end = today 23:59:59) does NOT accidentally link them.
          createdAt:  tomorrow,
          updatedAt:  now,
        })),
      );
    }

    const full = await getSerahTerimaById(updated.id);
    return { success: true, data: full };
  } catch (err) {
    return { success: false, error: `submitSerahTerima: ${err}` };
  }
}

export async function completeSerahTerimaItem(
  input: CompleteSerahTerimaItemInput,
): Promise<TaskResult> {
  try {
    const [existing] = await db
      .select({ id: serahTerimaItems.id })
      .from(serahTerimaItems)
      .where(eq(serahTerimaItems.id, input.itemId))
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Item serah terima tidak ditemukan.' };
    }

    await db
      .update(serahTerimaItems)
      .set({
        isCompleted: true,
        completedBy: input.userId,
        completedAt: new Date(),
        updatedAt:   new Date(),
      })
      .where(eq(serahTerimaItems.id, input.itemId));

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `completeSerahTerimaItem: ${err}` };
  }
}
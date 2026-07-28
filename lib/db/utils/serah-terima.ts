// lib/db/utils/serah-terima.ts
//
// Serah Terima is a per-SHIFT handover: each shift at a store/day has its
// own row where that shift's employees write outgoing notes for the NEXT
// shift. The chain is:
//
//   morning (day D)  →  evening (day D)  →  morning (day D+1)  →  ...
//
// A row's "incoming" items are simply the previous row's outgoing items.
// A full_day employee works both halves of the day, so they get (and can
// submit) BOTH the morning row and the evening row for their store/day —
// same treatment as briefing.
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  attendance,
  schedules,
  serahTerimaItems,
  serahTerimaTasks,
  stores,
  type SerahTerimaTask,
} from '@/lib/db/schema';
import {
  getMorningShiftId,
  getEveningShiftId,
  getFullDayShiftId,
  startOfDay,
  endOfDay,
  addDays,
} from '@/lib/db/utils/shift-lookup';

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
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);
}

// ─── Shift chain helpers ────────────────────────────────────────────────────
// morning(D) → evening(D) → morning(D+1) → evening(D+1) → ...

async function nextInChain(
  shiftId: number,
  date: Date,
): Promise<{ shiftId: number; date: Date } | null> {
  const morningShiftId = await getMorningShiftId();
  const eveningShiftId = await getEveningShiftId();

  if (shiftId === morningShiftId) return { shiftId: eveningShiftId, date };
  if (shiftId === eveningShiftId) return { shiftId: morningShiftId, date: addDays(date, 1) };
  return null; // unknown/custom shift code — no chain concept
}

async function prevInChain(
  shiftId: number,
  date: Date,
): Promise<{ shiftId: number; date: Date } | null> {
  const morningShiftId = await getMorningShiftId();
  const eveningShiftId = await getEveningShiftId();

  if (shiftId === morningShiftId) return { shiftId: eveningShiftId, date: addDays(date, -1) };
  if (shiftId === eveningShiftId) return { shiftId: morningShiftId, date };
  return null;
}

async function findRow(
  storeId: number,
  targetShiftId: number,
  date: Date,
): Promise<SerahTerimaTask | undefined> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [row] = await db
    .select()
    .from(serahTerimaTasks)
    .where(
      and(
        eq(serahTerimaTasks.storeId, storeId),
        eq(serahTerimaTasks.shiftId, targetShiftId),
        gte(serahTerimaTasks.date, dayStart),
        lte(serahTerimaTasks.date, dayEnd),
      ),
    )
    .limit(1);

  return row;
}

/** Links a predecessor row's outgoing items to `row` as its incoming items. */
async function linkFromPredecessor(row: SerahTerimaTask): Promise<void> {
  const predecessor = await prevInChain(row.shiftId, row.date);
  if (!predecessor) return;

  const predRow = await findRow(row.storeId, predecessor.shiftId, predecessor.date);
  if (!predRow) return;

  await db
    .update(serahTerimaItems)
    .set({ receiverTaskId: row.id, updatedAt: new Date() })
    .where(
      and(
        eq(serahTerimaItems.taskId, predRow.id),
        eq(serahTerimaItems.storeId, row.storeId),
        isNull(serahTerimaItems.receiverTaskId),
      ),
    );
}

async function getOrCreateSingleSerahTerimaRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  targetShiftId: number,
  dayStart: Date,
  dayEnd: Date,
): Promise<SerahTerimaTask> {
  const [existing] = await db
    .select()
    .from(serahTerimaTasks)
    .where(
      and(
        eq(serahTerimaTasks.storeId, storeId),
        eq(serahTerimaTasks.shiftId, targetShiftId),
        gte(serahTerimaTasks.date, dayStart),
        lte(serahTerimaTasks.date, dayEnd),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(serahTerimaTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: targetShiftId,
      date: dayStart,
      handoverText: '',
      status: 'not_started',
    })
    .onConflictDoNothing({
      target: [serahTerimaTasks.storeId, serahTerimaTasks.date, serahTerimaTasks.shiftId],
    })
    .returning();

  if (created) return created;

  // Lost the race to a concurrent request — read back what it created.
  const [row] = await db
    .select()
    .from(serahTerimaTasks)
    .where(
      and(
        eq(serahTerimaTasks.storeId, storeId),
        eq(serahTerimaTasks.shiftId, targetShiftId),
        gte(serahTerimaTasks.date, dayStart),
        lte(serahTerimaTasks.date, dayEnd),
      ),
    )
    .limit(1);

  if (!row) throw new Error('Failed to create or find serah terima row after conflict.');
  return row;
}

/**
 * Ensures the serah terima row(s) for this schedule's shift exist, and pulls
 * in any outgoing items already left by the predecessor shift as incoming.
 * A full_day schedule gets BOTH the morning and evening rows.
 */
export async function getOrCreateSerahTerimaForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<TaskResult<SerahTerimaTask[]>> {
  try {
    const dayStart = startOfDay(date);
    const dayEnd   = endOfDay(date);

    const morningShiftId = await getMorningShiftId();
    const eveningShiftId = await getEveningShiftId();
    const fullDayShiftId = await getFullDayShiftId();

    const targetShiftIds =
      shiftId === fullDayShiftId ? [morningShiftId, eveningShiftId] : [shiftId];

    const rows: SerahTerimaTask[] = [];
    for (const targetShiftId of targetShiftIds) {
      const row = await getOrCreateSingleSerahTerimaRow(
        scheduleId, userId, storeId, targetShiftId, dayStart, dayEnd,
      );
      await linkFromPredecessor(row);
      rows.push(row);
    }

    return { success: true, data: rows };
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
      task = result.data[0];
    }

    if (!task) {
      return { success: false, error: 'Task serah terima tidak ditemukan.' };
    }

    if (task.status === 'completed') {
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };
    }

    const now = new Date();

    // ── Persist ────────────────────────────────────────────────────────────
    const [updated] = await db
      .update(serahTerimaTasks)
      .set({
        userId:       input.userId,
        handoverText: input.handoverText,
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
      // Find the successor row in the chain (if it already exists) so items
      // are linked as its incoming items immediately. If the successor
      // shift hasn't opened its task yet, they'll be linked later by
      // linkFromPredecessor() when that row is created.
      const successor = await nextInChain(updated.shiftId, updated.date);
      const successorRow = successor
        ? await findRow(updated.storeId, successor.shiftId, successor.date)
        : undefined;

      await db.insert(serahTerimaItems).values(
        messages.map((message) => ({
          taskId:         task!.id,
          receiverTaskId: successorRow?.id ?? null,
          storeId:        input.storeId,
          sourceUserId:   input.userId,
          targetShiftId:  successor?.shiftId ?? updated.shiftId,
          message,
          isCompleted:    false,
          createdAt:  now,
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

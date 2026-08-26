// lib/db/utils/serah-terima.ts
//
// Serah Terima is a shared, rolling handover board per store — NOT a
// per-shift, per-day row like briefing. Any shift can add an entry at any
// time; morning/evening/full_day all see the exact same active list for
// their store; any shift member can mark any entry complete. Entries stay
// in the active list (isCompleted = false) until completed — there is no
// daily reset and no "next shift" chain/targeting.
import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  attendance,
  serahTerimaEntries,
  stores,
  type SerahTerimaEntry,
} from '@/lib/db/schema';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CreateSerahTerimaEntryInput {
  storeId: number;
  scheduleId: number;
  userId: string;
  shiftId: number;
  geo: GeoPoint;
  message: string;
  skipGeo?: boolean;
}

export interface CompleteSerahTerimaEntryInput {
  entryId: number;
  storeId: number;
  scheduleId: number;
  userId: string;
  shiftId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
}

const DEFAULT_GEOFENCE_RADIUS_M = 100;
const RECENT_COMPLETED_LIMIT = 20;

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

export interface SerahTerimaBoard {
  active: SerahTerimaEntry[];
  recentCompleted: SerahTerimaEntry[];
}

export async function listSerahTerimaEntries(storeId: number): Promise<SerahTerimaBoard> {
  const [active, recentCompleted] = await Promise.all([
    db
      .select()
      .from(serahTerimaEntries)
      .where(and(
        eq(serahTerimaEntries.storeId, storeId),
        eq(serahTerimaEntries.isCompleted, false),
      ))
      .orderBy(asc(serahTerimaEntries.createdAt)),

    db
      .select()
      .from(serahTerimaEntries)
      .where(and(
        eq(serahTerimaEntries.storeId, storeId),
        eq(serahTerimaEntries.isCompleted, true),
      ))
      .orderBy(desc(serahTerimaEntries.completedAt))
      .limit(RECENT_COMPLETED_LIMIT),
  ]);

  return { active, recentCompleted };
}

export async function createSerahTerimaEntry(
  input: CreateSerahTerimaEntryInput,
): Promise<TaskResult<SerahTerimaEntry>> {
  try {
    const message = input.message.trim();
    if (!message) {
      return { success: false, error: 'Pesan handover tidak boleh kosong.' };
    }

    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );
    if (gateErr) return { success: false, error: gateErr };

    const now = new Date();

    const [entry] = await db
      .insert(serahTerimaEntries)
      .values({
        storeId: input.storeId,
        message,
        createdByUserId: input.userId,
        createdByScheduleId: input.scheduleId,
        createdByShiftId: input.shiftId,
        submittedLat: input.skipGeo ? null : String(input.geo.lat),
        submittedLng: input.skipGeo ? null : String(input.geo.lng),
        isCompleted: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return { success: true, data: entry };
  } catch (err) {
    return { success: false, error: `createSerahTerimaEntry: ${err}` };
  }
}

export async function deleteSerahTerimaEntry(
  entryId: number,
  storeId: number,
): Promise<TaskResult<void>> {
  try {
    const [existing] = await db
      .select({ id: serahTerimaEntries.id, storeId: serahTerimaEntries.storeId, isCompleted: serahTerimaEntries.isCompleted })
      .from(serahTerimaEntries)
      .where(eq(serahTerimaEntries.id, entryId))
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Item serah terima tidak ditemukan.' };
    }
    if (existing.storeId !== storeId) {
      return { success: false, error: 'Item serah terima bukan milik toko ini.' };
    }
    // Only completed (history) entries can be deleted — active items are
    // still outstanding work and must be completed, not discarded.
    if (!existing.isCompleted) {
      return { success: false, error: 'Hanya item yang sudah selesai yang bisa dihapus.' };
    }

    await db.delete(serahTerimaEntries).where(eq(serahTerimaEntries.id, entryId));

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `deleteSerahTerimaEntry: ${err}` };
  }
}

export async function completeSerahTerimaEntry(
  input: CompleteSerahTerimaEntryInput,
): Promise<TaskResult<SerahTerimaEntry>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );
    if (gateErr) return { success: false, error: gateErr };

    const [existing] = await db
      .select()
      .from(serahTerimaEntries)
      .where(eq(serahTerimaEntries.id, input.entryId))
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Item serah terima tidak ditemukan.' };
    }

    if (existing.storeId !== input.storeId) {
      return { success: false, error: 'Item serah terima bukan milik toko ini.' };
    }

    if (existing.isCompleted) {
      return { success: true, data: existing };
    }

    const now = new Date();

    const [entry] = await db
      .update(serahTerimaEntries)
      .set({
        isCompleted: true,
        completedByUserId: input.userId,
        completedByScheduleId: input.scheduleId,
        completedByShiftId: input.shiftId,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(serahTerimaEntries.id, input.entryId))
      .returning();

    return { success: true, data: entry };
  } catch (err) {
    return { success: false, error: `completeSerahTerimaEntry: ${err}` };
  }
}

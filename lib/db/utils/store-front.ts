// lib/db/utils/store-front.ts
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  attendance,
  storeFrontTasks,
  stores,
  type StoreFrontTask,
} from '@/lib/db/schema';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

// Photo rules:
//   storefrontPhotos     – min 1, max 3 (both staff visible in at least one shot)
//   rollingDoorClosed    – exactly 1 required (single photo)
export const STORE_FRONT_PHOTO_RULES = {
  storefront:        { min: 1, max: 3 },
  rollingDoorClosed: { min: 1, max: 1 },
} as const;

export interface SubmitStoreFrontInput {
  scheduleId:             number;
  userId:                 string;
  storeId:                number;
  geo:                    GeoPoint;
  storefrontPhotos:       string[];   // min 1, max 3 — photo(s) of both staff in front of store
  rollingDoorClosedPhoto: string;     // single required photo
  notes?:                 string;
  skipGeo?:               boolean;
}

export type AutoSaveStoreFrontInput = Partial<{
  storefrontPhotos:       string[];
  rollingDoorClosedPhoto: string;
  notes:                  string;
}>;

const DEFAULT_GEOFENCE_RADIUS_M = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date): Date   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180, Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function jsonPhotos(paths: string[] | undefined): string | null {
  return paths && paths.length > 0 ? JSON.stringify(paths) : null;
}

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
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
    .from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;
  const dist   = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;
  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

async function assertCanProgressTask(scheduleId: number, storeId: number, geo: GeoPoint, skipGeo?: boolean): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;
  if (!skipGeo) { const geoErr = await assertInGeofence(storeId, geo); if (geoErr) return geoErr; }
  return null;
}

// ─── Get or create ────────────────────────────────────────────────────────────

export async function getOrCreateStoreFrontForSchedule(
  scheduleId: number, userId: string, storeId: number, shiftId: number, date: Date,
): Promise<TaskResult<StoreFrontTask>> {
  try {
    const dayStart = startOfDay(date);
    const dayEnd   = endOfDay(date);
    const [existing] = await db.select().from(storeFrontTasks)
      .where(and(eq(storeFrontTasks.storeId, storeId), gte(storeFrontTasks.date, dayStart), lte(storeFrontTasks.date, dayEnd)))
      .limit(1);
    if (existing) return { success: true, data: existing };
    const [row] = await db.insert(storeFrontTasks).values({ scheduleId, userId, storeId, shiftId, date: dayStart, status: 'pending' }).returning();
    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `getOrCreateStoreFrontForSchedule: ${err}` };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getStoreFrontById(id: number): Promise<StoreFrontTask | null> {
  const [row] = await db.select().from(storeFrontTasks).where(eq(storeFrontTasks.id, id)).limit(1);
  return row ?? null;
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export async function autoSaveStoreFront(taskId: number, patch: AutoSaveStoreFrontInput): Promise<TaskResult<StoreFrontTask>> {
  try {
    const cleanPatch: Partial<typeof storeFrontTasks.$inferInsert> = { updatedAt: new Date() };

    if ('storefrontPhotos'       in patch) cleanPatch.storefrontPhotos       = jsonPhotos(patch.storefrontPhotos);
    if ('rollingDoorClosedPhoto' in patch) cleanPatch.rollingDoorClosedPhoto = patch.rollingDoorClosedPhoto ?? null;
    if ('notes'                  in patch) cleanPatch.notes                  = patch.notes ?? null;

    const [row] = await db.update(storeFrontTasks).set(cleanPatch).where(eq(storeFrontTasks.id, taskId)).returning();
    if (!row) return { success: false, error: 'Store Front task tidak ditemukan.' };
    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `autoSaveStoreFront: ${err}` };
  }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitStoreFront(input: SubmitStoreFrontInput): Promise<TaskResult<StoreFrontTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const sfCount = input.storefrontPhotos?.length ?? 0;
    if (sfCount < STORE_FRONT_PHOTO_RULES.storefront.min)
      return { success: false, error: `Wajib upload minimal ${STORE_FRONT_PHOTO_RULES.storefront.min} foto storefront dengan 2 karyawan.` };
    if (sfCount > STORE_FRONT_PHOTO_RULES.storefront.max)
      return { success: false, error: `Maksimal ${STORE_FRONT_PHOTO_RULES.storefront.max} foto storefront.` };

    if (!input.rollingDoorClosedPhoto)
      return { success: false, error: 'Foto rolling door tertutup wajib diupload.' };

    const [existing] = await db.select().from(storeFrontTasks)
      .where(eq(storeFrontTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified')
      return { success: false, error: 'Store Front task sudah diverifikasi.' };

    const now = new Date();
    const values = {
      scheduleId:             input.scheduleId,
      userId:                 input.userId,
      storeId:                input.storeId,
      shiftId:                existing?.shiftId ?? 1,
      date:                   existing?.date ?? startOfDay(now),
      storefrontPhotos:       jsonPhotos(input.storefrontPhotos),
      rollingDoorClosedPhoto: input.rollingDoorClosedPhoto,
      submittedLat:           String(input.geo.lat),
      submittedLng:           String(input.geo.lng),
      notes:                  input.notes ?? null,
      status:                 'completed' as const,
      completedAt:            now,
      updatedAt:              now,
    };

    const [row] = existing
      ? await db.update(storeFrontTasks).set(values).where(eq(storeFrontTasks.id, existing.id)).returning()
      : await db.insert(storeFrontTasks).values(values).returning();

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitStoreFront: ${err}` };
  }
}

// ─── Helper: parse storefront photos for API response ─────────────────────────

export function parseStoreFrontPhotos(raw: string | null | undefined): string[] {
  return parsePhotos(raw);
}
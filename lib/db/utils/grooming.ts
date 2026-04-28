// lib/db/utils/grooming.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated utilities for the Grooming task.
//
// Grooming is a PERSONAL task — one row per (scheduleId). Each employee must
// submit their own grooming check independently, even if multiple employees
// are on the same shift at the same store.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  groomingTasks, stores, shifts, attendance, schedules,
  type GroomingTask,
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

export interface SubmitGroomingInput {
  scheduleId:         number;
  userId:             string;
  storeId:            number;
  geo:                GeoPoint;
  
  // ── Active toggles (dictate which items are required) ──────────────────────
  uniformActive?:     boolean;
  hairActive?:        boolean;
  nailsActive?:       boolean;
  accessoriesActive?: boolean;
  shoeActive?:        boolean;
  
  // ── Compliance answers ─────────────────────────────────────────────────────
  uniformComplete?:      boolean;
  hairGroomed?:          boolean;
  nailsClean?:           boolean;
  accessoriesCompliant?: boolean;
  shoeCompliant?:        boolean;
  
  // ── Photos ─────────────────────────────────────────────────────────────────
  selfiePhotos?: string[];
  
  notes?:   string;
  skipGeo?: boolean;
}

// ─── Photo rules (single source of truth) ─────────────────────────────────────

export const GROOMING_PHOTO_RULES = {
  selfie: { min: 1, max: 3 },
} as const;

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
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

// ─── Checklist + photo validation ─────────────────────────────────────────────

function validateGroomingPayload(input: SubmitGroomingInput): string | null {
  const {
    uniformActive, hairActive, nailsActive, accessoriesActive, shoeActive,
    uniformComplete, hairGroomed, nailsClean, accessoriesCompliant, shoeCompliant,
    selfiePhotos,
  } = input;

  if (uniformActive && !uniformComplete)      return 'Checklist "Seragam Lengkap" belum ditandai.';
  if (hairActive && !hairGroomed)             return 'Checklist "Rambut Rapih" belum ditandai.';
  if (nailsActive && !nailsClean)             return 'Checklist "Kuku Bersih" belum ditandai.';
  if (accessoriesActive && !accessoriesCompliant) return 'Checklist "Aksesoris Sesuai" belum ditandai.';
  if (shoeActive && !shoeCompliant)           return 'Checklist "Sepatu Sesuai" belum ditandai.';

  const selfieCount = selfiePhotos?.length ?? 0;
  if (selfieCount < GROOMING_PHOTO_RULES.selfie.min)
    return `Foto selfie wajib minimal ${GROOMING_PHOTO_RULES.selfie.min}.`;
  if (selfieCount > GROOMING_PHOTO_RULES.selfie.max)
    return `Foto selfie maksimal ${GROOMING_PHOTO_RULES.selfie.max}.`;

  return null;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitGrooming(
  input: SubmitGroomingInput,
): Promise<TaskResult<GroomingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateGroomingPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const [existing] = await db
      .select()
      .from(groomingTasks)
      .where(eq(groomingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'completed' || existing?.status === 'verified')
      return { success: false, error: 'Task grooming sudah disubmit.' };

    const [schedule] = await db
      .select({ shiftId: schedules.shiftId })
      .from(schedules)
      .where(eq(schedules.id, input.scheduleId))
      .limit(1);

    if (!schedule) return { success: false, error: 'Jadwal tidak ditemukan.' };

    const now = new Date();

    const values = {
      scheduleId:         input.scheduleId,
      userId:             input.userId,
      storeId:            input.storeId,
      shiftId:            schedule.shiftId,
      date:               startOfDay(now),
      
      uniformActive:      input.uniformActive ?? true,
      hairActive:         input.hairActive ?? true,
      nailsActive:        input.nailsActive ?? true,
      accessoriesActive:  input.accessoriesActive ?? true,
      shoeActive:         input.shoeActive ?? true,
      
      uniformComplete:      input.uniformComplete ?? false,
      hairGroomed:          input.hairGroomed ?? false,
      nailsClean:           input.nailsClean ?? false,
      accessoriesCompliant: input.accessoriesCompliant ?? false,
      shoeCompliant:        input.shoeCompliant ?? false,
      
      selfiePhotos: jsonPhotos(input.selfiePhotos),
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      
      notes:       input.notes,
      status:      'completed' as const,
      completedAt: now,
      updatedAt:   now,
    };

    const row = existing
      ? (await db.update(groomingTasks).set(values).where(eq(groomingTasks.id, existing.id)).returning())[0]
      : (await db.insert(groomingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitGrooming: ${err}` };
  }
}

// ─── Auto-save patch ──────────────────────────────────────────────────────────

export interface GroomingAutoSavePatch {
  uniformActive?:      boolean;
  uniformComplete?:    boolean;
  hairActive?:         boolean;
  hairGroomed?:        boolean;
  nailsActive?:        boolean;
  nailsClean?:         boolean;
  accessoriesActive?:  boolean;
  accessoriesCompliant?: boolean;
  shoeActive?:         boolean;
  shoeCompliant?:      boolean;
  selfiePhotos?:       string[];
  notes?:              string;
}

export async function autoSaveGrooming(
  scheduleId: number,
  patch:      GroomingAutoSavePatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: groomingTasks.id, status: groomingTasks.status })
      .from(groomingTasks)
      .where(eq(groomingTasks.scheduleId, scheduleId))
      .limit(1);

    if (!existing) return { success: false, error: 'Grooming task not found.' };
    if (existing.status === 'completed' || existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('uniformActive'      in patch) update.uniformActive      = Boolean(patch.uniformActive);
    if ('hairActive'         in patch) update.hairActive         = Boolean(patch.hairActive);
    if ('nailsActive'        in patch) update.nailsActive        = Boolean(patch.nailsActive);
    if ('accessoriesActive'  in patch) update.accessoriesActive  = Boolean(patch.accessoriesActive);
    if ('shoeActive'         in patch) update.shoeActive         = Boolean(patch.shoeActive);

    if ('uniformComplete'      in patch) update.uniformComplete      = Boolean(patch.uniformComplete);
    if ('hairGroomed'          in patch) update.hairGroomed          = Boolean(patch.hairGroomed);
    if ('nailsClean'           in patch) update.nailsClean           = Boolean(patch.nailsClean);
    if ('accessoriesCompliant' in patch) update.accessoriesCompliant = Boolean(patch.accessoriesCompliant);
    if ('shoeCompliant'        in patch) update.shoeCompliant        = Boolean(patch.shoeCompliant);

    if ('notes'        in patch) update.notes        = patch.notes;
    if ('selfiePhotos' in patch) update.selfiePhotos = jsonPhotos(patch.selfiePhotos);

    if (existing.status === 'pending') update.status = 'in_progress';

    await db
      .update(groomingTasks)
      .set(update)
      .where(eq(groomingTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveGrooming: ${err}` };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getGroomingBySchedule(scheduleId: number): Promise<GroomingTask | null> {
  const [row] = await db
    .select()
    .from(groomingTasks)
    .where(eq(groomingTasks.scheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

export async function getGroomingById(id: number): Promise<GroomingTask | null> {
  const [row] = await db
    .select()
    .from(groomingTasks)
    .where(eq(groomingTasks.id, id))
    .limit(1);
  return row ?? null;
}

// ─── Materializer ─────────────────────────────────────────────────────────────
// Called by GET /api/employee/tasks to ensure a grooming row exists for any
// shift type (morning, evening, full_day).

export async function getOrCreateGroomingForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<{ id: number; created: boolean }> {
  const [existing] = await db
    .select({ id: groomingTasks.id })
    .from(groomingTasks)
    .where(eq(groomingTasks.scheduleId, scheduleId))
    .limit(1);

  if (existing) return { id: existing.id, created: false };

  const [created] = await db
    .insert(groomingTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId,
      date: startOfDay(date),
    })
    .returning({ id: groomingTasks.id });

  return { id: created.id, created: true };
}
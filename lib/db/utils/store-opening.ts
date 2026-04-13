// lib/db/utils/store-opening.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated utilities for the Store Opening task.
//
// Store Opening is a SHARED morning task — one row per (storeId, date).
// Any employee scheduled on the morning or full_day shift for that store can
// continue filling out the same task row (auto-save + submit).
//
// Checklist → photo linkage (enforced at submit time):
//   • loginPos        → min 1 cashier desk photo (reuses cash_drawer_photos)
//   • fiveR           → min 3 photos (reuses five_r_photos)
//   • cekPromo        → exactly 1 storefront promo photo + 1 desk promo photo
//   • (always)        → min 1 store front photo
//
// Access rules (same as other tasks):
//   • Employee must be checked in (attendance row for this schedule).
//   • Employee must be inside the store's geofence (unless skipGeo).
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  storeOpeningTasks, stores, shifts, attendance,
  type StoreOpeningTask,
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

export interface SubmitStoreOpeningInput {
  scheduleId:        number;
  userId:            string;
  storeId:           number;
  geo:               GeoPoint;
  loginPos:          boolean;
  checkAbsenSunfish: boolean;
  tarikSohSales:     boolean;
  fiveR:             boolean;
  fiveRPhotos?:      string[];
  cekPromo:          boolean;
  cekPromoStorefrontPhotos?: string[];
  cekPromoDeskPhotos?:       string[];
  cekLamp:           boolean;
  cekSoundSystem:    boolean;
  storeFrontPhotos?: string[];
  /** Cashier desk photos — stored in cash_drawer_photos column (repurposed). */
  cashierDeskPhotos?: string[];
  notes?:            string;
  skipGeo?:          boolean;
}

// ─── Photo rules (single source of truth) ─────────────────────────────────────

export const STORE_OPENING_PHOTO_RULES = {
  storeFront:        { min: 1, max: 3 },
  cashierDesk:       { min: 1, max: 2 }, // required when loginPos is checked
  fiveR:             { min: 3, max: 5 }, // required when fiveR is checked
  cekPromoStorefront:{ min: 1, max: 1 }, // required when cekPromo is checked
  cekPromoDesk:      { min: 1, max: 1 }, // required when cekPromo is checked
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

let _morningShiftIdCache: number | null = null;
async function getMorningShiftId(): Promise<number> {
  if (_morningShiftIdCache != null) return _morningShiftIdCache;
  const [row] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, 'morning')).limit(1);
  if (!row) throw new Error('Morning shift not found in shifts table.');
  _morningShiftIdCache = row.id;
  return row.id;
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

function validateStoreOpeningPayload(input: SubmitStoreOpeningInput): string | null {
  const {
    loginPos, checkAbsenSunfish, tarikSohSales, fiveR, cekPromo, cekLamp, cekSoundSystem,
    storeFrontPhotos, cashierDeskPhotos, fiveRPhotos,
    cekPromoStorefrontPhotos, cekPromoDeskPhotos,
  } = input;

  // All checklist items must be marked true
  if (!loginPos)          return 'Checklist "Log-in POS / Buka komputer kasir" belum ditandai.';
  if (!checkAbsenSunfish) return 'Checklist "Tarik & cek absen Sunfish" belum ditandai.';
  if (!tarikSohSales)     return 'Checklist "Tarik SOH & Sales" belum ditandai.';
  if (!fiveR)             return 'Checklist "5R" belum ditandai.';
  if (!cekPromo)          return 'Checklist "Cek Promo" belum ditandai.';
  if (!cekLamp)           return 'Checklist "Cek Lampu" belum ditandai.';
  if (!cekSoundSystem)    return 'Checklist "Cek Sound System" belum ditandai.';

  // Store front always required
  const sfCount = storeFrontPhotos?.length ?? 0;
  if (sfCount < STORE_OPENING_PHOTO_RULES.storeFront.min)
    return `Foto tampak depan toko wajib minimal ${STORE_OPENING_PHOTO_RULES.storeFront.min}.`;
  if (sfCount > STORE_OPENING_PHOTO_RULES.storeFront.max)
    return `Foto tampak depan toko maksimal ${STORE_OPENING_PHOTO_RULES.storeFront.max}.`;

  // Cashier desk — required because loginPos must be true
  const cdCount = cashierDeskPhotos?.length ?? 0;
  if (cdCount < STORE_OPENING_PHOTO_RULES.cashierDesk.min)
    return `Foto meja kasir wajib minimal ${STORE_OPENING_PHOTO_RULES.cashierDesk.min} (terkait "Log-in POS").`;
  if (cdCount > STORE_OPENING_PHOTO_RULES.cashierDesk.max)
    return `Foto meja kasir maksimal ${STORE_OPENING_PHOTO_RULES.cashierDesk.max}.`;

  // 5R — required because fiveR must be true
  const frCount = fiveRPhotos?.length ?? 0;
  if (frCount < STORE_OPENING_PHOTO_RULES.fiveR.min)
    return `Foto 5R wajib minimal ${STORE_OPENING_PHOTO_RULES.fiveR.min} (terkait "5R Kebersihan toko").`;
  if (frCount > STORE_OPENING_PHOTO_RULES.fiveR.max)
    return `Foto 5R maksimal ${STORE_OPENING_PHOTO_RULES.fiveR.max}.`;

  // Cek Promo — both buckets required because cekPromo must be true
  const promoSfCount = cekPromoStorefrontPhotos?.length ?? 0;
  if (promoSfCount < STORE_OPENING_PHOTO_RULES.cekPromoStorefront.min)
    return `Foto promo depan toko wajib ${STORE_OPENING_PHOTO_RULES.cekPromoStorefront.min} (terkait "Cek Promo").`;
  if (promoSfCount > STORE_OPENING_PHOTO_RULES.cekPromoStorefront.max)
    return `Foto promo depan toko maksimal ${STORE_OPENING_PHOTO_RULES.cekPromoStorefront.max}.`;

  const promoDeskCount = cekPromoDeskPhotos?.length ?? 0;
  if (promoDeskCount < STORE_OPENING_PHOTO_RULES.cekPromoDesk.min)
    return `Foto promo meja kasir wajib ${STORE_OPENING_PHOTO_RULES.cekPromoDesk.min} (terkait "Cek Promo").`;
  if (promoDeskCount > STORE_OPENING_PHOTO_RULES.cekPromoDesk.max)
    return `Foto promo meja kasir maksimal ${STORE_OPENING_PHOTO_RULES.cekPromoDesk.max}.`;

  return null;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitStoreOpening(
  input: SubmitStoreOpeningInput,
): Promise<TaskResult<StoreOpeningTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateStoreOpeningPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const [existing] = await db
      .select()
      .from(storeOpeningTasks)
      .where(eq(storeOpeningTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'completed' || existing?.status === 'verified')
      return { success: false, error: 'Store opening task sudah disubmit.' };

    const morningShiftId = await getMorningShiftId();
    const now            = new Date();

    const values = {
      scheduleId:        input.scheduleId,
      userId:            input.userId,
      storeId:           input.storeId,
      shiftId:           morningShiftId,
      date:              startOfDay(now),
      loginPos:          input.loginPos,
      checkAbsenSunfish: input.checkAbsenSunfish,
      tarikSohSales:     input.tarikSohSales,
      fiveR:             input.fiveR,
      fiveRPhotos:       jsonPhotos(input.fiveRPhotos),
      cekPromo:          input.cekPromo,
      cekPromoStorefrontPhotos: jsonPhotos(input.cekPromoStorefrontPhotos),
      cekPromoDeskPhotos:       jsonPhotos(input.cekPromoDeskPhotos),
      cekLamp:           input.cekLamp,
      cekSoundSystem:    input.cekSoundSystem,
      storeFrontPhotos:  jsonPhotos(input.storeFrontPhotos),
      // Cashier desk photos are stored in the cash_drawer_photos column (repurposed).
      cashDrawerPhotos:  jsonPhotos(input.cashierDeskPhotos),
      submittedLat:      String(input.geo.lat),
      submittedLng:      String(input.geo.lng),
      notes:             input.notes,
      status:            'completed' as const,
      completedAt:       now,
      updatedAt:         now,
    };

    const row = existing
      ? (await db.update(storeOpeningTasks).set(values).where(eq(storeOpeningTasks.id, existing.id)).returning())[0]
      : (await db.insert(storeOpeningTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitStoreOpening: ${err}` };
  }
}

// ─── Auto-save patch ──────────────────────────────────────────────────────────

export interface StoreOpeningAutoSavePatch {
  loginPos?:          boolean;
  checkAbsenSunfish?: boolean;
  tarikSohSales?:     boolean;
  fiveR?:             boolean;
  cekPromo?:          boolean;
  cekLamp?:           boolean;
  cekSoundSystem?:    boolean;
  storeFrontPhotos?:  string[];
  cashierDeskPhotos?: string[];
  fiveRPhotos?:       string[];
  cekPromoStorefrontPhotos?: string[];
  cekPromoDeskPhotos?:       string[];
  notes?:             string;
}

export async function autoSaveStoreOpening(
  scheduleId: number,
  patch:      StoreOpeningAutoSavePatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: storeOpeningTasks.id, status: storeOpeningTasks.status })
      .from(storeOpeningTasks)
      .where(eq(storeOpeningTasks.scheduleId, scheduleId))
      .limit(1);

    if (!existing) return { success: false, error: 'Store opening task not found.' };
    if (existing.status === 'completed' || existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('loginPos'          in patch) update.loginPos          = Boolean(patch.loginPos);
    if ('checkAbsenSunfish' in patch) update.checkAbsenSunfish = Boolean(patch.checkAbsenSunfish);
    if ('tarikSohSales'     in patch) update.tarikSohSales     = Boolean(patch.tarikSohSales);
    if ('fiveR'             in patch) update.fiveR             = Boolean(patch.fiveR);
    if ('cekPromo'          in patch) update.cekPromo          = Boolean(patch.cekPromo);
    if ('cekLamp'           in patch) update.cekLamp           = Boolean(patch.cekLamp);
    if ('cekSoundSystem'    in patch) update.cekSoundSystem    = Boolean(patch.cekSoundSystem);
    if ('notes'             in patch) update.notes             = patch.notes;

    if ('storeFrontPhotos'         in patch) update.storeFrontPhotos         = jsonPhotos(patch.storeFrontPhotos);
    if ('cashierDeskPhotos'        in patch) update.cashDrawerPhotos         = jsonPhotos(patch.cashierDeskPhotos);
    if ('fiveRPhotos'              in patch) update.fiveRPhotos              = jsonPhotos(patch.fiveRPhotos);
    if ('cekPromoStorefrontPhotos' in patch) update.cekPromoStorefrontPhotos = jsonPhotos(patch.cekPromoStorefrontPhotos);
    if ('cekPromoDeskPhotos'       in patch) update.cekPromoDeskPhotos       = jsonPhotos(patch.cekPromoDeskPhotos);

    if (existing.status === 'pending') update.status = 'in_progress';

    await db
      .update(storeOpeningTasks)
      .set(update)
      .where(eq(storeOpeningTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveStoreOpening: ${err}` };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getStoreOpeningBySchedule(scheduleId: number): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.scheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

export async function getStoreOpeningById(id: number): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.id, id))
    .limit(1);
  return row ?? null;
}
// lib/db/utils/store-opening.ts
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  storeOpeningTasks, stores, shifts, attendance,
  type StoreOpeningTask,
} from '@/lib/db/schema';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

// ─── 5R area keys ─────────────────────────────────────────────────────────────

export const FIVE_R_AREAS = [
  { key: 'kasir',  label: 'Area Kasir'  },
  { key: 'depan',  label: 'Depan Toko'  },
  { key: 'kanan',  label: 'Sisi Kanan'  },
  { key: 'kiri',   label: 'Sisi Kiri'   },
  { key: 'gudang', label: 'Gudang'      },
] as const;

export type FiveRAreaKey = typeof FIVE_R_AREAS[number]['key'];

export interface SubmitStoreOpeningInput {
  scheduleId:        number;
  userId:            string;
  storeId:           number;
  geo:               GeoPoint;
  loginPos:          boolean;
  checkAbsenSunfish: boolean;
  tarikSohSales:     boolean;
  fiveR:             boolean;
  // Per-area 5R photos — each area: min 1, max 2
  fiveRAreaKasirPhotos?:  string[];
  fiveRAreaDepanPhotos?:  string[];
  fiveRAreaKananPhotos?:  string[];
  fiveRAreaKiriPhotos?:   string[];
  fiveRAreaGudangPhotos?: string[];
  cekLamp:           boolean;
  cekSoundSystem:    boolean;
  storeFrontPhotos?: string[];
  cashierDeskPhotos?: string[];
  notes?:            string;
  skipGeo?:          boolean;
}

export const STORE_OPENING_PHOTO_RULES = {
  storeFront:  { min: 1, max: 3 },
  cashierDesk: { min: 1, max: 2 },
  // Each 5R area
  fiveRArea:   { min: 1, max: 2 },
} as const;

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
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

async function findTodayRow(storeId: number, date: Date): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(and(
      eq(storeOpeningTasks.storeId, storeId),
      gte(storeOpeningTasks.date, startOfDay(date)),
      lte(storeOpeningTasks.date, endOfDay(date)),
    ))
    .limit(1);
  return row ?? null;
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

// ─── Validation ───────────────────────────────────────────────────────────────

function validateStoreOpeningPayload(input: SubmitStoreOpeningInput): string | null {
  const {
    loginPos, checkAbsenSunfish, tarikSohSales, fiveR, cekLamp, cekSoundSystem,
    storeFrontPhotos, cashierDeskPhotos,
    fiveRAreaKasirPhotos, fiveRAreaDepanPhotos, fiveRAreaKananPhotos,
    fiveRAreaKiriPhotos, fiveRAreaGudangPhotos,
  } = input;

  if (!loginPos)          return 'Checklist "Log-in POS / Buka komputer kasir" belum ditandai.';
  if (!checkAbsenSunfish) return 'Checklist "Tarik & cek absen Sunfish" belum ditandai.';
  if (!tarikSohSales)     return 'Checklist "Tarik SOH & Sales" belum ditandai.';
  if (!fiveR)             return 'Checklist "5R" belum ditandai.';
  if (!cekLamp)           return 'Checklist "Cek Lampu" belum ditandai.';
  if (!cekSoundSystem)    return 'Checklist "Cek Sound System" belum ditandai.';

  // Store front photos
  const sfCount = storeFrontPhotos?.length ?? 0;
  if (sfCount < STORE_OPENING_PHOTO_RULES.storeFront.min)
    return `Foto tampak depan toko wajib minimal ${STORE_OPENING_PHOTO_RULES.storeFront.min}.`;
  if (sfCount > STORE_OPENING_PHOTO_RULES.storeFront.max)
    return `Foto tampak depan toko maksimal ${STORE_OPENING_PHOTO_RULES.storeFront.max}.`;

  // Cashier desk photos (linked to loginPos)
  const cdCount = cashierDeskPhotos?.length ?? 0;
  if (cdCount < STORE_OPENING_PHOTO_RULES.cashierDesk.min)
    return `Foto meja kasir wajib minimal ${STORE_OPENING_PHOTO_RULES.cashierDesk.min} (terkait "Log-in POS").`;
  if (cdCount > STORE_OPENING_PHOTO_RULES.cashierDesk.max)
    return `Foto meja kasir maksimal ${STORE_OPENING_PHOTO_RULES.cashierDesk.max}.`;

  // 5R — one validation message per area
  const areaPhotoMap: Record<FiveRAreaKey, string[] | undefined> = {
    kasir:  fiveRAreaKasirPhotos,
    depan:  fiveRAreaDepanPhotos,
    kanan:  fiveRAreaKananPhotos,
    kiri:   fiveRAreaKiriPhotos,
    gudang: fiveRAreaGudangPhotos,
  };
  for (const { key, label } of FIVE_R_AREAS) {
    const count = areaPhotoMap[key]?.length ?? 0;
    if (count < STORE_OPENING_PHOTO_RULES.fiveRArea.min)
      return `5R "${label}": wajib minimal ${STORE_OPENING_PHOTO_RULES.fiveRArea.min} foto.`;
    if (count > STORE_OPENING_PHOTO_RULES.fiveRArea.max)
      return `5R "${label}": maksimal ${STORE_OPENING_PHOTO_RULES.fiveRArea.max} foto.`;
  }

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

    const now      = new Date();
    const existing = await findTodayRow(input.storeId, now);

    if (existing?.status === 'completed' || existing?.status === 'verified')
      return { success: false, error: 'Store opening task sudah disubmit.' };

    const morningShiftId = await getMorningShiftId();

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
      // 5R per-area photos
      fiveRAreaKasirPhotos:  jsonPhotos(input.fiveRAreaKasirPhotos),
      fiveRAreaDepanPhotos:  jsonPhotos(input.fiveRAreaDepanPhotos),
      fiveRAreaKananPhotos:  jsonPhotos(input.fiveRAreaKananPhotos),
      fiveRAreaKiriPhotos:   jsonPhotos(input.fiveRAreaKiriPhotos),
      fiveRAreaGudangPhotos: jsonPhotos(input.fiveRAreaGudangPhotos),
      cekLamp:           input.cekLamp,
      cekSoundSystem:    input.cekSoundSystem,
      storeFrontPhotos:  jsonPhotos(input.storeFrontPhotos),
      cashDrawerPhotos:  jsonPhotos(input.cashierDeskPhotos),
      submittedLat:      String(input.geo.lat),
      submittedLng:      String(input.geo.lng),
      notes:             input.notes,
      status:            'completed' as const,
      completedAt:       now,
      updatedAt:         now,
    };

    const row = existing
      ? (await db.update(storeOpeningTasks).set(values)
          .where(eq(storeOpeningTasks.id, existing.id)).returning())[0]
      : (await db.insert(storeOpeningTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitStoreOpening: ${err}` };
  }
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export interface StoreOpeningAutoSavePatch {
  loginPos?:          boolean;
  checkAbsenSunfish?: boolean;
  tarikSohSales?:     boolean;
  fiveR?:             boolean;
  // Per-area 5R photos
  fiveRAreaKasirPhotos?:  string[];
  fiveRAreaDepanPhotos?:  string[];
  fiveRAreaKananPhotos?:  string[];
  fiveRAreaKiriPhotos?:   string[];
  fiveRAreaGudangPhotos?: string[];
  cekLamp?:           boolean;
  cekSoundSystem?:    boolean;
  storeFrontPhotos?:  string[];
  cashierDeskPhotos?: string[];
  notes?:             string;
}

export async function autoSaveStoreOpening(
  storeId: number,
  patch:   StoreOpeningAutoSavePatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const existing = await findTodayRow(storeId, new Date());
    if (!existing) return { success: false, error: 'Store opening task not found.' };
    if (existing.status === 'completed' || existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('loginPos'          in patch) update.loginPos          = Boolean(patch.loginPos);
    if ('checkAbsenSunfish' in patch) update.checkAbsenSunfish = Boolean(patch.checkAbsenSunfish);
    if ('tarikSohSales'     in patch) update.tarikSohSales     = Boolean(patch.tarikSohSales);
    if ('fiveR'             in patch) update.fiveR             = Boolean(patch.fiveR);
    if ('cekLamp'           in patch) update.cekLamp           = Boolean(patch.cekLamp);
    if ('cekSoundSystem'    in patch) update.cekSoundSystem    = Boolean(patch.cekSoundSystem);
    if ('notes'             in patch) update.notes             = patch.notes;

    // Photo columns
    if ('storeFrontPhotos'         in patch) update.storeFrontPhotos        = jsonPhotos(patch.storeFrontPhotos);
    if ('cashierDeskPhotos'        in patch) update.cashDrawerPhotos        = jsonPhotos(patch.cashierDeskPhotos);
    if ('fiveRAreaKasirPhotos'     in patch) update.fiveRAreaKasirPhotos    = jsonPhotos(patch.fiveRAreaKasirPhotos);
    if ('fiveRAreaDepanPhotos'     in patch) update.fiveRAreaDepanPhotos    = jsonPhotos(patch.fiveRAreaDepanPhotos);
    if ('fiveRAreaKananPhotos'     in patch) update.fiveRAreaKananPhotos    = jsonPhotos(patch.fiveRAreaKananPhotos);
    if ('fiveRAreaKiriPhotos'      in patch) update.fiveRAreaKiriPhotos     = jsonPhotos(patch.fiveRAreaKiriPhotos);
    if ('fiveRAreaGudangPhotos'    in patch) update.fiveRAreaGudangPhotos   = jsonPhotos(patch.fiveRAreaGudangPhotos);

    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(storeOpeningTasks).set(update).where(eq(storeOpeningTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveStoreOpening: ${err}` };
  }
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getStoreOpeningByStoreDate(
  storeId: number,
  date:    Date,
): Promise<StoreOpeningTask | null> {
  return findTodayRow(storeId, date);
}

export async function getStoreOpeningBySchedule(scheduleId: number): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.scheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

export async function getOrCreateStoreOpeningForSchedule(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  date:       Date,
): Promise<StoreOpeningTask> {
  const existing = await findTodayRow(storeId, date);
  if (existing) return existing;

  const morningShiftId = await getMorningShiftId();
  const [row] = await db
    .insert(storeOpeningTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId:   morningShiftId,
      date:      startOfDay(date),
      status:    'pending',
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  return row ?? (await findTodayRow(storeId, date))!;
}

export async function getStoreOpeningById(id: number): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.id, id))
    .limit(1);
  return row ?? null;
}
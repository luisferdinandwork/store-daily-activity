// lib/db/utils/eod-z-report.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated utilities for the EOD Z-Report task.
//
// EOD Z-Report is a SHARED evening task. The employee prints the local POS
// Z-Report receipt, photographs it, and enters the total nominal. This is the
// SOURCE OF TRUTH for the downstream EDC Reconciliation and Open Statement
// tasks — it is NOT discrepancy-capable.
//
// Access rules:
//   • Employee must be checked in.
//   • Employee must be inside the store geofence (unless skipGeo).
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  eodZReportTasks, stores, shifts, attendance,
  type EodZReportTask,
} from '@/lib/db/schema';

// ─── Public types ─────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint { lat: number; lng: number; }

export const EOD_Z_REPORT_PHOTO_RULES = {
  zReport: { min: 1, max: 3 },
} as const;

export interface SubmitEodZReportInput {
  scheduleId:    number;
  userId:        string;
  storeId:       number;
  geo:           GeoPoint;
  totalNominal:  string;      // numeric string (decimal)
  zReportPhotos: string[];    // min 1
  notes?:        string;
  skipGeo?:      boolean;
}

export interface AutoSaveEodZReportPatch {
  totalNominal?:  string;
  zReportPhotos?: string[];
  notes?:         string;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }

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

let _eveningShiftIdCache: number | null = null;
async function getEveningShiftId(): Promise<number> {
  if (_eveningShiftIdCache != null) return _eveningShiftIdCache;
  const [row] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, 'evening')).limit(1);
  if (!row) throw new Error('Evening shift not found in shifts table.');
  _eveningShiftIdCache = row.id;
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
  scheduleId: number, storeId: number, geo: GeoPoint, skipGeo?: boolean,
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

function validatePayload(input: SubmitEodZReportInput): string | null {
  if (!input.totalNominal || !input.totalNominal.trim())
    return 'Total nominal Z-Report wajib diisi.';
  const n = Number(input.totalNominal);
  if (!isFinite(n) || n <= 0)
    return 'Total nominal harus angka positif.';

  const count = input.zReportPhotos?.length ?? 0;
  if (count < EOD_Z_REPORT_PHOTO_RULES.zReport.min)
    return `Foto Z-Report wajib minimal ${EOD_Z_REPORT_PHOTO_RULES.zReport.min}.`;
  if (count > EOD_Z_REPORT_PHOTO_RULES.zReport.max)
    return `Foto Z-Report maksimal ${EOD_Z_REPORT_PHOTO_RULES.zReport.max}.`;

  return null;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitEodZReport(
  input: SubmitEodZReportInput,
): Promise<TaskResult<EodZReportTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validatePayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const [existing] = await db
      .select()
      .from(eodZReportTasks)
      .where(eq(eodZReportTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'completed' || existing?.status === 'verified')
      return { success: false, error: 'EOD Z-Report sudah disubmit.' };

    const eveningShiftId = await getEveningShiftId();
    const now            = new Date();

    const values = {
      scheduleId:    input.scheduleId,
      userId:        input.userId,
      storeId:       input.storeId,
      shiftId:       eveningShiftId,
      date:          startOfDay(now),
      totalNominal:  input.totalNominal,
      zReportPhotos: jsonPhotos(input.zReportPhotos),
      submittedLat:  String(input.geo.lat),
      submittedLng:  String(input.geo.lng),
      notes:         input.notes,
      status:        'completed' as const,
      completedAt:   now,
      updatedAt:     now,
    };

    const row = existing
      ? (await db.update(eodZReportTasks).set(values).where(eq(eodZReportTasks.id, existing.id)).returning())[0]
      : (await db.insert(eodZReportTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitEodZReport: ${err}` };
  }
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export async function autoSaveEodZReport(
  scheduleId: number,
  patch:      AutoSaveEodZReportPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: eodZReportTasks.id, status: eodZReportTasks.status })
      .from(eodZReportTasks)
      .where(eq(eodZReportTasks.scheduleId, scheduleId))
      .limit(1);

    if (!existing) return { success: false, error: 'EOD Z-Report task not found.' };
    if (existing.status === 'completed' || existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('totalNominal'  in patch) update.totalNominal  = patch.totalNominal;
    if ('notes'         in patch) update.notes         = patch.notes;
    if ('zReportPhotos' in patch) update.zReportPhotos = jsonPhotos(patch.zReportPhotos);

    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(eodZReportTasks).set(update).where(eq(eodZReportTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveEodZReport: ${err}` };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getEodZReportBySchedule(scheduleId: number): Promise<EodZReportTask | null> {
  const [row] = await db
    .select()
    .from(eodZReportTasks)
    .where(eq(eodZReportTasks.scheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

export async function getEodZReportById(id: number): Promise<EodZReportTask | null> {
  const [row] = await db
    .select()
    .from(eodZReportTasks)
    .where(eq(eodZReportTasks.id, id))
    .limit(1);
  return row ?? null;
}
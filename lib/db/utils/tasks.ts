// lib/db/utils/tasks.ts
import { db }                               from '@/lib/db';
import { eq, and, gte, lte, inArray, sql }  from 'drizzle-orm';
import {
  schedules,
  stores,
  shifts,
  attendance,
  monthlySchedules,
  monthlyScheduleEntries,
  storeOpeningTasks,
  setoranTasks,
  cekBinTasks,
  productCheckTasks,
  receivingTasks,
  briefingTasks,
  edcSummaryTasks,
  edcSettlementTasks,
  eodZReportTasks,
  openStatementTasks,
  groomingTasks,
  type StoreOpeningTask,
  type SetoranTask,
  type ProductCheckTask,
  type ReceivingTask,
  type BriefingTask,
  type EdcSummaryTask,
  type EdcSettlementTask,
  type EodZReportTask,
  type OpenStatementTask,
  type GroomingTask,
} from '@/lib/db/schema';
import { canManageSchedule } from '@/lib/schedule-utils';
import { users, areas } from '@/lib/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

const PENDING_STATUSES = ['pending', 'in_progress'] as const;

// ─── Public types ─────────────────────────────────────────────────────────────

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Describes WHY a task is locked from the employee's perspective.
 * Used by the frontend to show the correct blocking UI.
 *
 *   'ok'           → employee may view AND interact with the task
 *   'not_checked_in' → employee has not checked in for their shift yet
 *   'outside_geofence' → employee is physically outside the store geofence
 *   'geo_unavailable'  → geolocation could not be obtained (treat as warning,
 *                         not a hard block — matches skipGeo behaviour)
 */
export type TaskAccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

export interface SubmitStoreOpeningInput {
  scheduleId:        number;
  userId:            string;
  storeId:           number;
  geo:               GeoPoint;
  loginPos:          boolean;
  checkAbsenSunfish: boolean;
  tarikSohSales:     boolean;
  fiveR:             boolean;
  cekLamp:           boolean;
  cekSoundSystem:    boolean;
  storeFrontPhotos?: string[];
  cashDrawerPhotos?: string[];
  notes?:            string;
  skipGeo?:          boolean;
}

export interface SubmitSetoranInput {
  scheduleId:  number;
  userId:      string;
  storeId:     number;
  geo:         GeoPoint;
  amount:      string;
  linkSetoran: string;
  moneyPhotos: string[];
  notes?:      string;
  skipGeo?:    boolean;
}

export interface SubmitProductCheckInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  display:    boolean;
  price:      boolean;
  saleTag:    boolean;
  shoeFiller: boolean;
  labelIndo:  boolean;
  barcode:    boolean;
  notes?:     string;
  skipGeo?:   boolean;
}

export interface SubmitReceivingInput {
  scheduleId:       number;
  userId:           string;
  storeId:          number;
  geo:              GeoPoint;
  hasReceiving:     boolean;
  receivingPhotos?: string[];
  notes?:           string;
  skipGeo?:         boolean;
}

export interface SubmitBriefingInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  done:       boolean;
  notes?:     string;
  skipGeo?:   boolean;
}

/** Used by: EDC Summary, EDC Settlement, EOD Z-Report, Open Statement */
export interface SubmitPhotoTaskInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  photos:     string[];
  notes?:     string;
  skipGeo?:   boolean;
}

export interface SubmitGroomingInput {
  scheduleId:            number;
  userId:                string;
  storeId:               number;
  geo:                   GeoPoint;
  uniformComplete?:      boolean;
  hairGroomed?:          boolean;
  nailsClean?:           boolean;
  accessoriesCompliant?: boolean;
  shoeCompliant?:        boolean;
  selfiePhotos:          string[];
  notes?:                string;
  skipGeo?:              boolean;
}

export interface VerifyTaskInput {
  taskId:  number;
  actorId: string;
  storeId: number;
  approve: boolean;
  notes?:  string;
}

export interface FlatTask {
  id:          number;
  type:        string;                    // 'store_opening' | 'setoran' | …
  scheduleId:  number;
  userId:      string;
  userName:    string | null;
  storeId:     number;
  shift:       'morning' | 'evening' | null;
  date:        string;                    // ISO
  status:      string | null;
  notes:       string | null;
  completedAt: string | null;
  verifiedBy:  string | null;
  verifiedAt:  string | null;
  extra:       Record<string, unknown>;
}

export interface StoreTaskSummary {
  pending:    number;
  inProgress: number;
  completed:  number;
  verified:   number;
  rejected:   number;
  total:      number;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

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
  const R  = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h  =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Cache shift IDs to avoid querying the DB repeatedly */
let shiftIdCache: Record<string, number> | null = null;
async function getShiftIdMap(): Promise<Record<string, number>> {
  if (shiftIdCache) return shiftIdCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  shiftIdCache = Object.fromEntries(rows.map(r => [r.code, r.id]));
  return shiftIdCache!;
}

// ─── Guard helpers ────────────────────────────────────────────────────────────

/**
 * Verify that the employee has checked in for this schedule.
 * Returns an error string if not, or null if OK.
 *
 * An attendance row must exist for the schedule AND have a non-null checkInTime.
 * A row with status 'absent' / 'excused' and no checkInTime counts as not checked in.
 */
async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime, status: attendance.status })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);

  if (!att) {
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  }
  if (!att.checkInTime) {
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  }
  return null;
}

/**
 * Verify the employee is within the store geofence.
 * Returns an error string (Indonesian) if outside, or null if OK.
 *
 * When the store has no coordinates configured this check is skipped (returns null).
 */
async function assertInGeofence(
  storeId: number,
  geo:     GeoPoint,
): Promise<string | null> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store)                   return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null; // coordinates not configured — skip

  const dist   = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

/**
 * Combined gate applied before ANY task can be progressed (auto-saved or submitted).
 *
 * Order:
 *   1. Check-in gate  — hard block, always enforced regardless of skipGeo
 *   2. Geofence gate  — enforced unless skipGeo === true
 *
 * Returns null when all checks pass, or an error string to surface to the caller.
 */
async function assertCanProgressTask(
  scheduleId: number,
  storeId:    number,
  geo:        GeoPoint,
  skipGeo?:   boolean,
): Promise<string | null> {
  // 1. Must be checked in — no skipGeo override for this gate
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;

  // 2. Must be within geofence (unless client explicitly skips — e.g. geo unavailable)
  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }

  return null;
}

/**
 * Public read helper — returns the access status for a task without mutating
 * anything. The frontend calls this to decide which blocking banner to show.
 *
 * Pass geo = null when the client could not obtain a position.
 */
export async function getTaskAccessStatus(
  scheduleId: number,
  storeId:    number,
  geo:        GeoPoint | null,
): Promise<TaskAccessStatus> {
  // 1. Check-in gate
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return { status: 'not_checked_in' };

  // 2. Geo unavailable → warn but don't hard-block (mirrors skipGeo submit behaviour)
  if (!geo) return { status: 'geo_unavailable' };

  // 3. Geofence gate
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (store?.lat && store?.lng) {
    const radiusM = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;
    const distM   = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
    if (distM > radiusM) return { status: 'outside_geofence', distanceM: Math.round(distM), radiusM };
  }

  return { status: 'ok' };
}

function jsonPhotos(paths: string[] | undefined): string | undefined {
  return paths && paths.length > 0 ? JSON.stringify(paths) : undefined;
}

/**
 * Shared verify logic expressed as callbacks so no table reference is passed
 * through a generic/union type parameter.
 */
type VerifyPatch = {
  status:     'verified' | 'rejected';
  verifiedBy: string;
  verifiedAt: Date;
  notes:      string | undefined;
  updatedAt:  Date;
};

async function runVerify(
  input:     VerifyTaskInput,
  fetchRow:  (taskId: number) => Promise<{ id: number; status: string | null } | undefined>,
  updateRow: (taskId: number, patch: VerifyPatch) => Promise<void>,
): Promise<TaskResult<void>> {
  try {
    const auth = await canManageSchedule(input.actorId, input.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason! };

    const row = await fetchRow(input.taskId);
    if (!row)                       return { success: false, error: 'Task tidak ditemukan.' };
    if (row.status !== 'completed') return { success: false, error: `Tidak bisa verifikasi task dengan status "${row.status}".` };

    await updateRow(input.taskId, {
      status:     input.approve ? 'verified' : 'rejected',
      verifiedBy: input.actorId,
      verifiedAt: new Date(),
      notes:      input.notes,
      updatedAt:  new Date(),
    });

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `verifyTask: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MATERIALISE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create all pending task rows for a newly materialised schedule row.
 * Safe to call multiple times — existence-checks skip rows that already exist.
 */
export async function materialiseTasksForSchedule(
  scheduleId: number,
): Promise<{ created: string[]; skipped: string[]; errors: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors:  string[] = [];

  const [sched] = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!sched) {
    errors.push(`Schedule ${scheduleId} not found.`);
    return { created, skipped, errors };
  }

  const shiftMap = await getShiftIdMap();
  const idToShiftMap: Record<number, string> = {};
  for (const [code, id] of Object.entries(shiftMap)) {
    idToShiftMap[id] = code;
  }

  const typedShift = idToShiftMap[sched.shiftId] as 'morning' | 'evening' | undefined;
  if (!typedShift) {
    errors.push(`Schedule ${scheduleId} has invalid shiftId ${sched.shiftId}.`);
    return { created, skipped, errors };
  }

  const dayStart   = startOfDay(sched.date);
  const base       = {
    scheduleId,
    userId:  sched.userId,
    storeId: sched.storeId,
    shiftId: sched.shiftId,
    date:    dayStart,
    status:  'pending' as const,
  };

  async function insertShared(
    name:   string,
    check:  () => Promise<{ id: number } | undefined>,
    insert: () => Promise<unknown>,
  ) {
    try {
      if (await check()) { skipped.push(name); return; }
      await insert();
      created.push(name);
    } catch (err) {
      errors.push(`${name}: ${err}`);
    }
  }

  async function insertPersonal(
    name:   string,
    check:  () => Promise<{ id: number } | undefined>,
    insert: () => Promise<unknown>,
  ) {
    try {
      if (await check()) { skipped.push(name); return; }
      await insert();
      created.push(name);
    } catch (err) {
      errors.push(`${name}: ${err}`);
    }
  }

  // ── Morning tasks ─────────────────────────────────────────────────────────
  if (typedShift === 'morning') {
    await insertShared(
      'storeOpening',
      () => db.select({ id: storeOpeningTasks.id }).from(storeOpeningTasks)
              .where(and(eq(storeOpeningTasks.storeId, sched.storeId), eq(storeOpeningTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(storeOpeningTasks).values(base),
    );
    await insertShared(
      'setoran',
      () => db.select({ id: setoranTasks.id }).from(setoranTasks)
              .where(and(eq(setoranTasks.storeId, sched.storeId), eq(setoranTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(setoranTasks).values(base),
    );
    await insertShared(
      'cekBin',
      () => db.select({ id: cekBinTasks.id }).from(cekBinTasks)
              .where(and(eq(cekBinTasks.storeId, sched.storeId), eq(cekBinTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(cekBinTasks).values(base),
    );
    await insertShared(
      'productCheck',
      () => db.select({ id: productCheckTasks.id }).from(productCheckTasks)
              .where(and(eq(productCheckTasks.storeId, sched.storeId), eq(productCheckTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(productCheckTasks).values(base),
    );
    await insertShared(
      'receiving',
      () => db.select({ id: receivingTasks.id }).from(receivingTasks)
              .where(and(eq(receivingTasks.storeId, sched.storeId), eq(receivingTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(receivingTasks).values(base),
    );
  }

  // ── Evening tasks ─────────────────────────────────────────────────────────
  if (typedShift === 'evening') {
    await insertShared(
      'briefing',
      () => db.select({ id: briefingTasks.id }).from(briefingTasks)
              .where(and(eq(briefingTasks.storeId, sched.storeId), eq(briefingTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(briefingTasks).values(base),
    );
    await insertShared(
      'edcSummary',
      () => db.select({ id: edcSummaryTasks.id }).from(edcSummaryTasks)
              .where(and(eq(edcSummaryTasks.storeId, sched.storeId), eq(edcSummaryTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(edcSummaryTasks).values(base),
    );
    await insertShared(
      'edcSettlement',
      () => db.select({ id: edcSettlementTasks.id }).from(edcSettlementTasks)
              .where(and(eq(edcSettlementTasks.storeId, sched.storeId), eq(edcSettlementTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(edcSettlementTasks).values(base),
    );
    await insertShared(
      'eodZReport',
      () => db.select({ id: eodZReportTasks.id }).from(eodZReportTasks)
              .where(and(eq(eodZReportTasks.storeId, sched.storeId), eq(eodZReportTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(eodZReportTasks).values(base),
    );
    await insertShared(
      'openStatement',
      () => db.select({ id: openStatementTasks.id }).from(openStatementTasks)
              .where(and(eq(openStatementTasks.storeId, sched.storeId), eq(openStatementTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(openStatementTasks).values(base),
    );
  }

  // ── Personal task: grooming (both shifts) ─────────────────────────────────
  await insertPersonal(
    'grooming',
    () => db.select({ id: groomingTasks.id }).from(groomingTasks)
            // Safety: groomingTasks.scheduleId uses serial() instead of integer() in your schema snippet.
            // If Drizzle types complain about `.where(eq(integer, serial))`, cast sched.id to `any`.
            .where(eq(groomingTasks.scheduleId, sched.id as any))
            .limit(1).then(r => r[0]),
    () => db.insert(groomingTasks).values(base),
  );

  return { created, skipped, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function materialiseTasksForMonth(
  storeId:   number,
  yearMonth: string,
): Promise<{ total: number; errors: string[] }> {
  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
    .limit(1);

  if (!ms) return { total: 0, errors: ['Monthly schedule not found.'] };

  const entries = await db
    .select({ scheduleId: schedules.id })
    .from(schedules)
    .innerJoin(monthlyScheduleEntries, eq(schedules.monthlyScheduleEntryId, monthlyScheduleEntries.id))
    .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));

  let total = 0;
  const errors: string[] = [];

  for (const { scheduleId } of entries) {
    const r = await materialiseTasksForSchedule(scheduleId);
    total += r.created.length;
    errors.push(...r.errors);
  }

  return { total, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE pending tasks when a schedule is removed / replaced
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteTasksForSchedule(scheduleId: number): Promise<void> {
  await Promise.all([
    db.delete(storeOpeningTasks) .where(and(eq(storeOpeningTasks.scheduleId,  scheduleId), inArray(storeOpeningTasks.status,  PENDING_STATUSES))),
    db.delete(setoranTasks)      .where(and(eq(setoranTasks.scheduleId,       scheduleId), inArray(setoranTasks.status,       PENDING_STATUSES))),
    db.delete(cekBinTasks)       .where(and(eq(cekBinTasks.scheduleId,        scheduleId), inArray(cekBinTasks.status,        PENDING_STATUSES))),
    db.delete(productCheckTasks) .where(and(eq(productCheckTasks.scheduleId,  scheduleId), inArray(productCheckTasks.status,  PENDING_STATUSES))),
    db.delete(receivingTasks)    .where(and(eq(receivingTasks.scheduleId,     scheduleId), inArray(receivingTasks.status,     PENDING_STATUSES))),
    db.delete(briefingTasks)     .where(and(eq(briefingTasks.scheduleId,      scheduleId), inArray(briefingTasks.status,      PENDING_STATUSES))),
    db.delete(edcSummaryTasks)   .where(and(eq(edcSummaryTasks.scheduleId,    scheduleId), inArray(edcSummaryTasks.status,    PENDING_STATUSES))),
    db.delete(edcSettlementTasks).where(and(eq(edcSettlementTasks.scheduleId, scheduleId), inArray(edcSettlementTasks.status, PENDING_STATUSES))),
    db.delete(eodZReportTasks)   .where(and(eq(eodZReportTasks.scheduleId,    scheduleId), inArray(eodZReportTasks.status,    PENDING_STATUSES))),
    db.delete(openStatementTasks).where(and(eq(openStatementTasks.scheduleId, scheduleId), inArray(openStatementTasks.status, PENDING_STATUSES))),
    db.delete(groomingTasks)     .where(and(eq(groomingTasks.scheduleId,      scheduleId as any), inArray(groomingTasks.status, PENDING_STATUSES))),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT
// All submit functions now run assertCanProgressTask before any mutation.
// The gate checks:
//   1. Employee is checked in       (hard block — no override)
//   2. Employee is within geofence  (soft block — overridden by skipGeo)
// ─────────────────────────────────────────────────────────────────────────────

export async function submitStoreOpening(
  input: SubmitStoreOpeningInput,
): Promise<TaskResult<StoreOpeningTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [existing] = await db
      .select()
      .from(storeOpeningTasks)
      .where(eq(storeOpeningTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'completed' || existing?.status === 'verified')
      return { success: false, error: 'Store opening task sudah disubmit.' };

    const shiftMap = await getShiftIdMap();
    const now    = new Date();
    const values = {
      scheduleId:        input.scheduleId,
      userId:            input.userId,
      storeId:           input.storeId,
      shiftId:           shiftMap['morning'],
      date:              startOfDay(now),
      loginPos:          input.loginPos,
      checkAbsenSunfish: input.checkAbsenSunfish,
      tarikSohSales:     input.tarikSohSales,
      fiveR:             input.fiveR,
      cekLamp:           input.cekLamp,
      cekSoundSystem:    input.cekSoundSystem,
      storeFrontPhotos:  jsonPhotos(input.storeFrontPhotos),
      cashDrawerPhotos:  jsonPhotos(input.cashDrawerPhotos),
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

// ─────────────────────────────────────────────────────────────────────────────

export async function submitSetoran(
  input: SubmitSetoranInput,
): Promise<TaskResult<SetoranTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    if (!input.moneyPhotos?.length)
      return { success: false, error: 'Minimal 1 foto uang wajib diupload.' };
    if (!input.linkSetoran)
      return { success: false, error: 'Link setoran wajib diisi.' };

    const [existing] = await db
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Setoran sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now    = new Date();
    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shiftId:      shiftMap['morning'],
      date:         startOfDay(now),
      amount:       input.amount,
      linkSetoran:  input.linkSetoran,
      moneyPhotos:  jsonPhotos(input.moneyPhotos),
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes:        input.notes,
      status:       'completed' as const,
      completedAt:  now,
      updatedAt:    now,
    };

    const row = existing
      ? (await db.update(setoranTasks).set(values).where(eq(setoranTasks.id, existing.id)).returning())[0]
      : (await db.insert(setoranTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitSetoran: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitProductCheck(
  input: SubmitProductCheckInput,
): Promise<TaskResult<ProductCheckTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [existing] = await db
      .select()
      .from(productCheckTasks)
      .where(eq(productCheckTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Product check sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now    = new Date();
    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shiftId:      shiftMap['morning'],
      date:         startOfDay(now),
      display:      input.display,
      price:        input.price,
      saleTag:      input.saleTag,
      shoeFiller:   input.shoeFiller,
      labelIndo:    input.labelIndo,
      barcode:      input.barcode,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes:        input.notes,
      status:       'completed' as const,
      completedAt:  now,
      updatedAt:    now,
    };

    const row = existing
      ? (await db.update(productCheckTasks).set(values).where(eq(productCheckTasks.id, existing.id)).returning())[0]
      : (await db.insert(productCheckTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitProductCheck: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitReceiving(
  input: SubmitReceivingInput,
): Promise<TaskResult<ReceivingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    if (input.hasReceiving && !input.receivingPhotos?.length)
      return { success: false, error: 'Foto wajib diupload jika ada penerimaan barang.' };

    const [existing] = await db
      .select()
      .from(receivingTasks)
      .where(eq(receivingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Receiving sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now    = new Date();
    const values = {
      scheduleId:      input.scheduleId,
      userId:          input.userId,
      storeId:         input.storeId,
      shiftId:         shiftMap['morning'],
      date:            startOfDay(now),
      hasReceiving:    input.hasReceiving,
      receivingPhotos: jsonPhotos(input.receivingPhotos),
      submittedLat:    String(input.geo.lat),
      submittedLng:    String(input.geo.lng),
      notes:           input.notes,
      status:          'completed' as const,
      completedAt:     now,
      updatedAt:       now,
    };

    const row = existing
      ? (await db.update(receivingTasks).set(values).where(eq(receivingTasks.id, existing.id)).returning())[0]
      : (await db.insert(receivingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitReceiving: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitBriefing(
  input: SubmitBriefingInput,
): Promise<TaskResult<BriefingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [existing] = await db
      .select()
      .from(briefingTasks)
      .where(eq(briefingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Briefing sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now    = new Date();
    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shiftId:      shiftMap['evening'],
      date:         startOfDay(now),
      done:         input.done,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes:        input.notes,
      status:       'completed' as const,
      completedAt:  now,
      updatedAt:    now,
    };

    const row = existing
      ? (await db.update(briefingTasks).set(values).where(eq(briefingTasks.id, existing.id)).returning())[0]
      : (await db.insert(briefingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitBriefing: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo-only evening tasks
// ─────────────────────────────────────────────────────────────────────────────

export async function submitEdcSummary(input: SubmitPhotoTaskInput): Promise<TaskResult<EdcSummaryTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };
    if (!input.photos?.length) return { success: false, error: 'Minimal 1 foto wajib diupload.' };

    const [existing] = await db.select().from(edcSummaryTasks).where(eq(edcSummaryTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shiftId: shiftMap['evening'], date: startOfDay(now), edcSummaryPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(edcSummaryTasks).set(v).where(eq(edcSummaryTasks.id, existing.id)).returning())[0] : (await db.insert(edcSummaryTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitEdcSummary: ${err}` }; }
}

export async function submitEdcSettlement(input: SubmitPhotoTaskInput): Promise<TaskResult<EdcSettlementTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };
    if (!input.photos?.length) return { success: false, error: 'Minimal 1 foto wajib diupload.' };

    const [existing] = await db.select().from(edcSettlementTasks).where(eq(edcSettlementTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shiftId: shiftMap['evening'], date: startOfDay(now), edcSettlementPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(edcSettlementTasks).set(v).where(eq(edcSettlementTasks.id, existing.id)).returning())[0] : (await db.insert(edcSettlementTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitEdcSettlement: ${err}` }; }
}

export async function submitEodZReport(input: SubmitPhotoTaskInput): Promise<TaskResult<EodZReportTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };
    if (!input.photos?.length) return { success: false, error: 'Minimal 1 foto wajib diupload.' };

    const [existing] = await db.select().from(eodZReportTasks).where(eq(eodZReportTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shiftId: shiftMap['evening'], date: startOfDay(now), zReportPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(eodZReportTasks).set(v).where(eq(eodZReportTasks.id, existing.id)).returning())[0] : (await db.insert(eodZReportTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitEodZReport: ${err}` }; }
}

export async function submitOpenStatement(input: SubmitPhotoTaskInput): Promise<TaskResult<OpenStatementTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };
    if (!input.photos?.length) return { success: false, error: 'Minimal 1 foto wajib diupload.' };

    const [existing] = await db.select().from(openStatementTasks).where(eq(openStatementTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shiftId: shiftMap['evening'], date: startOfDay(now), openStatementPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(openStatementTasks).set(v).where(eq(openStatementTasks.id, existing.id)).returning())[0] : (await db.insert(openStatementTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitOpenStatement: ${err}` }; }
}



// ─────────────────────────────────────────────────────────────────────────────

export async function submitGrooming(
  input: SubmitGroomingInput,
): Promise<TaskResult<GroomingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    if (!input.selfiePhotos?.length)
      return { success: false, error: 'Foto selfie full body wajib diupload.' };

    const [existing] = await db
      .select()
      .from(groomingTasks)
      .where(eq(groomingTasks.scheduleId, input.scheduleId as any))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Grooming task sudah diverifikasi.' };

    const [sched] = await db
      .select({ shiftId: schedules.shiftId })
      .from(schedules)
      .where(eq(schedules.id, input.scheduleId))
      .limit(1);

    const now    = new Date();
    const values = {
      scheduleId:           input.scheduleId,
      userId:               input.userId,
      storeId:              input.storeId,
      shiftId:              sched?.shiftId,
      date:                 startOfDay(now),
      uniformComplete:      input.uniformComplete,
      hairGroomed:          input.hairGroomed,
      nailsClean:           input.nailsClean,
      accessoriesCompliant: input.accessoriesCompliant,
      shoeCompliant:        input.shoeCompliant,
      selfiePhotos:         jsonPhotos(input.selfiePhotos),
      submittedLat:         String(input.geo.lat),
      submittedLng:         String(input.geo.lng),
      notes:                input.notes,
      status:               'completed' as const,
      completedAt:          now,
      updatedAt:            now,
    };

    const row = existing
      ? (await db.update(groomingTasks).set(values).where(eq(groomingTasks.id, existing.id)).returning())[0]
      : (await db.insert(groomingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitGrooming: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY — callbacks only, no table passed as parameter
// ─────────────────────────────────────────────────────────────────────────────

export const verifyStoreOpening = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: storeOpeningTasks.id, status: storeOpeningTasks.status }).from(storeOpeningTasks).where(eq(storeOpeningTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(storeOpeningTasks).set(p).where(eq(storeOpeningTasks.id, id)).then(() => {}),
);

export const verifySetoran = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: setoranTasks.id, status: setoranTasks.status }).from(setoranTasks).where(eq(setoranTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(setoranTasks).set(p).where(eq(setoranTasks.id, id)).then(() => {}),
);

export const verifyCekBin = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: cekBinTasks.id, status: cekBinTasks.status }).from(cekBinTasks).where(eq(cekBinTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(cekBinTasks).set(p).where(eq(cekBinTasks.id, id)).then(() => {}),
);

export const verifyProductCheck = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: productCheckTasks.id, status: productCheckTasks.status }).from(productCheckTasks).where(eq(productCheckTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(productCheckTasks).set(p).where(eq(productCheckTasks.id, id)).then(() => {}),
);

export const verifyReceiving = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: receivingTasks.id, status: receivingTasks.status }).from(receivingTasks).where(eq(receivingTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(receivingTasks).set(p).where(eq(receivingTasks.id, id)).then(() => {}),
);

export const verifyBriefing = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: briefingTasks.id, status: briefingTasks.status }).from(briefingTasks).where(eq(briefingTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(briefingTasks).set(p).where(eq(briefingTasks.id, id)).then(() => {}),
);

export const verifyEdcSummary = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: edcSummaryTasks.id, status: edcSummaryTasks.status }).from(edcSummaryTasks).where(eq(edcSummaryTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(edcSummaryTasks).set(p).where(eq(edcSummaryTasks.id, id)).then(() => {}),
);

export const verifyEdcSettlement = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: edcSettlementTasks.id, status: edcSettlementTasks.status }).from(edcSettlementTasks).where(eq(edcSettlementTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(edcSettlementTasks).set(p).where(eq(edcSettlementTasks.id, id)).then(() => {}),
);

export const verifyEodZReport = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: eodZReportTasks.id, status: eodZReportTasks.status }).from(eodZReportTasks).where(eq(eodZReportTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(eodZReportTasks).set(p).where(eq(eodZReportTasks.id, id)).then(() => {}),
);

export const verifyOpenStatement = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: openStatementTasks.id, status: openStatementTasks.status }).from(openStatementTasks).where(eq(openStatementTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(openStatementTasks).set(p).where(eq(openStatementTasks.id, id)).then(() => {}),
);

export const verifyGrooming = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: groomingTasks.id, status: groomingTasks.status }).from(groomingTasks).where(eq(groomingTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(groomingTasks).set(p).where(eq(groomingTasks.id, id)).then(() => {}),
);

// ─────────────────────────────────────────────────────────────────────────────
// READ helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function getTasksForSchedule(scheduleId: number) {
  const [
    opening, setoran, cekBin, productCheck, receiving,
    briefing, edcSummary, edcSettlement, eodZReport, openStatement,
    grooming,
  ] = await Promise.all([
    db.select().from(storeOpeningTasks) .where(eq(storeOpeningTasks.scheduleId,  scheduleId)).limit(1),
    db.select().from(setoranTasks)      .where(eq(setoranTasks.scheduleId,       scheduleId)).limit(1),
    db.select().from(cekBinTasks)       .where(eq(cekBinTasks.scheduleId,        scheduleId)).limit(1),
    db.select().from(productCheckTasks) .where(eq(productCheckTasks.scheduleId,  scheduleId)).limit(1),
    db.select().from(receivingTasks)    .where(eq(receivingTasks.scheduleId,     scheduleId)).limit(1),
    db.select().from(briefingTasks)     .where(eq(briefingTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(edcSummaryTasks)   .where(eq(edcSummaryTasks.scheduleId,    scheduleId)).limit(1),
    db.select().from(edcSettlementTasks).where(eq(edcSettlementTasks.scheduleId, scheduleId)).limit(1),
    db.select().from(eodZReportTasks)   .where(eq(eodZReportTasks.scheduleId,    scheduleId)).limit(1),
    db.select().from(openStatementTasks).where(eq(openStatementTasks.scheduleId, scheduleId)).limit(1),
    db.select().from(groomingTasks)     .where(eq(groomingTasks.scheduleId,      scheduleId as any)).limit(1),
  ]);

  return {
    storeOpening:  opening[0]       ?? null,
    setoran:       setoran[0]       ?? null,
    cekBin:        cekBin[0]        ?? null,
    productCheck:  productCheck[0]  ?? null,
    receiving:     receiving[0]     ?? null,
    briefing:      briefing[0]      ?? null,
    edcSummary:    edcSummary[0]    ?? null,
    edcSettlement: edcSettlement[0] ?? null,
    eodZReport:    eodZReport[0]    ?? null,
    openStatement: openStatement[0] ?? null,
    grooming:      grooming[0]      ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Count task rows by status for a store on a given date. Used by OPS dashboard. */
export async function getDailyTaskSummary(storeId: number, date: Date) {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  function summarise(rows: { status: string | null; count: number }[]) {
    return {
      pending:    rows.find(r => r.status === 'pending')?.count     ?? 0,
      inProgress: rows.find(r => r.status === 'in_progress')?.count ?? 0,
      completed:  rows.find(r => r.status === 'completed')?.count   ?? 0,
      verified:   rows.find(r => r.status === 'verified')?.count    ?? 0,
      rejected:   rows.find(r => r.status === 'rejected')?.count    ?? 0,
    };
  }

  const [
    storeOpening, setoran, cekBin, productCheck, receiving,
    briefing, edcSummary, edcSettlement, eodZReport, openStatement,
    grooming,
  ] = await Promise.all([
    db.select({ status: storeOpeningTasks.status,  count: sql<number>`count(*)::int` }).from(storeOpeningTasks) .where(and(eq(storeOpeningTasks.storeId,  storeId), gte(storeOpeningTasks.date,  dayStart), lte(storeOpeningTasks.date,  dayEnd))).groupBy(storeOpeningTasks.status) .then(summarise),
    db.select({ status: setoranTasks.status,       count: sql<number>`count(*)::int` }).from(setoranTasks)      .where(and(eq(setoranTasks.storeId,       storeId), gte(setoranTasks.date,       dayStart), lte(setoranTasks.date,       dayEnd))).groupBy(setoranTasks.status)      .then(summarise),
    db.select({ status: cekBinTasks.status,        count: sql<number>`count(*)::int` }).from(cekBinTasks)       .where(and(eq(cekBinTasks.storeId,        storeId), gte(cekBinTasks.date,        dayStart), lte(cekBinTasks.date,        dayEnd))).groupBy(cekBinTasks.status)       .then(summarise),
    db.select({ status: productCheckTasks.status,  count: sql<number>`count(*)::int` }).from(productCheckTasks) .where(and(eq(productCheckTasks.storeId,  storeId), gte(productCheckTasks.date,  dayStart), lte(productCheckTasks.date,  dayEnd))).groupBy(productCheckTasks.status) .then(summarise),
    db.select({ status: receivingTasks.status,     count: sql<number>`count(*)::int` }).from(receivingTasks)    .where(and(eq(receivingTasks.storeId,     storeId), gte(receivingTasks.date,     dayStart), lte(receivingTasks.date,     dayEnd))).groupBy(receivingTasks.status)    .then(summarise),
    db.select({ status: briefingTasks.status,      count: sql<number>`count(*)::int` }).from(briefingTasks)     .where(and(eq(briefingTasks.storeId,      storeId), gte(briefingTasks.date,      dayStart), lte(briefingTasks.date,      dayEnd))).groupBy(briefingTasks.status)     .then(summarise),
    db.select({ status: edcSummaryTasks.status,    count: sql<number>`count(*)::int` }).from(edcSummaryTasks)   .where(and(eq(edcSummaryTasks.storeId,    storeId), gte(edcSummaryTasks.date,    dayStart), lte(edcSummaryTasks.date,    dayEnd))).groupBy(edcSummaryTasks.status)   .then(summarise),
    db.select({ status: edcSettlementTasks.status, count: sql<number>`count(*)::int` }).from(edcSettlementTasks).where(and(eq(edcSettlementTasks.storeId, storeId), gte(edcSettlementTasks.date, dayStart), lte(edcSettlementTasks.date, dayEnd))).groupBy(edcSettlementTasks.status).then(summarise),
    db.select({ status: eodZReportTasks.status,    count: sql<number>`count(*)::int` }).from(eodZReportTasks)   .where(and(eq(eodZReportTasks.storeId,    storeId), gte(eodZReportTasks.date,    dayStart), lte(eodZReportTasks.date,    dayEnd))).groupBy(eodZReportTasks.status)   .then(summarise),
    db.select({ status: openStatementTasks.status, count: sql<number>`count(*)::int` }).from(openStatementTasks).where(and(eq(openStatementTasks.storeId, storeId), gte(openStatementTasks.date, dayStart), lte(openStatementTasks.date, dayEnd))).groupBy(openStatementTasks.status).then(summarise),
    db.select({ status: groomingTasks.status,      count: sql<number>`count(*)::int` }).from(groomingTasks)     .where(and(eq(groomingTasks.storeId,      storeId), gte(groomingTasks.date,      dayStart), lte(groomingTasks.date,      dayEnd))).groupBy(groomingTasks.status)     .then(summarise),
  ]);

  return {
    storeOpening, setoran, cekBin, productCheck, receiving,
    briefing, edcSummary, edcSettlement, eodZReport, openStatement,
    grooming,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OPS READ helpers — flat task list + area overview
// ─────────────────────────────────────────────────────────────────────────────

export interface FlatTask {
  id:          number;
  type:        string;
  scheduleId:  number;
  userId:      string;
  userName:    string | null;
  storeId:     number;
  shift:       'morning' | 'evening' | null;
  date:        string;
  status:      string | null;
  notes:       string | null;
  completedAt: string | null;
  verifiedBy:  string | null;
  verifiedAt:  string | null;
  extra:       Record<string, unknown>;
}

export interface StoreTaskSummary {
  pending:    number;
  inProgress: number;
  completed:  number;
  verified:   number;
  rejected:   number;
  total:      number;
}

function parsePhotosField(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildExtra(
  row: Record<string, unknown>,
  photoFields: string[] = [],
): Record<string, unknown> {
  const skip = new Set([
    'id', 'scheduleId', 'userId', 'storeId', 'shiftId',
    'date', 'status', 'notes', 'completedAt', 'verifiedBy', 'verifiedAt',
    'createdAt', 'updatedAt', 'submittedLat', 'submittedLng',
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k)) continue;
    extra[k] = photoFields.includes(k) ? parsePhotosField(v) : v;
  }
  return extra;
}

/**
 * Fetch ALL task rows for a store on a given day, across every task table,
 * joined with user names and shift codes. Returns a flat array sorted by
 * (shift, task type, user name).
 */
export async function getFlatTasksForStoreDate(
  storeId: number,
  date:    Date,
): Promise<FlatTask[]> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftCodeById = new Map<number, 'morning' | 'evening'>(
    shiftRows.map(s => [s.id, s.code as 'morning' | 'evening']),
  );

  async function loadTable(
    table:       any,
    type:        string,
    photoFields: string[],
  ): Promise<FlatTask[]> {
    const rows = await db
      .select({
        task:     table,
        userName: users.name,
      })
      .from(table)
      .leftJoin(users, eq(table.userId, users.id))
      .where(
        and(
          eq(table.storeId, storeId),
          gte(table.date, dayStart),
          lte(table.date, dayEnd),
        ),
      );

    return rows.map(({ task, userName }) => {
      const t = task as any;
      return {
        id:          t.id,
        type,
        scheduleId:  t.scheduleId,
        userId:      t.userId,
        userName:    userName ?? null,
        storeId:     t.storeId,
        shift:       shiftCodeById.get(t.shiftId) ?? null,
        date:        t.date instanceof Date ? t.date.toISOString() : String(t.date),
        status:      t.status ?? null,
        notes:       t.notes ?? null,
        completedAt: t.completedAt instanceof Date ? t.completedAt.toISOString() : null,
        verifiedBy:  t.verifiedBy ?? null,
        verifiedAt:  t.verifiedAt instanceof Date ? t.verifiedAt.toISOString() : null,
        extra:       buildExtra(t, photoFields),
      };
    });
  }

  const [
    opening, setoran, cekBin, productCheck, receiving,
    briefing, edcSummary, edcSettlement, eodZReport, openStatement,
    grooming,
  ] = await Promise.all([
    loadTable(storeOpeningTasks,  'store_opening',  ['storeFrontPhotos', 'cashDrawerPhotos']),
    loadTable(setoranTasks,       'setoran',        ['moneyPhotos']),
    loadTable(cekBinTasks,        'cek_bin',        []),
    loadTable(productCheckTasks,  'product_check',  []),
    loadTable(receivingTasks,     'receiving',      ['receivingPhotos']),
    loadTable(briefingTasks,      'briefing',       []),
    loadTable(edcSummaryTasks,    'edc_summary',    ['edcSummaryPhotos']),
    loadTable(edcSettlementTasks, 'edc_settlement', ['edcSettlementPhotos']),
    loadTable(eodZReportTasks,    'eod_z_report',   ['zReportPhotos']),
    loadTable(openStatementTasks, 'open_statement', ['openStatementPhotos']),
    loadTable(groomingTasks,      'grooming',       ['selfiePhotos']),
  ]);

  const all = [
    ...opening, ...setoran, ...cekBin, ...productCheck, ...receiving,
    ...briefing, ...edcSummary, ...edcSettlement, ...eodZReport, ...openStatement,
    ...grooming,
  ];

  const shiftOrder: Record<string, number> = { morning: 0, evening: 1 };
  all.sort((a, b) => {
    const sa = a.shift ? shiftOrder[a.shift] ?? 2 : 2;
    const sb = b.shift ? shiftOrder[b.shift] ?? 2 : 2;
    if (sa !== sb) return sa - sb;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return (a.userName ?? '').localeCompare(b.userName ?? '');
  });

  return all;
}

export function summariseTasks(tasks: FlatTask[]): StoreTaskSummary {
  const summary: StoreTaskSummary = {
    pending: 0, inProgress: 0, completed: 0, verified: 0, rejected: 0, total: tasks.length,
  };
  for (const t of tasks) {
    switch (t.status) {
      case 'pending':     summary.pending++;    break;
      case 'in_progress': summary.inProgress++; break;
      case 'completed':   summary.completed++;  break;
      case 'verified':    summary.verified++;   break;
      case 'rejected':    summary.rejected++;   break;
    }
  }
  return summary;
}

/**
 * Area-wide overview for every store in the OPS user's area.
 * Returns area info + per-store task summary for the given date.
 */
export async function getAreaTaskOverview(
  opsUserId: string,
  date:      Date,
): Promise<{
  area: { id: number; name: string } | null;
  stores: Array<{
    id:      number;
    name:    string;
    address: string;
    summary: StoreTaskSummary;
  }>;
}> {
  const [opsUser] = await db
    .select({ areaId: users.areaId })
    .from(users)
    .where(eq(users.id, opsUserId))
    .limit(1);

  if (!opsUser?.areaId) return { area: null, stores: [] };

  const [area] = await db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(eq(areas.id, opsUser.areaId))
    .limit(1);

  const areaStores = await db
    .select({ id: stores.id, name: stores.name, address: stores.address })
    .from(stores)
    .where(eq(stores.areaId, opsUser.areaId))
    .orderBy(stores.name);

  const results = await Promise.all(
    areaStores.map(async (s) => {
      const daily = await getDailyTaskSummary(s.id, date);

      const summary: StoreTaskSummary = {
        pending: 0, inProgress: 0, completed: 0, verified: 0, rejected: 0, total: 0,
      };
      for (const perType of Object.values(daily)) {
        summary.pending    += perType.pending;
        summary.inProgress += perType.inProgress;
        summary.completed  += perType.completed;
        summary.verified   += perType.verified;
        summary.rejected   += perType.rejected;
      }
      summary.total =
        summary.pending + summary.inProgress + summary.completed +
        summary.verified + summary.rejected;

      return { ...s, summary };
    }),
  );

  return { area: area ?? null, stores: results };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify dispatcher — route (type, id) to the right verify function
// ─────────────────────────────────────────────────────────────────────────────

const VERIFY_DISPATCH: Record<string, (i: VerifyTaskInput) => Promise<TaskResult<void>>> = {
  store_opening:  verifyStoreOpening,
  setoran:        verifySetoran,
  cek_bin:        verifyCekBin,
  product_check:  verifyProductCheck,
  receiving:      verifyReceiving,
  briefing:       verifyBriefing,
  edc_summary:    verifyEdcSummary,
  edc_settlement: verifyEdcSettlement,
  eod_z_report:   verifyEodZReport,
  open_statement: verifyOpenStatement,
  grooming:       verifyGrooming,
};

export async function verifyTaskByType(
  type:  string,
  input: VerifyTaskInput,
): Promise<TaskResult<void>> {
  const fn = VERIFY_DISPATCH[type];
  if (!fn) return { success: false, error: `Unknown task type: ${type}` };
  return fn(input);
}
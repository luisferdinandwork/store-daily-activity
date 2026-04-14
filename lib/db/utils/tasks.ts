// lib/db/utils/tasks.ts
import { db }                                          from '@/lib/db';
import { eq, and, gte, lte, inArray, sql, isNull, or } from 'drizzle-orm';
import {
  schedules, stores, shifts, attendance,
  monthlySchedules, monthlyScheduleEntries,
  cekBinTasks, productCheckTasks, briefingTasks,
  edcReconciliationTasks,
  eodZReportTasks,
  openStatementTasks,
  groomingTasks, itemDroppingTasks,
  type ProductCheckTask,
  type BriefingTask,
  type GroomingTask,
} from '@/lib/db/schema';
import { canManageSchedule } from '@/lib/schedule-utils';
import { users, areas }      from '@/lib/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

const PENDING_STATUSES: readonly ['pending', 'in_progress'] = ['pending', 'in_progress'] as const;

/**
 * Statuses that mean a task is fully resolved and cannot be re-submitted.
 * Typed as a plain string array so TypeScript doesn't narrow comparisons
 * against the enum string-literal union incorrectly.
 */
const TERMINAL_STATUSES: string[] = ['verified', 'rejected'];

// ─── Public types ─────────────────────────────────────────────────────────────

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type TaskAccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

// ─── Submit input types ───────────────────────────────────────────────────────

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

export interface SubmitBriefingInput {
  scheduleId:   number;
  userId:       string;
  storeId:      number;
  geo:          GeoPoint;
  done:         boolean;
  /**
   * true  → status becomes 'completed'
   * false → status becomes 'discrepancy'; task carries to next shift
   */
  isBalanced:   boolean;
  notes?:       string;
  skipGeo?:     boolean;
  /**
   * Set when continuing a discrepancy task from a prior shift.
   * The function will UPDATE that row rather than insert a new one.
   */
  parentTaskId?: number;
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
  id:           number;
  type:         string;
  scheduleId:   number;
  userId:       string;
  userName:     string | null;
  storeId:      number;
  shift:        'morning' | 'evening' | 'full_day' | null;
  date:         string;
  status:       string | null;
  notes:        string | null;
  completedAt:  string | null;
  verifiedBy:   string | null;
  verifiedAt:   string | null;
  isBalanced:   boolean | null;
  parentTaskId: number | null;
  extra:        Record<string, unknown>;
}

export interface StoreTaskSummary {
  pending:     number;
  inProgress:  number;
  completed:   number;
  discrepancy: number;
  verified:    number;
  rejected:    number;
  total:       number;
}

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

let shiftIdCache: Record<string, number> | null = null;
async function getShiftIdMap(): Promise<Record<string, number>> {
  if (shiftIdCache) return shiftIdCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  shiftIdCache = Object.fromEntries(rows.map(r => [r.code, r.id]));
  return shiftIdCache!;
}

// ─── Guard helpers ────────────────────────────────────────────────────────────

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

export async function getTaskAccessStatus(
  scheduleId: number,
  storeId:    number,
  geo:        GeoPoint | null,
): Promise<TaskAccessStatus> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return { status: 'not_checked_in' };
  if (!geo)       return { status: 'geo_unavailable' };

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

type VerifyPatch = {
  status:     'verified' | 'rejected';
  verifiedBy: string;
  verifiedAt: Date;
  notes:      string | undefined;
  updatedAt:  Date;
};

async function runVerify(
  input:     VerifyTaskInput,
  fetchRow:  (id: number) => Promise<{ id: number; status: string | null } | undefined>,
  updateRow: (id: number, patch: VerifyPatch) => Promise<void>,
): Promise<TaskResult<void>> {
  try {
    const auth = await canManageSchedule(input.actorId, input.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason! };

    const row = await fetchRow(input.taskId);
    if (!row) return { success: false, error: 'Task tidak ditemukan.' };

    if (row.status !== 'completed')
      return { success: false, error: `Tidak bisa verifikasi task dengan status "${row.status}".` };

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

// ─── Discrepancy helpers ──────────────────────────────────────────────────────

/**
 * Returns the active (pending / in_progress / discrepancy) task for a store on
 * a given date. Also surfaces unresolved discrepancies from prior days.
 */
export async function getActiveDiscrepancyTask<T extends { id: number; status: string | null; parentTaskId: number | null }>(
  table:   any,
  storeId: number,
  date:    Date,
): Promise<T | null> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const rows = await db
    .select()
    .from(table)
    .where(and(
      eq(table.storeId, storeId),
      gte(table.date, dayStart),
      lte(table.date, dayEnd),
      inArray(table.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .orderBy(table.createdAt)
    .limit(1);

  if (rows[0]) return rows[0] as T;

  const prior = await db
    .select()
    .from(table)
    .where(and(eq(table.storeId, storeId), eq(table.status, 'discrepancy'), isNull(table.parentTaskId)))
    .orderBy(table.createdAt)
    .limit(1);

  return (prior[0] as T) ?? null;
}

// ─── Materialise ──────────────────────────────────────────────────────────────

export async function materialiseTasksForSchedule(
  scheduleId: number,
): Promise<{ created: string[]; skipped: string[]; errors: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors:  string[] = [];

  const [sched] = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
  if (!sched) { errors.push(`Schedule ${scheduleId} not found.`); return { created, skipped, errors }; }

  const shiftMap = await getShiftIdMap();
  const idToCode: Record<number, string> = Object.fromEntries(Object.entries(shiftMap).map(([c, id]) => [id, c]));

  const shiftCode = idToCode[sched.shiftId];
  if (!shiftCode) { errors.push(`Schedule ${scheduleId} has invalid shiftId ${sched.shiftId}.`); return { created, skipped, errors }; }

  const isMorning = shiftCode === 'morning' || shiftCode === 'full_day';
  const isEvening = shiftCode === 'evening' || shiftCode === 'full_day';
  const dayStart  = startOfDay(sched.date);
  const morningId = shiftMap['morning'] ?? sched.shiftId;
  const eveningId = shiftMap['evening'] ?? sched.shiftId;

  const baseCommon = { scheduleId, userId: sched.userId, storeId: sched.storeId, date: dayStart, status: 'pending' as const };

  async function insertShared(
    name:   string,
    check:  () => Promise<{ id: number } | undefined>,
    insert: () => Promise<unknown>,
  ) {
    try {
      if (await check()) { skipped.push(name); return; }
      await insert();
      created.push(name);
    } catch (err) { errors.push(`${name}: ${err}`); }
  }

  // ── Morning ────────────────────────────────────────────────────────────────
  if (isMorning) {
    const base = { ...baseCommon, shiftId: morningId };

    await insertShared('cekBin',
      () => db.select({ id: cekBinTasks.id }).from(cekBinTasks)
        .where(and(eq(cekBinTasks.storeId, sched.storeId), eq(cekBinTasks.date, dayStart)))
        .limit(1).then(r => r[0]),
      () => db.insert(cekBinTasks).values(base));

    await insertShared('productCheck',
      () => db.select({ id: productCheckTasks.id }).from(productCheckTasks)
        .where(and(eq(productCheckTasks.storeId, sched.storeId), eq(productCheckTasks.date, dayStart)))
        .limit(1).then(r => r[0]),
      () => db.insert(productCheckTasks).values(base));

    // Item Dropping — no unique(storeId, date) constraint, check active row
    await insertShared('itemDropping',
      () => db.select({ id: itemDroppingTasks.id }).from(itemDroppingTasks)
        .where(and(
          eq(itemDroppingTasks.storeId, sched.storeId),
          eq(itemDroppingTasks.date, dayStart),
          inArray(itemDroppingTasks.status, ['pending', 'in_progress', 'discrepancy']),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(itemDroppingTasks).values({ ...base, hasDropping: false, isReceived: false }));
  }

  // ── Evening ────────────────────────────────────────────────────────────────
  if (isEvening) {
    const base = { ...baseCommon, shiftId: eveningId };

    async function eveningActive(table: any): Promise<{ id: number } | undefined> {
      return db.select({ id: table.id }).from(table)
        .where(and(
          eq(table.storeId, sched.storeId),
          eq(table.date, dayStart),
          inArray(table.status, ['pending', 'in_progress', 'discrepancy']),
        ))
        .limit(1).then((r: { id: number }[]) => r[0]);
    }

    // Briefing — unchanged
    await insertShared('briefing',
      () => eveningActive(briefingTasks),
      () => db.insert(briefingTasks).values(base));

    // EDC Reconciliation — via dedicated util (handles per-row defaults)
    try {
      const { materialiseEdcReconciliationTask } = await import('@/lib/db/utils/edc-reconciliation');
      const r = await materialiseEdcReconciliationTask(
        scheduleId, sched.userId, sched.storeId, eveningId, dayStart,
      );
      if (r === 'created') created.push('edcReconciliation');
      else                 skipped.push('edcReconciliation');
    } catch (err) {
      errors.push(`edcReconciliation: ${err}`);
    }

    // EOD Z-Report — simple shared task, no discrepancy pattern
    await insertShared('eodZReport',
      () => eveningActive(eodZReportTasks),
      () => db.insert(eodZReportTasks).values(base));

    // Open Statement — via dedicated util
    try {
      const { materialiseOpenStatementTask } = await import('@/lib/db/utils/open-statement');
      const r = await materialiseOpenStatementTask(
        scheduleId, sched.userId, sched.storeId, eveningId, dayStart,
      );
      if (r === 'created') created.push('openStatement');
      else                 skipped.push('openStatement');
    } catch (err) {
      errors.push(`openStatement: ${err}`);
    }
  }

  // ── Grooming — personal, all shifts ───────────────────────────────────────
  try {
    const existing = await db.select({ id: groomingTasks.id }).from(groomingTasks)
      .where(eq(groomingTasks.scheduleId, sched.id as any)).limit(1).then(r => r[0]);
    if (existing) { skipped.push('grooming'); }
    else          { await db.insert(groomingTasks).values({ ...baseCommon, shiftId: sched.shiftId }); created.push('grooming'); }
  } catch (err) { errors.push(`grooming: ${err}`); }

  return { created, skipped, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function materialiseTasksForMonth(
  storeId:   number,
  yearMonth: string,
): Promise<{ total: number; errors: string[] }> {
  const [ms] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth))).limit(1);
  if (!ms) return { total: 0, errors: ['Monthly schedule not found.'] };

  const entries = await db.select({ scheduleId: schedules.id }).from(schedules)
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

export async function deleteTasksForSchedule(scheduleId: number): Promise<void> {
  const eveningStatuses = [...PENDING_STATUSES, 'discrepancy'] as string[];
  await Promise.all([
    // Morning tasks
    db.delete(cekBinTasks)
      .where(and(eq(cekBinTasks.scheduleId, scheduleId), inArray(cekBinTasks.status, PENDING_STATUSES))),
    db.delete(productCheckTasks)
      .where(and(eq(productCheckTasks.scheduleId, scheduleId), inArray(productCheckTasks.status, PENDING_STATUSES))),
    db.delete(itemDroppingTasks)
      .where(and(eq(itemDroppingTasks.scheduleId, scheduleId), inArray(itemDroppingTasks.status, eveningStatuses as any))),
    // Evening tasks
    db.delete(briefingTasks)
      .where(and(eq(briefingTasks.scheduleId, scheduleId), inArray(briefingTasks.status, eveningStatuses as any))),
    // edcReconciliation cascade-deletes its edc_transaction_rows children automatically
    db.delete(edcReconciliationTasks)
      .where(and(eq(edcReconciliationTasks.scheduleId, scheduleId), inArray(edcReconciliationTasks.status, eveningStatuses as any))),
    db.delete(eodZReportTasks)
      .where(and(eq(eodZReportTasks.scheduleId, scheduleId), inArray(eodZReportTasks.status, eveningStatuses as any))),
    db.delete(openStatementTasks)
      .where(and(eq(openStatementTasks.scheduleId, scheduleId), inArray(openStatementTasks.status, eveningStatuses as any))),
    // Personal
    db.delete(groomingTasks)
      .where(and(eq(groomingTasks.scheduleId, scheduleId as any), inArray(groomingTasks.status, PENDING_STATUSES))),
  ]);
}

// ─── Submit — morning tasks ───────────────────────────────────────────────────

export async function submitProductCheck(
  input: SubmitProductCheckInput,
): Promise<TaskResult<ProductCheckTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [existing] = await db.select().from(productCheckTasks)
      .where(eq(productCheckTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified')
      return { success: false, error: 'Product check sudah diverifikasi.' };

    const shiftMap = await getShiftIdMap();
    const now      = new Date();
    const values   = {
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

// ─── Submit — evening tasks ───────────────────────────────────────────────────

export async function submitBriefing(
  input: SubmitBriefingInput,
): Promise<TaskResult<BriefingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const shiftMap = await getShiftIdMap();
    const now      = new Date();
    const status   = input.isBalanced ? ('completed' as const) : ('discrepancy' as const);

    let row: BriefingTask;

    if (input.parentTaskId) {
      const [existing] = await db.select().from(briefingTasks)
        .where(eq(briefingTasks.id, input.parentTaskId)).limit(1);
      if (!existing)                         return { success: false, error: 'Task carry-forward tidak ditemukan.' };
      if (existing.status !== 'discrepancy') return { success: false, error: 'Task ini tidak dalam status discrepancy.' };

      row = (await db.update(briefingTasks).set({
        scheduleId:   input.scheduleId,
        userId:       input.userId,
        done:         input.done,
        isBalanced:   input.isBalanced,
        submittedLat: String(input.geo.lat),
        submittedLng: String(input.geo.lng),
        notes:        input.notes,
        status,
        completedAt:  status === 'completed' ? now : null,
        updatedAt:    now,
      }).where(eq(briefingTasks.id, input.parentTaskId)).returning())[0];
    } else {
      const [existing] = await db.select().from(briefingTasks)
        .where(eq(briefingTasks.scheduleId, input.scheduleId)).limit(1);
      if (existing?.status != null && TERMINAL_STATUSES.includes(existing.status))
        return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };

      const values = {
        scheduleId:   input.scheduleId,
        userId:       input.userId,
        storeId:      input.storeId,
        shiftId:      shiftMap['evening'],
        date:         startOfDay(now),
        parentTaskId: null as number | null,
        done:         input.done,
        isBalanced:   input.isBalanced,
        submittedLat: String(input.geo.lat),
        submittedLng: String(input.geo.lng),
        notes:        input.notes,
        status,
        completedAt:  status === 'completed' ? now : null,
        updatedAt:    now,
      };

      row = existing
        ? (await db.update(briefingTasks).set(values).where(eq(briefingTasks.id, existing.id)).returning())[0]
        : (await db.insert(briefingTasks).values(values).returning())[0];
    }

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitBriefing: ${err}` };
  }
}

// ─── Submit — grooming ────────────────────────────────────────────────────────

export async function submitGrooming(
  input: SubmitGroomingInput,
): Promise<TaskResult<GroomingTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    if (!input.selfiePhotos?.length)
      return { success: false, error: 'Foto selfie full body wajib diupload.' };

    const [existing] = await db.select().from(groomingTasks)
      .where(eq(groomingTasks.scheduleId, input.scheduleId as any)).limit(1);
    if (existing?.status === 'verified')
      return { success: false, error: 'Grooming task sudah diverifikasi.' };

    const [sched] = await db.select({ shiftId: schedules.shiftId }).from(schedules)
      .where(eq(schedules.id, input.scheduleId)).limit(1);

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

// ─── Verify ───────────────────────────────────────────────────────────────────

export const verifyCekBin = (i: VerifyTaskInput) =>
  runVerify(i,
    id => db.select({ id: cekBinTasks.id, status: cekBinTasks.status }).from(cekBinTasks).where(eq(cekBinTasks.id, id)).limit(1).then(r => r[0]),
    (id, p) => db.update(cekBinTasks).set(p).where(eq(cekBinTasks.id, id)).then(() => {}),
  );

export const verifyProductCheck = (i: VerifyTaskInput) =>
  runVerify(i,
    id => db.select({ id: productCheckTasks.id, status: productCheckTasks.status }).from(productCheckTasks).where(eq(productCheckTasks.id, id)).limit(1).then(r => r[0]),
    (id, p) => db.update(productCheckTasks).set(p).where(eq(productCheckTasks.id, id)).then(() => {}),
  );

export const verifyBriefing = (i: VerifyTaskInput) =>
  runVerify(i,
    id => db.select({ id: briefingTasks.id, status: briefingTasks.status }).from(briefingTasks).where(eq(briefingTasks.id, id)).limit(1).then(r => r[0]),
    (id, p) => db.update(briefingTasks).set(p).where(eq(briefingTasks.id, id)).then(() => {}),
  );

export const verifyGrooming = (i: VerifyTaskInput) =>
  runVerify(i,
    id => db.select({ id: groomingTasks.id, status: groomingTasks.status }).from(groomingTasks).where(eq(groomingTasks.id, id)).limit(1).then(r => r[0]),
    (id, p) => db.update(groomingTasks).set(p).where(eq(groomingTasks.id, id)).then(() => {}),
  );

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getTasksForSchedule(scheduleId: number) {
  const [
    cekBin, productCheck, itemDropping, briefing,
    edcReconciliation, eodZReport, openStatement, grooming,
  ] = await Promise.all([
    db.select().from(cekBinTasks)            .where(eq(cekBinTasks.scheduleId,            scheduleId)).limit(1),
    db.select().from(productCheckTasks)      .where(eq(productCheckTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(itemDroppingTasks)      .where(eq(itemDroppingTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(briefingTasks)          .where(eq(briefingTasks.scheduleId,          scheduleId)).limit(1),
    db.select().from(edcReconciliationTasks) .where(eq(edcReconciliationTasks.scheduleId, scheduleId)).limit(1),
    db.select().from(eodZReportTasks)        .where(eq(eodZReportTasks.scheduleId,        scheduleId)).limit(1),
    db.select().from(openStatementTasks)     .where(eq(openStatementTasks.scheduleId,     scheduleId)).limit(1),
    db.select().from(groomingTasks)          .where(eq(groomingTasks.scheduleId,          scheduleId as any)).limit(1),
  ]);

  return {
    cekBin:            cekBin[0]            ?? null,
    productCheck:      productCheck[0]      ?? null,
    itemDropping:      itemDropping[0]      ?? null,
    briefing:          briefing[0]          ?? null,
    edcReconciliation: edcReconciliation[0] ?? null,
    eodZReport:        eodZReport[0]        ?? null,
    openStatement:     openStatement[0]     ?? null,
    grooming:          grooming[0]          ?? null,
  };
}

export async function getDiscrepancyChain(table: any, originalTaskId: number): Promise<unknown[]> {
  return db.select().from(table)
    .where(or(eq(table.id, originalTaskId), eq(table.parentTaskId, originalTaskId)))
    .orderBy(table.createdAt);
}

export async function getDailyTaskSummary(storeId: number, date: Date) {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  function summarise(rows: { status: string | null; count: number }[]) {
    return {
      pending:     rows.find(r => r.status === 'pending')?.count     ?? 0,
      inProgress:  rows.find(r => r.status === 'in_progress')?.count ?? 0,
      completed:   rows.find(r => r.status === 'completed')?.count   ?? 0,
      discrepancy: rows.find(r => r.status === 'discrepancy')?.count ?? 0,
      verified:    rows.find(r => r.status === 'verified')?.count    ?? 0,
      rejected:    rows.find(r => r.status === 'rejected')?.count    ?? 0,
    };
  }

  const [
    cekBin, productCheck, itemDropping, briefing,
    edcReconciliation, eodZReport, openStatement, grooming,
  ] = await Promise.all([
    db.select({ status: cekBinTasks.status,            count: sql<number>`count(*)::int` }).from(cekBinTasks)
      .where(and(eq(cekBinTasks.storeId, storeId),            gte(cekBinTasks.date, dayStart),            lte(cekBinTasks.date, dayEnd))).groupBy(cekBinTasks.status).then(summarise),
    db.select({ status: productCheckTasks.status,      count: sql<number>`count(*)::int` }).from(productCheckTasks)
      .where(and(eq(productCheckTasks.storeId, storeId),      gte(productCheckTasks.date, dayStart),      lte(productCheckTasks.date, dayEnd))).groupBy(productCheckTasks.status).then(summarise),
    db.select({ status: itemDroppingTasks.status,      count: sql<number>`count(*)::int` }).from(itemDroppingTasks)
      .where(and(eq(itemDroppingTasks.storeId, storeId),      gte(itemDroppingTasks.date, dayStart),      lte(itemDroppingTasks.date, dayEnd))).groupBy(itemDroppingTasks.status).then(summarise),
    db.select({ status: briefingTasks.status,          count: sql<number>`count(*)::int` }).from(briefingTasks)
      .where(and(eq(briefingTasks.storeId, storeId),          gte(briefingTasks.date, dayStart),          lte(briefingTasks.date, dayEnd))).groupBy(briefingTasks.status).then(summarise),
    db.select({ status: edcReconciliationTasks.status, count: sql<number>`count(*)::int` }).from(edcReconciliationTasks)
      .where(and(eq(edcReconciliationTasks.storeId, storeId), gte(edcReconciliationTasks.date, dayStart), lte(edcReconciliationTasks.date, dayEnd))).groupBy(edcReconciliationTasks.status).then(summarise),
    db.select({ status: eodZReportTasks.status,        count: sql<number>`count(*)::int` }).from(eodZReportTasks)
      .where(and(eq(eodZReportTasks.storeId, storeId),        gte(eodZReportTasks.date, dayStart),        lte(eodZReportTasks.date, dayEnd))).groupBy(eodZReportTasks.status).then(summarise),
    db.select({ status: openStatementTasks.status,     count: sql<number>`count(*)::int` }).from(openStatementTasks)
      .where(and(eq(openStatementTasks.storeId, storeId),     gte(openStatementTasks.date, dayStart),     lte(openStatementTasks.date, dayEnd))).groupBy(openStatementTasks.status).then(summarise),
    db.select({ status: groomingTasks.status,          count: sql<number>`count(*)::int` }).from(groomingTasks)
      .where(and(eq(groomingTasks.storeId, storeId),          gte(groomingTasks.date, dayStart),          lte(groomingTasks.date, dayEnd))).groupBy(groomingTasks.status).then(summarise),
  ]);

  return { cekBin, productCheck, itemDropping, briefing, edcReconciliation, eodZReport, openStatement, grooming };
}

function parsePhotosField(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw !== 'string') return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

function buildExtra(row: Record<string, unknown>, photoFields: string[] = []): Record<string, unknown> {
  // Fields that live on TaskBase / FlatTask top-level — skip from `extra`
  const skip = new Set([
    'id', 'scheduleId', 'userId', 'storeId', 'shiftId', 'date',
    'status', 'notes', 'completedAt', 'verifiedBy', 'verifiedAt',
    'createdAt', 'updatedAt', 'submittedLat', 'submittedLng',
    'isBalanced', 'parentTaskId',
    // Discrepancy timing columns — surfaced via dedicated pages, not needed in card extra
    'discrepancyStartedAt', 'discrepancyResolvedAt', 'discrepancyDurationMinutes',
    'expectedFetchedAt', 'expectedSnapshot',
    'expectedAmount', 'actualAmount', 'totalNominal',
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k)) continue;
    extra[k] = photoFields.includes(k) ? parsePhotosField(v) : v;
  }
  return extra;
}

export async function getFlatTasksForStoreDate(storeId: number, date: Date): Promise<FlatTask[]> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftCodeById = new Map<number, 'morning' | 'evening' | 'full_day'>(
    shiftRows.map(s => [s.id, s.code as 'morning' | 'evening' | 'full_day']),
  );

  async function loadTable(table: any, type: string, photoFields: string[]): Promise<FlatTask[]> {
    const rows = await db.select({ task: table, userName: users.name })
      .from(table).leftJoin(users, eq(table.userId, users.id))
      .where(and(eq(table.storeId, storeId), gte(table.date, dayStart), lte(table.date, dayEnd)));

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
        isBalanced:  t.isBalanced ?? null,
        parentTaskId: t.parentTaskId ?? null,
        extra:       buildExtra(t, photoFields),
      };
    });
  }

  const [
    cekBin, productCheck, itemDropping, briefing,
    edcReconciliation, eodZReport, openStatement, grooming,
  ] = await Promise.all([
    loadTable(cekBinTasks,            'cek_bin',            []),
    loadTable(productCheckTasks,      'product_check',      []),
    loadTable(itemDroppingTasks,      'item_dropping',      ['droppingPhotos', 'receivePhotos']),
    loadTable(briefingTasks,          'briefing',           []),
    loadTable(edcReconciliationTasks, 'edc_reconciliation', []),
    loadTable(eodZReportTasks,        'eod_z_report',       ['zReportPhotos']),
    loadTable(openStatementTasks,     'open_statement',     []),
    loadTable(groomingTasks,          'grooming',           ['selfiePhotos']),
  ]);

  const all = [
    ...cekBin, ...productCheck, ...itemDropping, ...briefing,
    ...edcReconciliation, ...eodZReport, ...openStatement, ...grooming,
  ];

  const shiftOrder: Record<string, number> = { morning: 0, full_day: 1, evening: 2 };
  all.sort((a, b) => {
    const sa = a.shift ? shiftOrder[a.shift] ?? 3 : 3;
    const sb = b.shift ? shiftOrder[b.shift] ?? 3 : 3;
    if (sa !== sb) return sa - sb;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return (a.userName ?? '').localeCompare(b.userName ?? '');
  });
  return all;
}

export function summariseTasks(tasks: FlatTask[]): StoreTaskSummary {
  const s: StoreTaskSummary = {
    pending: 0, inProgress: 0, completed: 0,
    discrepancy: 0, verified: 0, rejected: 0, total: tasks.length,
  };
  for (const t of tasks) {
    switch (t.status) {
      case 'pending':     s.pending++;     break;
      case 'in_progress': s.inProgress++;  break;
      case 'completed':   s.completed++;   break;
      case 'discrepancy': s.discrepancy++; break;
      case 'verified':    s.verified++;    break;
      case 'rejected':    s.rejected++;    break;
    }
  }
  return s;
}

export async function getAreaTaskOverview(opsUserId: string, date: Date) {
  const [opsUser] = await db.select({ areaId: users.areaId }).from(users)
    .where(eq(users.id, opsUserId)).limit(1);
  if (!opsUser?.areaId) return { area: null, stores: [] };

  const [area] = await db.select({ id: areas.id, name: areas.name }).from(areas)
    .where(eq(areas.id, opsUser.areaId)).limit(1);

  const areaStores = await db.select({ id: stores.id, name: stores.name, address: stores.address })
    .from(stores).where(eq(stores.areaId, opsUser.areaId)).orderBy(stores.name);

  const results = await Promise.all(areaStores.map(async (s) => {
    const daily = await getDailyTaskSummary(s.id, date);
    const summary: StoreTaskSummary = {
      pending: 0, inProgress: 0, completed: 0,
      discrepancy: 0, verified: 0, rejected: 0, total: 0,
    };
    for (const perType of Object.values(daily)) {
      summary.pending     += perType.pending;
      summary.inProgress  += perType.inProgress;
      summary.completed   += perType.completed;
      summary.discrepancy += perType.discrepancy;
      summary.verified    += perType.verified;
      summary.rejected    += perType.rejected;
    }
    summary.total =
      summary.pending + summary.inProgress + summary.completed +
      summary.discrepancy + summary.verified + summary.rejected;
    return { ...s, summary };
  }));

  return { area: area ?? null, stores: results };
}

// ─── Verify dispatch ──────────────────────────────────────────────────────────

const VERIFY_DISPATCH: Record<string, (i: VerifyTaskInput) => Promise<TaskResult<void>>> = {
  cek_bin:       verifyCekBin,
  product_check: verifyProductCheck,
  briefing:      verifyBriefing,
  grooming:      verifyGrooming,

  item_dropping: async (i) => {
    const { verifyItemDropping } = await import('@/lib/db/utils/item-dropping');
    return verifyItemDropping(i);
  },

  edc_reconciliation: async (i) => {
    const { verifyEdcReconciliation } = await import('@/lib/db/utils/edc-reconciliation');
    return verifyEdcReconciliation(i);
  },

  // EOD Z-Report is not discrepancy-capable; verify inline (no dedicated util needed)
  eod_z_report: async (i) => {
    const auth = await canManageSchedule(i.actorId, i.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason! };
    const [row] = await db
      .select({ id: eodZReportTasks.id, status: eodZReportTasks.status })
      .from(eodZReportTasks)
      .where(eq(eodZReportTasks.id, i.taskId))
      .limit(1);
    if (!row) return { success: false, error: 'Task tidak ditemukan.' };
    if (row.status !== 'completed')
      return { success: false, error: `Tidak bisa verifikasi task dengan status "${row.status}".` };
    await db.update(eodZReportTasks).set({
      status:     i.approve ? 'verified' : 'rejected',
      verifiedBy: i.actorId,
      verifiedAt: new Date(),
      notes:      i.notes,
      updatedAt:  new Date(),
    }).where(eq(eodZReportTasks.id, i.taskId));
    return { success: true, data: undefined };
  },

  open_statement: async (i) => {
    const { verifyOpenStatement } = await import('@/lib/db/utils/open-statement');
    return verifyOpenStatement(i);
  },
};

export async function verifyTaskByType(
  type:  string,
  input: VerifyTaskInput,
): Promise<TaskResult<void>> {
  const fn = VERIFY_DISPATCH[type];
  if (!fn) return { success: false, error: `Unknown task type: ${type}` };
  return fn(input);
}
// lib/db/utils/tasks.ts
import { db }                                          from '@/lib/db';
import { eq, and, gte, lte, inArray, sql, isNull, or } from 'drizzle-orm';
import {
  schedules, stores, shifts, attendance,
  monthlySchedules, monthlyScheduleEntries,
  storeFrontTasks,
  cekBinTasks,
  storeBins,
  cekBinTaskBins,
  vmChecklistTasks,
  marketingCheckTasks,
  briefingTasks,
  edcReconciliationTasks,
  eodZReportTasks,
  openStatementTasks,
  groomingTasks, itemDroppingTasks,
  type StoreFrontTask,
  type CekBinTask,
  type VmChecklistTask,
  type BriefingTask,
  type GroomingTask,
} from '@/lib/db/schema';
import { users, areas }      from '@/lib/db/schema';
import { getOrCreateMarketingCheckForSchedule } from '@/lib/db/utils/marketing-check';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

const PENDING_STATUSES: readonly ['pending', 'in_progress'] = ['pending', 'in_progress'] as const;
const ACTIVE_STATUSES: readonly ['pending', 'in_progress', 'discrepancy'] = ['pending', 'in_progress', 'discrepancy'] as const;
const FINAL_STATUSES: readonly ['completed'] = ['completed'] as const;

function isFinalStatus(status: string | null | undefined): boolean {
  return FINAL_STATUSES.includes(status as 'completed');
}

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

export interface SubmitStoreFrontInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;

  storefrontPhotos:       string[];
  rollingDoorClosedPhoto: string;

  notes?:   string;
  skipGeo?: boolean;
}

export interface SubmitVmChecklistInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;

  shoeLaceShoeFillerPriceTagHangtagLabelK3L: boolean;
  lastPairAndPigskinHangtag: boolean;
  popPromoUpdate: boolean;
  displayTableWallShelvingShowcaseHangbarStackingPedestal: boolean;
  floorDisplayCleanliness: boolean;
  vmToolsStorage: boolean;

  notes?:   string;
  skipGeo?: boolean;
}

export interface CekBinSelectedBinInput {
  binId: number;
  qtyBc: number;
  qtySesuaiBin: number;
  qtyTidakSesuaiBin: number;
  notes?: string;
}

export interface SubmitCekBinInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  shiftId?:   number;
  geo:        GeoPoint;

  selectedBins: CekBinSelectedBinInput[];

  notes?:   string;
  skipGeo?: boolean;
}

export interface AutoSaveCekBinInput {
  selectedBins?: CekBinSelectedBinInput[];
  notes?: string;
}

export interface CekBinWithBins extends CekBinTask {
  availableBins: Array<{
    id: number;
    storeId: number;
    bin: string;
    qtyBc: number;
    qtySesuaiBin: number;
    qtyTidakSesuaiBin: number;
    nama: string;
  }>;
  checkedBins: Array<{
    id: number;
    taskId: number;
    binId: number;
    bin: string;
    qtyBc: number;
    qtySesuaiBin: number;
    qtyTidakSesuaiBin: number;
    nama: string;
    notes: string | null;
  }>;
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
  isBalanced:   boolean | null;
  parentTaskId: number | null;
  extra:        Record<string, unknown>;
}

export interface StoreTaskSummary {
  pending:     number;
  inProgress:  number;
  completed:   number;
  discrepancy: number;
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

function parseJsonPhotos(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${field} harus berupa angka bulat 0 atau lebih.`);
  }
  return n;
}

function minimumBinsToCheck(totalActiveBins: number): number {
  if (totalActiveBins <= 0) return 0;
  return Math.ceil(totalActiveBins * 0.3);
}

async function getActiveStoreBins(storeId: number) {
  return db
    .select({
      id: storeBins.id,
      storeId: storeBins.storeId,
      bin: storeBins.bin,
      qtyBc: storeBins.qtyBc,
      qtySesuaiBin: storeBins.qtySesuaiBin,
      qtyTidakSesuaiBin: storeBins.qtyTidakSesuaiBin,
      nama: storeBins.nama,
    })
    .from(storeBins)
    .where(and(eq(storeBins.storeId, storeId), eq(storeBins.isActive, true)))
    .orderBy(storeBins.bin);
}

async function findCekBinByStoreDate(storeId: number, date: Date): Promise<CekBinTask | null> {
  const [row] = await db
    .select()
    .from(cekBinTasks)
    .where(and(
      eq(cekBinTasks.storeId, storeId),
      gte(cekBinTasks.date, startOfDay(date)),
      lte(cekBinTasks.date, endOfDay(date)),
    ))
    .limit(1);

  return row ?? null;
}

async function getCheckedBins(taskId: number) {
  return db
    .select({
      id: cekBinTaskBins.id,
      taskId: cekBinTaskBins.taskId,
      binId: cekBinTaskBins.binId,
      bin: cekBinTaskBins.bin,
      qtyBc: cekBinTaskBins.qtyBc,
      qtySesuaiBin: cekBinTaskBins.qtySesuaiBin,
      qtyTidakSesuaiBin: cekBinTaskBins.qtyTidakSesuaiBin,
      nama: cekBinTaskBins.nama,
      notes: cekBinTaskBins.notes,
    })
    .from(cekBinTaskBins)
    .where(eq(cekBinTaskBins.taskId, taskId))
    .orderBy(cekBinTaskBins.bin);
}

function validateSelectedBins(
  selectedBins: CekBinSelectedBinInput[],
  activeBins: Awaited<ReturnType<typeof getActiveStoreBins>>,
): string | null {
  const activeById = new Map(activeBins.map((b) => [b.id, b]));
  const seen = new Set<number>();

  for (const item of selectedBins) {
    if (!Number.isInteger(item.binId)) return 'Ada BIN yang tidak valid.';
    if (!activeById.has(item.binId)) return `BIN ID ${item.binId} tidak ditemukan di store ini atau sudah tidak aktif.`;
    if (seen.has(item.binId)) return `BIN ID ${item.binId} dipilih lebih dari satu kali.`;
    seen.add(item.binId);

    try {
      toNonNegativeInt(item.qtyBc, 'QTY BC');
      toNonNegativeInt(item.qtySesuaiBin, 'QTY SESUAI BIN');
      toNonNegativeInt(item.qtyTidakSesuaiBin, 'QTY TIDAK SESUAI BIN');
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  const min = minimumBinsToCheck(activeBins.length);
  if (activeBins.length > 0 && selectedBins.length < min) {
    return `Minimal cek ${min} BIN, yaitu 30% dari total ${activeBins.length} BIN aktif di store.`;
  }

  return null;
}

async function replaceCheckedBins(
  taskId: number,
  selectedBins: CekBinSelectedBinInput[],
  storeId: number,
): Promise<void> {
  const activeBins = await getActiveStoreBins(storeId);
  const activeById = new Map(activeBins.map((b) => [b.id, b]));

  await db.delete(cekBinTaskBins).where(eq(cekBinTaskBins.taskId, taskId));

  if (!selectedBins.length) return;

  await db.insert(cekBinTaskBins).values(
    selectedBins.map((item) => {
      const master = activeById.get(item.binId);
      if (!master) throw new Error(`BIN ID ${item.binId} tidak valid.`);

      return {
        taskId,
        binId: item.binId,
        bin: master.bin,
        nama: master.nama,
        qtyBc: toNonNegativeInt(item.qtyBc, 'QTY BC'),
        qtySesuaiBin: toNonNegativeInt(item.qtySesuaiBin, 'QTY SESUAI BIN'),
        qtyTidakSesuaiBin: toNonNegativeInt(item.qtyTidakSesuaiBin, 'QTY TIDAK SESUAI BIN'),
        notes: item.notes,
        updatedAt: new Date(),
      };
    }),
  );
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
      inArray(table.status, ACTIVE_STATUSES),
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

    await insertShared('storeFront',
      () => db.select({ id: storeFrontTasks.id }).from(storeFrontTasks)
        .where(and(eq(storeFrontTasks.storeId, sched.storeId), eq(storeFrontTasks.date, dayStart)))
        .limit(1).then(r => r[0]),
      () => db.insert(storeFrontTasks).values(base));

    await insertShared('cekBin',
      () => db.select({ id: cekBinTasks.id }).from(cekBinTasks)
        .where(and(eq(cekBinTasks.storeId, sched.storeId), eq(cekBinTasks.date, dayStart)))
        .limit(1).then(r => r[0]),
      () => db.insert(cekBinTasks).values(base));

    await insertShared('vmChecklist',
      () => db.select({ id: vmChecklistTasks.id }).from(vmChecklistTasks)
        .where(and(eq(vmChecklistTasks.storeId, sched.storeId), eq(vmChecklistTasks.date, dayStart)))
        .limit(1).then(r => r[0]),
      () => db.insert(vmChecklistTasks).values(base));

    try {
      const r = await getOrCreateMarketingCheckForSchedule(
        scheduleId,
        sched.userId,
        sched.storeId,
        morningId,
        dayStart,
      );

      if (r.success) {
        created.push('marketingCheck');
      } else {
        errors.push(`marketingCheck: ${r.error}`);
      }
    } catch (err) {
      errors.push(`marketingCheck: ${err}`);
    }

    // Item Dropping — no unique(storeId, date) constraint, check active row
    await insertShared('itemDropping',
      () => db.select({ id: itemDroppingTasks.id }).from(itemDroppingTasks)
        .where(and(
          eq(itemDroppingTasks.storeId, sched.storeId),
          eq(itemDroppingTasks.date, dayStart),
          inArray(itemDroppingTasks.status, ACTIVE_STATUSES),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(itemDroppingTasks).values({ ...base, hasDropping: false }));
  }

  // ── Evening ────────────────────────────────────────────────────────────────
  if (isEvening) {
    const base = { ...baseCommon, shiftId: eveningId };

    async function eveningActive(table: any): Promise<{ id: number } | undefined> {
      return db.select({ id: table.id }).from(table)
        .where(and(
          eq(table.storeId, sched.storeId),
          eq(table.date, dayStart),
          inArray(table.status, ACTIVE_STATUSES),
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
    await Promise.all([
    // Morning tasks
    db.delete(cekBinTasks)
      .where(and(eq(cekBinTasks.scheduleId, scheduleId), inArray(cekBinTasks.status, PENDING_STATUSES))),
    db.delete(storeFrontTasks)
      .where(and(eq(storeFrontTasks.scheduleId, scheduleId), inArray(storeFrontTasks.status, PENDING_STATUSES))),
    db.delete(vmChecklistTasks)
      .where(and(eq(vmChecklistTasks.scheduleId, scheduleId), inArray(vmChecklistTasks.status, PENDING_STATUSES))),
    db.delete(marketingCheckTasks)
      .where(and(
        eq(marketingCheckTasks.scheduleId, scheduleId),
        inArray(marketingCheckTasks.status, PENDING_STATUSES),
      )),
    db.delete(itemDroppingTasks)
      .where(and(eq(itemDroppingTasks.scheduleId, scheduleId), inArray(itemDroppingTasks.status, ACTIVE_STATUSES))),
    // Evening tasks
    db.delete(briefingTasks)
      .where(and(eq(briefingTasks.scheduleId, scheduleId), inArray(briefingTasks.status, ACTIVE_STATUSES))),
    // edcReconciliation cascade-deletes its edc_transaction_rows children automatically
    db.delete(edcReconciliationTasks)
      .where(and(eq(edcReconciliationTasks.scheduleId, scheduleId), inArray(edcReconciliationTasks.status, ACTIVE_STATUSES))),
    db.delete(eodZReportTasks)
      .where(and(eq(eodZReportTasks.scheduleId, scheduleId), inArray(eodZReportTasks.status, ACTIVE_STATUSES))),
    db.delete(openStatementTasks)
      .where(and(eq(openStatementTasks.scheduleId, scheduleId), inArray(openStatementTasks.status, ACTIVE_STATUSES))),
    // Personal
    db.delete(groomingTasks)
      .where(and(eq(groomingTasks.scheduleId, scheduleId as any), inArray(groomingTasks.status, PENDING_STATUSES))),
  ]);
}

// ─── Submit — morning tasks ───────────────────────────────────────────────────

export async function submitStoreFront(
  input: SubmitStoreFrontInput,
): Promise<TaskResult<StoreFrontTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const storefrontPhotos = [...new Set((input.storefrontPhotos ?? []).filter(Boolean))];

    if (storefrontPhotos.length < 2) {
      return { success: false, error: 'Minimal upload 2 foto orang di storefront.' };
    }

    if (storefrontPhotos.length > 3) {
      return { success: false, error: 'Maksimal upload 3 foto orang di storefront.' };
    }

    if (!input.rollingDoorClosedPhoto) {
      return { success: false, error: 'Foto rolling door tertutup wajib diupload.' };
    }

    const [existing] = await db.select().from(storeFrontTasks)
      .where(eq(storeFrontTasks.scheduleId, input.scheduleId))
      .limit(1);
    if (isFinalStatus(existing?.status)) {
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };
    }

    const shiftMap = await getShiftIdMap();
    const now = new Date();

    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: shiftMap['morning'],
      date: startOfDay(now),

      storefrontPhotos: jsonPhotos(storefrontPhotos),
      rollingDoorClosedPhoto: input.rollingDoorClosedPhoto,

      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
    };

    const row = existing
      ? (await db.update(storeFrontTasks).set(values).where(eq(storeFrontTasks.id, existing.id)).returning())[0]
      : (await db.insert(storeFrontTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitStoreFront: ${err}` };
  }
}

export async function submitVmChecklist(
  input: SubmitVmChecklistInput,
): Promise<TaskResult<VmChecklistTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [existing] = await db.select().from(vmChecklistTasks)
      .where(eq(vmChecklistTasks.scheduleId, input.scheduleId))
      .limit(1);
    if (isFinalStatus(existing?.status)) {
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };
    }

    const shiftMap = await getShiftIdMap();
    const now = new Date();

    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: shiftMap['morning'],
      date: startOfDay(now),

      shoeLaceShoeFillerPriceTagHangtagLabelK3L:
        input.shoeLaceShoeFillerPriceTagHangtagLabelK3L,
      lastPairAndPigskinHangtag:
        input.lastPairAndPigskinHangtag,
      popPromoUpdate:
        input.popPromoUpdate,
      displayTableWallShelvingShowcaseHangbarStackingPedestal:
        input.displayTableWallShelvingShowcaseHangbarStackingPedestal,
      floorDisplayCleanliness:
        input.floorDisplayCleanliness,
      vmToolsStorage:
        input.vmToolsStorage,

      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
    };

    const row = existing
      ? (await db.update(vmChecklistTasks).set(values).where(eq(vmChecklistTasks.id, existing.id)).returning())[0]
      : (await db.insert(vmChecklistTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitVmChecklist: ${err}` };
  }
}

export async function submitCekBin(
  input: SubmitCekBinInput,
): Promise<TaskResult<CekBinWithBins>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const activeBins = await getActiveStoreBins(input.storeId);
    const validationErr = validateSelectedBins(input.selectedBins, activeBins);
    if (validationErr) return { success: false, error: validationErr };

    const now = new Date();
    const min = minimumBinsToCheck(activeBins.length);

    let task = await findCekBinByStoreDate(input.storeId, now);
    if (isFinalStatus(task?.status)) {
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };
    }

    const shiftMap = await getShiftIdMap();
    const shiftId = input.shiftId ?? task?.shiftId ?? shiftMap['morning'];

    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId,
      date: startOfDay(now),
      totalStoreBins: activeBins.length,
      minimumBinsToCheck: min,
      checkedBinsCount: input.selectedBins.length,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
    };

    if (task) {
      const [updated] = await db
        .update(cekBinTasks)
        .set(values)
        .where(eq(cekBinTasks.id, task.id))
        .returning();
      task = updated;
    } else {
      const [created] = await db.insert(cekBinTasks).values(values).returning();
      task = created;
    }

    await replaceCheckedBins(task.id, input.selectedBins, input.storeId);

    return getCekBinById(task.id);
  } catch (err) {
    return { success: false, error: `submitCekBin: ${err}` };
  }
}

export async function autoSaveCekBin(
  taskId: number,
  patch: AutoSaveCekBinInput,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [task] = await db.select().from(cekBinTasks).where(eq(cekBinTasks.id, taskId)).limit(1);
    if (!task) return { success: false, error: 'Task Cek BIN tidak ditemukan.' };
    if (isFinalStatus(task.status)) return { success: true, data: { saved: [] } };

    const saved: string[] = [];
    const update: Partial<typeof cekBinTasks.$inferInsert> = { updatedAt: new Date() };

    if ('notes' in patch) {
      update.notes = patch.notes;
      saved.push('notes');
    }

    if (patch.selectedBins) {
      const activeBins = await getActiveStoreBins(task.storeId);
      const activeById = new Map(activeBins.map((b) => [b.id, b]));
      const uniqueIds = [...new Set(patch.selectedBins.map((b) => b.binId))];

      for (const binId of uniqueIds) {
        if (!activeById.has(binId)) {
          return { success: false, error: `BIN ID ${binId} tidak ditemukan di store ini atau sudah tidak aktif.` };
        }
      }

      await replaceCheckedBins(task.id, patch.selectedBins, task.storeId);
      update.checkedBinsCount = uniqueIds.length;
      update.totalStoreBins = activeBins.length;
      update.minimumBinsToCheck = minimumBinsToCheck(activeBins.length);
      saved.push('selectedBins');
    }

    if (task.status === 'pending') update.status = 'in_progress';

    await db.update(cekBinTasks).set(update).where(eq(cekBinTasks.id, task.id));

    return { success: true, data: { saved } };
  } catch (err) {
    return { success: false, error: `autoSaveCekBin: ${err}` };
  }
}

export async function getCekBinById(id: number): Promise<TaskResult<CekBinWithBins>> {
  try {
    const [task] = await db.select().from(cekBinTasks).where(eq(cekBinTasks.id, id)).limit(1);
    if (!task) return { success: false, error: 'Task Cek BIN tidak ditemukan.' };

    const [availableBins, checkedBins] = await Promise.all([
      getActiveStoreBins(task.storeId),
      getCheckedBins(task.id),
    ]);

    return {
      success: true,
      data: {
        ...task,
        availableBins,
        checkedBins,
      },
    };
  } catch (err) {
    return { success: false, error: `getCekBinById: ${err}` };
  }
}

export async function listStoreBins(storeId: number) {
  return getActiveStoreBins(storeId);
}

export async function upsertStoreBins(
  storeId: number,
  bins: Array<{
    bin: string;
    qtyBc: number;
    qtySesuaiBin: number;
    qtyTidakSesuaiBin: number;
    nama: string;
  }>,
): Promise<TaskResult<{ count: number }>> {
  try {
    if (!bins.length) return { success: true, data: { count: 0 } };

    await db.insert(storeBins).values(
      bins.map((b) => ({
        storeId,
        bin: b.bin.trim(),
        qtyBc: toNonNegativeInt(b.qtyBc, 'QTY BC'),
        qtySesuaiBin: toNonNegativeInt(b.qtySesuaiBin, 'QTY SESUAI BIN'),
        qtyTidakSesuaiBin: toNonNegativeInt(b.qtyTidakSesuaiBin, 'QTY TIDAK SESUAI BIN'),
        nama: b.nama.trim(),
        isActive: true,
        updatedAt: new Date(),
      })),
    ).onConflictDoUpdate({
      target: [storeBins.storeId, storeBins.bin],
      set: {
        qtyBc: sql`excluded.qty_bc`,
        qtySesuaiBin: sql`excluded.qty_sesuai_bin`,
        qtyTidakSesuaiBin: sql`excluded.qty_tidak_sesuai_bin`,
        nama: sql`excluded.nama`,
        isActive: true,
        updatedAt: new Date(),
      },
    });

    return { success: true, data: { count: bins.length } };
  } catch (err) {
    return { success: false, error: `upsertStoreBins: ${err}` };
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
      if (isFinalStatus(existing?.status))
        return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };

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
    if (isFinalStatus(existing?.status))
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };

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

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getTasksForSchedule(scheduleId: number) {
  const [
    storeFront, cekBin, vmChecklist, marketingCheck, itemDropping, briefing,
    edcReconciliation, eodZReport, openStatement, grooming,
  ] = await Promise.all([
    db.select().from(storeFrontTasks)        .where(eq(storeFrontTasks.scheduleId,        scheduleId)).limit(1),
    db.select().from(cekBinTasks)            .where(eq(cekBinTasks.scheduleId,            scheduleId)).limit(1),
    db.select().from(vmChecklistTasks)       .where(eq(vmChecklistTasks.scheduleId,       scheduleId)).limit(1),
    db.select().from(marketingCheckTasks)    .where(eq(marketingCheckTasks.scheduleId,    scheduleId)).limit(1),
    db.select().from(itemDroppingTasks)      .where(eq(itemDroppingTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(briefingTasks)          .where(eq(briefingTasks.scheduleId,          scheduleId)).limit(1),
    db.select().from(edcReconciliationTasks) .where(eq(edcReconciliationTasks.scheduleId, scheduleId)).limit(1),
    db.select().from(eodZReportTasks)        .where(eq(eodZReportTasks.scheduleId,        scheduleId)).limit(1),
    db.select().from(openStatementTasks)     .where(eq(openStatementTasks.scheduleId,     scheduleId)).limit(1),
    db.select().from(groomingTasks)          .where(eq(groomingTasks.scheduleId,          scheduleId as any)).limit(1),
  ]);

  return {
    storeFront:        storeFront[0]        ?? null,
    cekBin:            cekBin[0]            ?? null,
    vmChecklist:       vmChecklist[0]       ?? null,
    marketingCheck:    marketingCheck[0]    ?? null,
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
    };
  }

  const [
    storeFront, cekBin, vmChecklist, marketingCheck, itemDropping, briefing,
    edcReconciliation, eodZReport, openStatement, grooming,
  ] = await Promise.all([
    db.select({ status: storeFrontTasks.status,        count: sql<number>`count(*)::int` }).from(storeFrontTasks)
      .where(and(eq(storeFrontTasks.storeId, storeId),        gte(storeFrontTasks.date, dayStart),        lte(storeFrontTasks.date, dayEnd))).groupBy(storeFrontTasks.status).then(summarise),
    db.select({ status: cekBinTasks.status,            count: sql<number>`count(*)::int` }).from(cekBinTasks)
      .where(and(eq(cekBinTasks.storeId, storeId),            gte(cekBinTasks.date, dayStart),            lte(cekBinTasks.date, dayEnd))).groupBy(cekBinTasks.status).then(summarise),
    db.select({ status: vmChecklistTasks.status,       count: sql<number>`count(*)::int` }).from(vmChecklistTasks)
      .where(and(eq(vmChecklistTasks.storeId, storeId),       gte(vmChecklistTasks.date, dayStart),       lte(vmChecklistTasks.date, dayEnd))).groupBy(vmChecklistTasks.status).then(summarise),
    db.select({ status: marketingCheckTasks.status,    count: sql<number>`count(*)::int` }).from(marketingCheckTasks)
      .where(and(eq(marketingCheckTasks.storeId, storeId),    gte(marketingCheckTasks.date, dayStart),    lte(marketingCheckTasks.date, dayEnd))).groupBy(marketingCheckTasks.status).then(summarise),
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

  return { storeFront, cekBin, vmChecklist, marketingCheck, itemDropping, briefing, edcReconciliation, eodZReport, openStatement, grooming };
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
    'status', 'notes', 'completedAt',
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
        isBalanced:  t.isBalanced ?? null,
        parentTaskId: t.parentTaskId ?? null,
        extra:       buildExtra(t, photoFields),
      };
    });
  }

  const [
    storeFront, cekBin, vmChecklist, marketingCheck, itemDropping, briefing,
    edcReconciliation, eodZReport, openStatement, grooming,
  ] = await Promise.all([
    loadTable(storeFrontTasks,        'store_front',        ['storefrontPhotos', 'rollingDoorClosedPhoto']),
    loadTable(cekBinTasks,            'cek_bin',            []),
    loadTable(vmChecklistTasks,       'vm_checklist',       []),
    loadTable(marketingCheckTasks,    'marketing_check',    []),
    loadTable(itemDroppingTasks,      'item_dropping',      ['droppingPhotos', 'receivePhotos']),
    loadTable(briefingTasks,          'briefing',           []),
    loadTable(edcReconciliationTasks, 'edc_reconciliation', []),
    loadTable(eodZReportTasks,        'eod_z_report',       ['zReportPhotos']),
    loadTable(openStatementTasks,     'open_statement',     []),
    loadTable(groomingTasks,          'grooming',           ['selfiePhotos']),
  ]);

  const all = [
    ...storeFront, ...cekBin, ...vmChecklist, ...marketingCheck, ...itemDropping, ...briefing,
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
    discrepancy: 0, total: tasks.length,
  };
  for (const t of tasks) {
    switch (t.status) {
      case 'pending':     s.pending++;     break;
      case 'in_progress': s.inProgress++;  break;
      case 'completed':   s.completed++;   break;
      case 'discrepancy': s.discrepancy++; break;
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
      discrepancy: 0, total: 0,
    };
    for (const perType of Object.values(daily)) {
      summary.pending     += perType.pending;
      summary.inProgress  += perType.inProgress;
      summary.completed   += perType.completed;
      summary.discrepancy += perType.discrepancy;
    }
    summary.total =
      summary.pending + summary.inProgress + summary.completed +
      summary.discrepancy;
    return { ...s, summary };
  }));

  return { area: area ?? null, stores: results };
}

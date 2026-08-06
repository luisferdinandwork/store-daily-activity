// lib/db/utils/tasks.ts
import { db }                                          from '@/lib/db';
import { eq, and, gte, lte, inArray, sql, isNull, or } from 'drizzle-orm';
import {
  schedules, stores, shifts, attendance,
  monthlySchedules, monthlyScheduleEntries,

  storeOpeningTasks,
  setoranTasks,

  storeFrontTasks,
  cekBinTasks,
  storeBins,
  cekBinTaskBins,
  vmChecklistTasks,
  marketingCheckTasks,
  briefingTasks,
  storeClosingTasks,
  groomingTasks,
  itemDroppingTasks,
  itemReturnTasks,
  itemReturnEntries,
  cekUangModalTasks,
  cekUangModalDenominations,

  type StoreOpeningTask,
  type SetoranTask,
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

const PENDING_STATUSES: readonly ['not_started', 'in_progress'] = ['not_started', 'in_progress'] as const;
const ACTIVE_STATUSES: readonly ['not_started', 'in_progress', 'pending'] = ['not_started', 'in_progress', 'pending'] as const;
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
   * false → status becomes 'pending'; task carries to next shift
   */
  isBalanced:   boolean;
  notes?:       string;
  skipGeo?:     boolean;
  /**
   * Set when continuing a pending (unresolved discrepancy) task from a prior shift.
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
  id:              number;
  type:            string;
  scheduleId:      number;
  userId:          string;
  userName:        string | null;
  completedBy:     string | null;
  completedByName: string | null;
  verifiedBy:      string | null;
  verifiedByName:  string | null;
  verifiedAt:      string | null;
  storeId:         number;
  shift:           'morning' | 'evening' | 'full_day' | null;
  date:            string;
  status:          string | null;
  notes:           string | null;
  completedAt:     string | null;
  isBalanced:      boolean | null;
  parentTaskId:    number | null;
  extra:           Record<string, unknown>;
}

export interface StoreTaskSummary {
  notStarted: number;
  inProgress: number;
  completed:  number;
  pending:    number;
  total:      number;
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
 * Returns the active (not_started / in_progress / pending) task for a store on
 * a given date. Also surfaces unresolved discrepancies (status 'pending') from
 * prior days.
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
    .where(and(eq(table.storeId, storeId), eq(table.status, 'pending'), isNull(table.parentTaskId)))
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

  const baseCommon = { scheduleId, userId: sched.userId, storeId: sched.storeId, date: dayStart, status: 'not_started' as const };

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

    await insertShared('storeOpening',
      () => db.select({ id: storeOpeningTasks.id }).from(storeOpeningTasks)
        .where(and(
          eq(storeOpeningTasks.storeId, sched.storeId),
          eq(storeOpeningTasks.date, dayStart),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(storeOpeningTasks).values(base));

    await insertShared('setoran',
      () => db.select({ id: setoranTasks.id }).from(setoranTasks)
        .where(and(
          eq(setoranTasks.storeId, sched.storeId),
          eq(setoranTasks.date, dayStart),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(setoranTasks).values({
        ...base,
        carriedDeficit: '0',
        unpaidAmount: '0',
      }));

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

    // Item Dropping / Item Return / Cek Uang Modal — now genuinely per-shift
    // (see lib/db/utils/item-dropping.ts etc.), so the existence check must
    // also filter by shiftId or the evening block below would find this
    // morning row and skip creating its own.
    await insertShared('itemDroppingMorning',
      () => db.select({ id: itemDroppingTasks.id }).from(itemDroppingTasks)
        .where(and(
          eq(itemDroppingTasks.storeId, sched.storeId),
          eq(itemDroppingTasks.shiftId, morningId),
          eq(itemDroppingTasks.date, dayStart),
          inArray(itemDroppingTasks.status, ACTIVE_STATUSES),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(itemDroppingTasks).values({ ...base, hasDropping: false }));

    await insertShared('itemReturnMorning',
      () => db.select({ id: itemReturnTasks.id }).from(itemReturnTasks)
        .where(and(
          eq(itemReturnTasks.storeId, sched.storeId),
          eq(itemReturnTasks.shiftId, morningId),
          eq(itemReturnTasks.date, dayStart),
          inArray(itemReturnTasks.status, ACTIVE_STATUSES),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(itemReturnTasks).values({ ...base, hasReturn: false }));

    await insertShared('cekUangModalMorning',
      () => db.select({ id: cekUangModalTasks.id }).from(cekUangModalTasks)
        .where(and(
          eq(cekUangModalTasks.storeId, sched.storeId),
          eq(cekUangModalTasks.shiftId, morningId),
          eq(cekUangModalTasks.date, dayStart),
          inArray(cekUangModalTasks.status, ACTIVE_STATUSES),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(cekUangModalTasks).values({ ...base, totalAmount: '0' }));

    // Briefing — now available on morning and evening shift.
    await insertShared('briefingMorning',
      () => db.select({ id: briefingTasks.id }).from(briefingTasks)
        .where(and(
          eq(briefingTasks.scheduleId, scheduleId),
          eq(briefingTasks.shiftId, morningId),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(briefingTasks).values({
        ...base,
        done: false,
        isBalanced: null,
        parentTaskId: null,
      }));
  }

  // ── Evening ────────────────────────────────────────────────────────────────
  if (isEvening) {
    const base = { ...baseCommon, shiftId: eveningId };

    // Briefing — now simple complete-finish and available on both shifts.
    await insertShared('briefingEvening',
      () => db.select({ id: briefingTasks.id }).from(briefingTasks)
        .where(and(
          eq(briefingTasks.scheduleId, scheduleId),
          eq(briefingTasks.shiftId, eveningId),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(briefingTasks).values({
        ...base,
        done: false,
        isBalanced: null,
        parentTaskId: null,
      }));

    // Item Dropping / Item Return / Cek Uang Modal — evening counterpart of
    // the morning rows above. Genuinely per-shift now, see item-dropping.ts.
    await insertShared('itemDroppingEvening',
      () => db.select({ id: itemDroppingTasks.id }).from(itemDroppingTasks)
        .where(and(
          eq(itemDroppingTasks.storeId, sched.storeId),
          eq(itemDroppingTasks.shiftId, eveningId),
          eq(itemDroppingTasks.date, dayStart),
          inArray(itemDroppingTasks.status, ACTIVE_STATUSES),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(itemDroppingTasks).values({ ...base, hasDropping: false }));

    await insertShared('itemReturnEvening',
      () => db.select({ id: itemReturnTasks.id }).from(itemReturnTasks)
        .where(and(
          eq(itemReturnTasks.storeId, sched.storeId),
          eq(itemReturnTasks.shiftId, eveningId),
          eq(itemReturnTasks.date, dayStart),
          inArray(itemReturnTasks.status, ACTIVE_STATUSES),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(itemReturnTasks).values({ ...base, hasReturn: false }));

    // Cek Uang Modal is morning-only (cashier opening float) — no evening
    // counterpart is materialised here; see getOrCreateCekUangModalForSchedule.

    // Store Closing — replaces old EDC Reconciliation + EOD Z-Report + Open Statement.
    // One shared row per store/date. Historical On Hold rows can stay open while
    // future days still generate their own Store Closing row.
    await insertShared('storeClosing',
      () => db.select({ id: storeClosingTasks.id }).from(storeClosingTasks)
        .where(and(
          eq(storeClosingTasks.storeId, sched.storeId),
          eq(storeClosingTasks.date, dayStart),
        ))
        .limit(1).then(r => r[0]),
      () => db.insert(storeClosingTasks).values({
        ...baseCommon,
        // keep the task attached to the actual employee schedule shift.
        // This allows both evening and full_day users to submit it.
        shiftId: sched.shiftId,
      }));
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
    db.delete(storeOpeningTasks)
      .where(and(
        eq(storeOpeningTasks.scheduleId, scheduleId),
        inArray(storeOpeningTasks.status, PENDING_STATUSES),
      )),

    db.delete(setoranTasks)
      .where(and(
        eq(setoranTasks.scheduleId, scheduleId),
        inArray(setoranTasks.status, PENDING_STATUSES),
      )),
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
    db.delete(itemReturnTasks)
      .where(and(eq(itemReturnTasks.scheduleId, scheduleId), inArray(itemReturnTasks.status, ACTIVE_STATUSES))),
    db.delete(cekUangModalTasks)
      .where(and(eq(cekUangModalTasks.scheduleId, scheduleId), inArray(cekUangModalTasks.status, ACTIVE_STATUSES))),
    // serah_terima intentionally excluded — entries aren't tied to a
    // schedule's lifecycle anymore (shared rolling board, not a per-day row).
    // Evening tasks
    db.delete(briefingTasks)
      .where(and(eq(briefingTasks.scheduleId, scheduleId), inArray(briefingTasks.status, ACTIVE_STATUSES))),
    db.delete(storeClosingTasks)
      .where(and(eq(storeClosingTasks.scheduleId, scheduleId), inArray(storeClosingTasks.status, ACTIVE_STATUSES))),
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

    if (task.status === 'not_started') update.status = 'in_progress';

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

    const [sched] = await db.select({ shiftId: schedules.shiftId, date: schedules.date })
      .from(schedules).where(eq(schedules.id, input.scheduleId)).limit(1);

    if (!sched) return { success: false, error: 'Schedule tidak ditemukan.' };

    const now = new Date();

    const [existing] = await db.select().from(briefingTasks)
      .where(and(
        eq(briefingTasks.scheduleId, input.scheduleId),
        eq(briefingTasks.shiftId, sched.shiftId),
      ))
      .limit(1);

    if (isFinalStatus(existing?.status))
      return { success: false, error: 'Task sudah completed dan tidak bisa diubah.' };

    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shiftId:      sched.shiftId,
      date:         startOfDay(sched.date ?? now),
      parentTaskId: null as number | null,
      done:         true,
      isBalanced:   true,
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
    storeOpening, setoran,
    storeFront, cekBin, vmChecklist, marketingCheck, itemDropping, itemReturn, cekUangModal, briefing,
    storeClosing, grooming,
  ] = await Promise.all([
    db.select().from(storeOpeningTasks)      .where(eq(storeOpeningTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(setoranTasks)           .where(eq(setoranTasks.scheduleId,           scheduleId)).limit(1),
    db.select().from(storeFrontTasks)        .where(eq(storeFrontTasks.scheduleId,        scheduleId)).limit(1),
    db.select().from(cekBinTasks)            .where(eq(cekBinTasks.scheduleId,            scheduleId)).limit(1),
    db.select().from(vmChecklistTasks)       .where(eq(vmChecklistTasks.scheduleId,       scheduleId)).limit(1),
    db.select().from(marketingCheckTasks)    .where(eq(marketingCheckTasks.scheduleId,    scheduleId)).limit(1),
    db.select().from(itemDroppingTasks)      .where(eq(itemDroppingTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(itemReturnTasks)        .where(eq(itemReturnTasks.scheduleId,        scheduleId)).limit(1),
    db.select().from(cekUangModalTasks)       .where(eq(cekUangModalTasks.scheduleId,       scheduleId)).limit(1),
    db.select().from(briefingTasks)          .where(eq(briefingTasks.scheduleId,          scheduleId)).limit(1),
    db.select().from(storeClosingTasks)      .where(eq(storeClosingTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(groomingTasks)          .where(eq(groomingTasks.scheduleId,          scheduleId as any)).limit(1),
  ]);

  return {
    storeOpening:      storeOpening[0]      ?? null,
    setoran:           setoran[0]           ?? null,
    storeFront:        storeFront[0]        ?? null,
    cekBin:            cekBin[0]            ?? null,
    vmChecklist:       vmChecklist[0]       ?? null,
    marketingCheck:    marketingCheck[0]    ?? null,
    itemDropping:      itemDropping[0]      ?? null,
    itemReturn:        itemReturn[0]        ?? null,
    cekUangModal:      cekUangModal[0]      ?? null,
    briefing:          briefing[0]          ?? null,
    storeClosing:      storeClosing[0]      ?? null,
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
      notStarted: rows.find(r => r.status === 'not_started')?.count ?? 0,
      inProgress: rows.find(r => r.status === 'in_progress')?.count ?? 0,
      completed:  rows.find(r => r.status === 'completed')?.count   ?? 0,
      pending:    rows.find(r => r.status === 'pending')?.count     ?? 0,
    };
  }

  const [
    storeOpening, setoran,
    storeFront, cekBin, vmChecklist, marketingCheck, itemDropping, itemReturn, cekUangModal, briefing,
    storeClosing, grooming,
  ] = await Promise.all([
    db.select({ status: storeOpeningTasks.status,      count: sql<number>`count(*)::int` }).from(storeOpeningTasks)
      .where(and(eq(storeOpeningTasks.storeId, storeId),      gte(storeOpeningTasks.date, dayStart),      lte(storeOpeningTasks.date, dayEnd))).groupBy(storeOpeningTasks.status).then(summarise),
    db.select({ status: setoranTasks.status,           count: sql<number>`count(*)::int` }).from(setoranTasks)
      .where(and(eq(setoranTasks.storeId, storeId),           gte(setoranTasks.date, dayStart),           lte(setoranTasks.date, dayEnd))).groupBy(setoranTasks.status).then(summarise),
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
    db.select({ status: itemReturnTasks.status,        count: sql<number>`count(*)::int` }).from(itemReturnTasks)
      .where(and(eq(itemReturnTasks.storeId, storeId),        gte(itemReturnTasks.date, dayStart),        lte(itemReturnTasks.date, dayEnd))).groupBy(itemReturnTasks.status).then(summarise),
    db.select({ status: cekUangModalTasks.status,       count: sql<number>`count(*)::int` }).from(cekUangModalTasks)
      .where(and(eq(cekUangModalTasks.storeId, storeId),       gte(cekUangModalTasks.date, dayStart),       lte(cekUangModalTasks.date, dayEnd))).groupBy(cekUangModalTasks.status).then(summarise),
    db.select({ status: briefingTasks.status,          count: sql<number>`count(*)::int` }).from(briefingTasks)
      .where(and(eq(briefingTasks.storeId, storeId),          gte(briefingTasks.date, dayStart),          lte(briefingTasks.date, dayEnd))).groupBy(briefingTasks.status).then(summarise),
    db.select({ status: storeClosingTasks.status,      count: sql<number>`count(*)::int` }).from(storeClosingTasks)
      .where(and(eq(storeClosingTasks.storeId, storeId),      gte(storeClosingTasks.date, dayStart),      lte(storeClosingTasks.date, dayEnd))).groupBy(storeClosingTasks.status).then(summarise),
    db.select({ status: groomingTasks.status,          count: sql<number>`count(*)::int` }).from(groomingTasks)
      .where(and(eq(groomingTasks.storeId, storeId),          gte(groomingTasks.date, dayStart),          lte(groomingTasks.date, dayEnd))).groupBy(groomingTasks.status).then(summarise),
  ]);

  return { storeOpening, setoran, storeFront, cekBin, vmChecklist, marketingCheck, itemDropping, itemReturn, cekUangModal, briefing, storeClosing, grooming };
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


function buildExtra(row: Record<string, unknown>, photoFields: string[] = []): Record<string, unknown> {
  const skip = new Set([
    'id', 'scheduleId', 'userId', 'storeId', 'shiftId', 'date',
    'status', 'notes', 'completedAt', 'createdAt', 'updatedAt',
    'submittedLat', 'submittedLng', 'isBalanced', 'parentTaskId',
    'verifiedBy', 'verifiedAt',
    'discrepancyStartedAt', 'discrepancyResolvedAt', 'discrepancyDurationMinutes',
    'expectedFetchedAt', 'expectedSnapshot', 'expectedAmount', 'actualAmount',
  ]);

  const extra: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (skip.has(key)) continue;
    extra[key] = photoFields.includes(key) ? parsePhotosField(value) : value;
  }

  return extra;
}

function isUserIdLike(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10;
}

const ACTOR_KEYS = new Set([
  'userId', 'completedBy', 'verifiedBy', 'claimedBy', 'sourceUserId',
]);

function isActorKey(key: string): boolean {
  return ACTOR_KEYS.has(key) || key.endsWith('By');
}

async function getUserNameMapFromRows(rows: Record<string, unknown>[]) {
  const ids = new Set<string>();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (isActorKey(key) && typeof value === 'string' && value.length > 0) {
        ids.add(value);
      }
    }
  }

  if (ids.size === 0) return new Map<string, string>();

  const rowsUsers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...ids]));

  return new Map(rowsUsers.map((u) => [u.id, u.name]));
}

function addActorNamesToExtra(
  extra: Record<string, unknown>,
  userNameById: Map<string, string>,
) {
  const out = { ...extra };

  for (const [key, value] of Object.entries(extra)) {
    if (
      typeof value === 'string' &&
      (
        key === 'completedBy' ||
        key === 'verifiedBy' ||
        key === 'claimedBy' ||
        key === 'sourceUserId' ||
        key.endsWith('By')
      )
    ) {
      out[`${key}Name`] = userNameById.get(value) ?? value;
    }
  }

  return out;
}

export async function getFlatTasksForStoreDate(storeId: number, date: Date): Promise<FlatTask[]> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftCodeById = new Map<number, 'morning' | 'evening' | 'full_day'>(
    shiftRows.map((s) => [s.id, s.code as 'morning' | 'evening' | 'full_day']),
  );

  async function loadTable(table: any, type: string, photoFields: string[]): Promise<FlatTask[]> {
    const rows = await db
      .select({ task: table, userName: users.name })
      .from(table)
      .leftJoin(users, eq(table.userId, users.id))
      .where(and(
        eq(table.storeId, storeId),
        gte(table.date, dayStart),
        lte(table.date, dayEnd),
      ));

    const rawTasks = rows.map((r) => r.task as Record<string, unknown>);
    const userNameById = await getUserNameMapFromRows(rawTasks);

    return rows.map(({ task, userName }) => {
      const t = task as any;
      const extra = addActorNamesToExtra(buildExtra(t, photoFields), userNameById);

      return {
        id: t.id,
        type,
        scheduleId: t.scheduleId,
        userId: t.userId,
        userName: userName ?? userNameById.get(t.userId) ?? null,
        completedBy: t.completedBy ?? null,
        completedByName: t.completedBy ? userNameById.get(t.completedBy) ?? t.completedBy : null,
        verifiedBy: t.verifiedBy ?? null,
        verifiedByName: t.verifiedBy ? userNameById.get(t.verifiedBy) ?? t.verifiedBy : null,
        verifiedAt: t.verifiedAt instanceof Date ? t.verifiedAt.toISOString() : t.verifiedAt ?? null,
        storeId: t.storeId,
        shift: shiftCodeById.get(t.shiftId) ?? null,
        date: t.date instanceof Date ? t.date.toISOString() : String(t.date),
        status: t.status ?? null,
        notes: t.notes ?? null,
        completedAt: t.completedAt instanceof Date ? t.completedAt.toISOString() : null,
        isBalanced: t.isBalanced ?? null,
        parentTaskId: t.parentTaskId ?? null,
        extra,
      };
    });
  }

  function toIsoValue(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  async function loadItemReturnEntriesByTaskId(taskIds: number[]) {
    const map = new Map<number, Array<Record<string, unknown>>>();
    if (!taskIds.length) return map;

    const rows = await db
      .select()
      .from(itemReturnEntries)
      .where(inArray(itemReturnEntries.taskId, taskIds))
      .orderBy(itemReturnEntries.returnTime);

    for (const row of rows) {
      const item = {
        id: row.id,
        taskId: row.taskId,
        userId: row.userId,
        storeId: row.storeId,
        returnNumber: row.returnNumber,
        description: row.description,
        expectedAt: toIsoValue(row.expectedAt),
        quantity: row.quantity ?? 0,
        returnTime: toIsoValue(row.returnTime),
        returnPhotos: parsePhotosField(row.returnPhotos),
        notes: row.notes,
        createdAt: toIsoValue(row.createdAt),
      };

      const bucket = map.get(row.taskId) ?? [];
      bucket.push(item);
      map.set(row.taskId, bucket);
    }

    return map;
  }

  async function loadCekUangModalDenominationsByTaskId(taskIds: number[]) {
    const map = new Map<number, Array<Record<string, unknown>>>();
    if (!taskIds.length) return map;

    const rows = await db
      .select()
      .from(cekUangModalDenominations)
      .where(inArray(cekUangModalDenominations.taskId, taskIds))
      .orderBy(cekUangModalDenominations.denominationValue);

    for (const row of rows) {
      const item = {
        id: row.id,
        taskId: row.taskId,
        userId: row.userId,
        storeId: row.storeId,
        denominationValue: row.denominationValue,
        quantity: row.quantity ?? 0,
        amount: row.amount,
        notes: row.notes,
        createdAt: toIsoValue(row.createdAt),
      };

      const bucket = map.get(row.taskId) ?? [];
      bucket.push(item);
      map.set(row.taskId, bucket);
    }

    return map;
  }

  const [
    storeOpening,
    setoran,
    storeFront,
    cekBin,
    vmChecklist,
    marketingCheck,
    itemDropping,
    itemReturn,
    cekUangModal,
    briefing,
    storeClosing,
    grooming,
  ] = await Promise.all([
    loadTable(storeOpeningTasks, 'store_opening', [
      'cashDrawerPhotos',
      'cashierDeskPhotos',
      'fiveRAreaKasirPhotos',
      'fiveRAreaDepanPhotos',
      'fiveRAreaKananPhotos',
      'fiveRAreaKiriPhotos',
      'fiveRAreaGudangPhotos',
    ]),
    loadTable(setoranTasks, 'setoran', [
      'resiPhoto',
      'atmCardSelfiePhoto',
    ]),
    loadTable(storeFrontTasks, 'store_front', [
      'storefrontPhotos',
      'rollingDoorClosedPhoto',
    ]),
    loadTable(cekBinTasks, 'cek_bin', []),
    loadTable(vmChecklistTasks, 'vm_checklist', []),
    loadTable(marketingCheckTasks, 'marketing_check', []),
    loadTable(itemDroppingTasks, 'item_dropping', []),
    loadTable(itemReturnTasks, 'item_return', []),
    loadTable(cekUangModalTasks, 'cek_uang_modal', []),
    loadTable(briefingTasks, 'briefing', []),
    // serah_terima intentionally excluded — it's now a shared, rolling
    // handover board per store (no date/status columns), not a per-day
    // completable task row, so it no longer fits this daily flat export.
    loadTable(storeClosingTasks, 'store_closing', ['eodEdcSettlementPhoto']),
    loadTable(groomingTasks, 'grooming', ['selfiePhotos']),
  ]);

  const itemReturnEntriesByTaskId = await loadItemReturnEntriesByTaskId(
    itemReturn.map((task) => task.id),
  );
  const cekUangModalDenominationsByTaskId = await loadCekUangModalDenominationsByTaskId(
    cekUangModal.map((task) => task.id),
  );

  const itemReturnWithEntries: FlatTask[] = itemReturn.map((task) => {
    const entries = itemReturnEntriesByTaskId.get(task.id) ?? [];
    const totalQuantity = entries.reduce((sum, entry) => sum + Number(entry.quantity ?? 0), 0);

    return {
      ...task,
      extra: {
        ...task.extra,
        entries,
        entryCount: entries.length,
        totalQuantity,
      },
    };
  });

  const cekUangModalWithDenominations: FlatTask[] = cekUangModal.map((task) => {
    const denominations = cekUangModalDenominationsByTaskId.get(task.id) ?? [];
    const totalQuantity = denominations.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    const filledDenominationCount = denominations.filter((row) => Number(row.quantity ?? 0) > 0).length;

    return {
      ...task,
      extra: {
        ...task.extra,
        denominations,
        denominationCount: denominations.length,
        filledDenominationCount,
        totalQuantity,
      },
    };
  });

  const all = [
    ...storeOpening,
    ...setoran,
    ...storeFront,
    ...cekBin,
    ...vmChecklist,
    ...marketingCheck,
    ...itemDropping,
    ...itemReturnWithEntries,
    ...cekUangModalWithDenominations,
    ...briefing,
    ...storeClosing,
    ...grooming,
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
    notStarted: 0, inProgress: 0, completed: 0,
    pending: 0, total: tasks.length,
  };
  for (const t of tasks) {
    switch (t.status) {
      case 'not_started': s.notStarted++; break;
      case 'in_progress': s.inProgress++; break;
      case 'completed':   s.completed++;  break;
      case 'pending':     s.pending++;    break;
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
      notStarted: 0, inProgress: 0, completed: 0,
      pending: 0, total: 0,
    };
    for (const perType of Object.values(daily)) {
      summary.notStarted += perType.notStarted;
      summary.inProgress += perType.inProgress;
      summary.completed  += perType.completed;
      summary.pending    += perType.pending;
    }
    summary.total =
      summary.notStarted + summary.inProgress + summary.completed +
      summary.pending;
    return { ...s, summary };
  }));

  return { area: area ?? null, stores: results };
}


export async function getAllTaskOverview(date: Date) {
  const allStores = await db
    .select({
      id: stores.id,
      name: stores.name,
      address: stores.address,
      areaId: stores.areaId,
      areaName: areas.name,
    })
    .from(stores)
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .orderBy(areas.name, stores.name);

  const results = await Promise.all(
    allStores.map(async (s) => {
      const daily = await getDailyTaskSummary(s.id, date);

      const summary: StoreTaskSummary = {
        notStarted: 0,
        inProgress: 0,
        completed: 0,
        pending: 0,
        total: 0,
      };

      for (const perType of Object.values(daily)) {
        summary.notStarted += perType.notStarted;
        summary.inProgress += perType.inProgress;
        summary.completed += perType.completed;
        summary.pending += perType.pending;
      }

      summary.total =
        summary.notStarted +
        summary.inProgress +
        summary.completed +
        summary.pending;

      return {
        id: s.id,
        name: s.name,
        address: s.address,
        areaId: s.areaId,
        areaName: s.areaName,
        summary,
      };
    }),
  );

  return {
    area: null,
    stores: results,
  };
}

/**
 * Returns per-(storeId, date) task summaries for all stores in a date range.
 *
 * Used by OPS Progress range page.
 *
 * Important:
 * The old evening closing tasks were removed:
 * - edc_reconciliation
 * - eod_z_report
 * - open_statement
 *
 * They are now represented by one shared task table:
 * - store_closing_tasks
 */


export interface StoreDateSummary {
  storeId: number;
  date: string;
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  total: number;
}

export async function getStoreSummariesForRange(
  storeIds: number[],
  startDate: Date,
  endDate: Date,
): Promise<StoreDateSummary[]> {
  if (!storeIds.length) return [];

  const dayStart = startOfDay(startDate);
  const dayEnd = endOfDay(endDate);

  type RawRow = {
    storeId: number;
    date: Date;
    status: string | null;
  };

  async function loadTable(table: any): Promise<RawRow[]> {
    return db
      .select({
        storeId: table.storeId,
        date: table.date,
        status: table.status,
      })
      .from(table)
      .where(
        and(
          inArray(table.storeId, storeIds),
          gte(table.date, dayStart),
          lte(table.date, dayEnd),
        ),
      );
  }

  const [
    storeOpening,
    setoran,
    storeFront,
    cekBin,
    vmChecklist,
    marketingCheck,
    itemDropping,
    itemReturn,
    cekUangModal,
    briefing,
    storeClosing,
    grooming,
  ] = await Promise.all([
    loadTable(storeOpeningTasks),
    loadTable(setoranTasks),
    loadTable(storeFrontTasks),
    loadTable(cekBinTasks),
    loadTable(vmChecklistTasks),
    loadTable(marketingCheckTasks),
    loadTable(itemDroppingTasks),
    loadTable(itemReturnTasks),
    loadTable(cekUangModalTasks),
    loadTable(briefingTasks),
    // serah_terima intentionally excluded — no date/status columns anymore
    // (shared rolling board, not a per-day row).
    loadTable(storeClosingTasks),
    loadTable(groomingTasks),
  ]);

  const all: RawRow[] = [
    ...storeOpening,
    ...setoran,
    ...storeFront,
    ...cekBin,
    ...vmChecklist,
    ...marketingCheck,
    ...itemDropping,
    ...itemReturn,
    ...cekUangModal,
    ...briefing,
    ...storeClosing,
    ...grooming,
  ];

  const map = new Map<string, StoreDateSummary>();

  for (const row of all) {
    const rowDate = row.date instanceof Date ? row.date : new Date(row.date);
    const dateKey = toKey(rowDate);
    const key = `${row.storeId}::${dateKey}`;

    let entry = map.get(key);

    if (!entry) {
      entry = {
        storeId: row.storeId,
        date: dateKey,
        notStarted: 0,
        inProgress: 0,
        completed: 0,
        pending: 0,
        total: 0,
      };

      map.set(key, entry);
    }

    entry.total++;

    switch (row.status) {
      case 'not_started':
        entry.notStarted++;
        break;

      case 'in_progress':
        entry.inProgress++;
        break;

      case 'completed':
        entry.completed++;
        break;

      case 'pending':
        entry.pending++;
        break;
    }
  }

  return [...map.values()];
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
// lib/db/utils/cek-uang-muka.ts
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  cekUangMukaTasks,
  cekUangMukaDenominations,
  stores,
  schedules,
  attendance,
  type CekUangMukaTask,
  type CekUangMukaDenomination,
} from '@/lib/db/schema';
import { getMorningShiftId } from '@/lib/db/utils/shared-daily-morning-task';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

/**
 * Daily maximum uang muka / cashier float.
 * Employee may report any total from Rp 1 up to this amount, but cannot exceed it.
 */
export const CEK_UANG_MUKA_MAX_TOTAL = 500_000;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Indonesian rupiah denominations used for cashier opening cash / uang muka. */
export const CEK_UANG_MUKA_DENOMINATIONS = [
  100_000,
  50_000,
  20_000,
  10_000,
  5_000,
  2_000,
  1_000,
  500,
  200,
  100,
] as const;

const DENOMINATION_SET = new Set<number>(
  CEK_UANG_MUKA_DENOMINATIONS as readonly number[],
);

export interface UangMukaDenominationInput {
  denominationValue: number;
  quantity: number;
  notes?: string;
}

export interface SubmitCekUangMukaInput {
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
  denominations: UangMukaDenominationInput[];
  notes?: string;
}

export interface AutoSaveCekUangMukaPatch {
  denominations?: UangMukaDenominationInput[];
  notes?: string;
}

export interface CekUangMukaSummary {
  totalAmount: number;
  maxAmount: number;
  remainingAmount: number;
}

export interface CekUangMukaWithDenominations {
  task: CekUangMukaTask;
  denominations: CekUangMukaDenomination[];
  summary: CekUangMukaSummary;
}

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

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString('id-ID')}`;
}

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

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

async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;

  const dist = haversineMetres(geo, {
    lat: parseFloat(store.lat),
    lng: parseFloat(store.lng),
  });

  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
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

function normalizeQuantity(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${field} harus berupa angka bulat 0 atau lebih.`);
  }
  return n;
}

function normalizeDenominations(
  input: UangMukaDenominationInput[],
): Array<UangMukaDenominationInput & { amount: number }> {
  const byValue = new Map<number, UangMukaDenominationInput>();

  for (const item of input ?? []) {
    const denominationValue = Number(item.denominationValue);

    if (!Number.isInteger(denominationValue) || !DENOMINATION_SET.has(denominationValue)) {
      throw new Error(`Pecahan ${item.denominationValue} tidak valid.`);
    }

    if (byValue.has(denominationValue)) {
      throw new Error(`Pecahan ${formatRupiah(denominationValue)} dikirim lebih dari satu kali.`);
    }

    byValue.set(denominationValue, {
      denominationValue,
      quantity: normalizeQuantity(item.quantity, `Quantity pecahan ${formatRupiah(denominationValue)}`),
      notes: item.notes,
    });
  }

  return CEK_UANG_MUKA_DENOMINATIONS.map((denominationValue) => {
    const item = byValue.get(denominationValue) ?? { denominationValue, quantity: 0 };
    const quantity = normalizeQuantity(item.quantity, `Quantity pecahan ${formatRupiah(denominationValue)}`);

    return {
      denominationValue,
      quantity,
      notes: item.notes,
      amount: denominationValue * quantity,
    };
  });
}

function totalAmount(rows: Array<{ amount: number }>): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function buildSummary(total: number): CekUangMukaSummary {
  return {
    totalAmount: total,
    maxAmount: CEK_UANG_MUKA_MAX_TOTAL,
    remainingAmount: CEK_UANG_MUKA_MAX_TOTAL - total,
  };
}

function assertWithinDailyLimit(total: number): CekUangMukaSummary {
  const summary = buildSummary(total);

  if (total > CEK_UANG_MUKA_MAX_TOTAL) {
    throw new Error(
      `Total uang muka maksimal ${formatRupiah(CEK_UANG_MUKA_MAX_TOTAL)}. ` +
      `Total saat ini ${formatRupiah(total)}, kelebihan ${formatRupiah(total - CEK_UANG_MUKA_MAX_TOTAL)}.`,
    );
  }

  return summary;
}

async function replaceDenominationRows(
  taskId: number,
  userId: string,
  storeId: number,
  denominations: Array<UangMukaDenominationInput & { amount: number }>,
): Promise<void> {
  await db.delete(cekUangMukaDenominations).where(eq(cekUangMukaDenominations.taskId, taskId));

  await db.insert(cekUangMukaDenominations).values(
    denominations.map((item) => ({
      taskId,
      userId,
      storeId,
      denominationValue: item.denominationValue,
      quantity: item.quantity,
      amount: String(item.amount),
      notes: item.notes,
      updatedAt: new Date(),
    })),
  );
}

async function ensureDenominationRows(task: CekUangMukaTask): Promise<void> {
  const existing = await db
    .select({ id: cekUangMukaDenominations.id })
    .from(cekUangMukaDenominations)
    .where(eq(cekUangMukaDenominations.taskId, task.id))
    .limit(1);

  if (existing.length > 0) return;

  const rows = normalizeDenominations([]);
  await db
    .insert(cekUangMukaDenominations)
    .values(
      rows.map((item) => ({
        taskId: task.id,
        userId: task.userId,
        storeId: task.storeId,
        denominationValue: item.denominationValue,
        quantity: 0,
        amount: '0',
      })),
    )
    .onConflictDoNothing();
}

export async function getActiveCekUangMukaTask(
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<CekUangMukaTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const morningShiftId = await getMorningShiftId();

  const [today] = await db
    .select()
    .from(cekUangMukaTasks)
    .where(and(
      eq(cekUangMukaTasks.storeId, storeId),
      eq(cekUangMukaTasks.shiftId, morningShiftId),
      gte(cekUangMukaTasks.date, dayStart),
      lte(cekUangMukaTasks.date, dayEnd),
    ))
    .limit(1);

  if (today) await ensureDenominationRows(today);
  return today ?? null;
}

export async function getCekUangMukaDenominations(taskId: number): Promise<CekUangMukaDenomination[]> {
  return db
    .select()
    .from(cekUangMukaDenominations)
    .where(eq(cekUangMukaDenominations.taskId, taskId))
    .orderBy(cekUangMukaDenominations.denominationValue);
}

export async function submitCekUangMuka(
  input: SubmitCekUangMukaInput,
): Promise<TaskResult<CekUangMukaWithDenominations>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const normalized = normalizeDenominations(input.denominations);
    const total = totalAmount(normalized);

    if (total <= 0) {
      return { success: false, error: 'Total uang muka harus lebih dari Rp 0.' };
    }

    const summary = assertWithinDailyLimit(total);

    const now = new Date();
    const morningShiftId = await getMorningShiftId();

    const [schedule] = await db
      .select({ date: schedules.date })
      .from(schedules)
      .where(eq(schedules.id, input.scheduleId))
      .limit(1);

    const taskDate = schedule?.date ?? now;

    let existing = await getActiveCekUangMukaTask(input.storeId, morningShiftId, taskDate);

    if (!existing) {
      existing = await getOrCreateCekUangMukaForSchedule(
        input.scheduleId,
        input.userId,
        input.storeId,
        morningShiftId,
        taskDate,
      );
    }

    if (!existing) {
      return { success: false, error: 'Task Cek Uang Muka belum dibuat. Buka ulang halaman task terlebih dahulu.' };
    }

    if (existing.status === 'completed') {
      return { success: false, error: 'Task sudah selesai dan tidak bisa diubah.' };
    }

    const [task] = await db
      .update(cekUangMukaTasks)
      .set({
        scheduleId: input.scheduleId,
        userId: input.userId,
        storeId: input.storeId,
        shiftId: morningShiftId,
        date: startOfDay(taskDate),
        totalAmount: String(summary.totalAmount),
        maxAmount: String(summary.maxAmount),
        remainingAmount: String(summary.remainingAmount),
        submittedLat: input.skipGeo ? null : String(input.geo.lat),
        submittedLng: input.skipGeo ? null : String(input.geo.lng),
        notes: input.notes,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(cekUangMukaTasks.id, existing.id))
      .returning();

    await replaceDenominationRows(task.id, input.userId, input.storeId, normalized);
    const denominations = await getCekUangMukaDenominations(task.id);

    return { success: true, data: { task, denominations, summary } };
  } catch (err) {
    return { success: false, error: `submitCekUangMuka: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function autoSaveCekUangMukaById(
  taskId: number,
  patch: AutoSaveCekUangMukaPatch,
): Promise<TaskResult<{ saved: string[]; summary?: CekUangMukaSummary }>> {
  try {
    const [existing] = await db
      .select({
        id: cekUangMukaTasks.id,
        userId: cekUangMukaTasks.userId,
        storeId: cekUangMukaTasks.storeId,
        status: cekUangMukaTasks.status,
      })
      .from(cekUangMukaTasks)
      .where(eq(cekUangMukaTasks.id, taskId))
      .limit(1);

    if (!existing) return { success: false, error: 'Task Cek Uang Muka tidak ditemukan.' };
    if (existing.status === 'completed') return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const saved: string[] = [];
    let summary: CekUangMukaSummary | undefined;

    if ('notes' in patch) {
      update.notes = patch.notes;
      saved.push('notes');
    }

    if (patch.denominations) {
      const normalized = normalizeDenominations(patch.denominations);
      const total = totalAmount(normalized);
      summary = assertWithinDailyLimit(total);

      await replaceDenominationRows(existing.id, existing.userId, existing.storeId, normalized);
      update.totalAmount = String(summary.totalAmount);
      update.maxAmount = String(summary.maxAmount);
      update.remainingAmount = String(summary.remainingAmount);
      saved.push('denominations', 'totalAmount', 'remainingAmount');
    }

    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(cekUangMukaTasks).set(update).where(eq(cekUangMukaTasks.id, existing.id));

    return { success: true, data: { saved, summary } };
  } catch (err) {
    return { success: false, error: `autoSaveCekUangMukaById: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function autoSaveCekUangMuka(
  scheduleId: number,
  patch: AutoSaveCekUangMukaPatch,
): Promise<TaskResult<{ saved: string[]; summary?: CekUangMukaSummary }>> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return { success: false, error: 'Schedule not found.' };

  const morningShiftId = await getMorningShiftId();
  const existing = await getActiveCekUangMukaTask(schedule.storeId, morningShiftId, schedule.date);

  if (!existing) return { success: false, error: 'Task Cek Uang Muka tidak ditemukan.' };
  return autoSaveCekUangMukaById(existing.id, patch);
}

export async function materialiseCekUangMukaTask(
  scheduleId: number,
  userId: string,
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<'created' | 'skipped'> {
  const morningShiftId = await getMorningShiftId();
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [existing] = await db
    .select({ id: cekUangMukaTasks.id })
    .from(cekUangMukaTasks)
    .where(and(
      eq(cekUangMukaTasks.storeId, storeId),
      eq(cekUangMukaTasks.shiftId, morningShiftId),
      gte(cekUangMukaTasks.date, dayStart),
      lte(cekUangMukaTasks.date, dayEnd),
    ))
    .limit(1);

  if (existing) return 'skipped';

  const [task] = await db
    .insert(cekUangMukaTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: morningShiftId,
      date: dayStart,
      totalAmount: '0',
      maxAmount: String(CEK_UANG_MUKA_MAX_TOTAL),
      remainingAmount: String(CEK_UANG_MUKA_MAX_TOTAL),
      status: 'pending',
    })
    .returning();

  await ensureDenominationRows(task);
  return 'created';
}

export async function getOrCreateCekUangMukaForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  _shiftId: number,
  date: Date,
): Promise<CekUangMukaTask> {
  const morningShiftId = await getMorningShiftId();
  const existing = await getActiveCekUangMukaTask(storeId, morningShiftId, date);
  if (existing) return existing;

  const dayStart = startOfDay(date);

  const [row] = await db
    .insert(cekUangMukaTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: morningShiftId,
      date: dayStart,
      totalAmount: '0',
      maxAmount: String(CEK_UANG_MUKA_MAX_TOTAL),
      remainingAmount: String(CEK_UANG_MUKA_MAX_TOTAL),
      status: 'pending',
    })
    .onConflictDoNothing()
    .returning();

  const task = row ?? (await getActiveCekUangMukaTask(storeId, morningShiftId, date))!;
  await ensureDenominationRows(task);
  return task;
}

export async function getCekUangMukaBySchedule(scheduleId: number): Promise<CekUangMukaTask | null> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return null;
  const morningShiftId = await getMorningShiftId();
  return getActiveCekUangMukaTask(schedule.storeId, morningShiftId, schedule.date);
}

export async function getCekUangMukaById(id: number): Promise<CekUangMukaTask | null> {
  const [row] = await db.select().from(cekUangMukaTasks).where(eq(cekUangMukaTasks.id, id)).limit(1);
  if (row) await ensureDenominationRows(row);
  return row ?? null;
}

export async function getCekUangMukaWithDenominations(
  taskId: number,
): Promise<CekUangMukaWithDenominations | null> {
  const task = await getCekUangMukaById(taskId);
  if (!task) return null;

  const denominations = await getCekUangMukaDenominations(taskId);
  const total = Number(task.totalAmount ?? 0);
  const max = Number(task.maxAmount ?? CEK_UANG_MUKA_MAX_TOTAL);
  const summary = {
    totalAmount: total,
    maxAmount: Number.isFinite(max) ? max : CEK_UANG_MUKA_MAX_TOTAL,
    remainingAmount: Number(task.remainingAmount ?? CEK_UANG_MUKA_MAX_TOTAL - total),
  };

  return { task, denominations, summary };
}

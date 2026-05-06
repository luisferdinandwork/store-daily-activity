// lib/db/utils/cek-bin.ts
import { db } from '@/lib/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import {
  attendance,
  cekBinTaskBins,
  cekBinTasks,
  storeBins,
  stores,
  type CekBinTask,
} from '@/lib/db/schema';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
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
  userId: string;
  storeId: number;
  shiftId?: number;
  geo: GeoPoint;
  selectedBins: CekBinSelectedBinInput[];
  notes?: string;
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
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
  return n;
}

function minimumBinsToCheck(totalActiveBins: number): number {
  if (totalActiveBins <= 0) return 0;
  return Math.ceil(totalActiveBins * 0.3);
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
      return String(e instanceof Error ? e.message : e);
    }
  }

  const min = minimumBinsToCheck(activeBins.length);
  if (activeBins.length > 0 && selectedBins.length < min) {
    return `Minimal cek ${min} BIN, yaitu 30% dari total ${activeBins.length} BIN aktif di store.`;
  }

  return null;
}

async function replaceCheckedBins(taskId: number, selectedBins: CekBinSelectedBinInput[], storeId: number): Promise<void> {
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

export async function getOrCreateCekBinForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<TaskResult<CekBinWithBins>> {
  try {
    const activeBins = await getActiveStoreBins(storeId);
    const min = minimumBinsToCheck(activeBins.length);
    const day = startOfDay(date);

    let task = await findCekBinByStoreDate(storeId, day);

    if (!task) {
      const [created] = await db
        .insert(cekBinTasks)
        .values({
          scheduleId,
          userId,
          storeId,
          shiftId,
          date: day,
          totalStoreBins: activeBins.length,
          minimumBinsToCheck: min,
          checkedBinsCount: 0,
          status: 'pending',
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      task = created ?? (await findCekBinByStoreDate(storeId, day));
    }

    if (!task) return { success: false, error: 'Gagal membuat task Cek BIN.' };

    // Keep minimum updated while task is not completed yet.
    if (task.status === 'pending' || task.status === 'in_progress') {
      const [updated] = await db
        .update(cekBinTasks)
        .set({
          totalStoreBins: activeBins.length,
          minimumBinsToCheck: min,
          updatedAt: new Date(),
        })
        .where(eq(cekBinTasks.id, task.id))
        .returning();
      task = updated ?? task;
    }

    const checkedBins = await getCheckedBins(task.id);

    return {
      success: true,
      data: {
        ...task,
        availableBins: activeBins,
        checkedBins,
      },
    };
  } catch (err) {
    return { success: false, error: `getOrCreateCekBinForSchedule: ${err}` };
  }
}

export async function submitCekBin(input: SubmitCekBinInput): Promise<TaskResult<CekBinWithBins>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const activeBins = await getActiveStoreBins(input.storeId);
    const validationErr = validateSelectedBins(input.selectedBins, activeBins);
    if (validationErr) return { success: false, error: validationErr };

    const now = new Date();
    const min = minimumBinsToCheck(activeBins.length);

    let task = await findCekBinByStoreDate(input.storeId, now);

    if (task?.status === 'verified') {
      return { success: false, error: 'Cek BIN sudah diverifikasi.' };
    }

    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      ...(input.shiftId ? { shiftId: input.shiftId } : {}),
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
      if (!input.shiftId) {
        return { success: false, error: 'shiftId wajib dikirim saat task Cek BIN belum dibuat.' };
      }
      const [created] = await db.insert(cekBinTasks).values({ ...values, shiftId: input.shiftId }).returning();
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
    if (task.status === 'completed' || task.status === 'verified') return { success: true, data: { saved: [] } };

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

export async function getCekBinBySchedule(scheduleId: number): Promise<TaskResult<CekBinWithBins | null>> {
  try {
    const [task] = await db.select().from(cekBinTasks).where(eq(cekBinTasks.scheduleId, scheduleId)).limit(1);
    if (!task) return { success: true, data: null };
    return getCekBinById(task.id);
  } catch (err) {
    return { success: false, error: `getCekBinBySchedule: ${err}` };
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

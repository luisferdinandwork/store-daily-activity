// lib/db/utils/setoran.ts
// Setoran task + money storage ledger.
//
// actualReceivedAmount = uang aktual diterima hari ini
// storedAmount         = uang yang disetor/disimpan hari ini
// previousUnpaidAmount = unpaid dari setoran terakhir sebelumnya
// requiredStoreAmount  = actualReceivedAmount + previousUnpaidAmount
// unpaidAmount         = requiredStoreAmount - storedAmount
//
// Backward compatibility:
// - expectedAmount is accepted as actualReceivedAmount
// - amount is accepted as storedAmount

import { db } from '@/lib/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import {
  setoranTasks,
  setoranMoneyStorage,
  shifts,
  attendance,
  schedules,
  type SetoranTask,
  type SetoranMoneyStorage,
} from '@/lib/db/schema';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface SubmitSetoranInput {
  scheduleId: number;
  userId: string;
  storeId: number;

  actualReceivedAmount?: string;
  expectedAmount?: string;

  storedAmount?: string;
  amount?: string;

  resiPhoto: string;
  atmCardSelfiePhoto: string;
  notes?: string;
}

export interface SetoranActorContext {
  userId: string;
  scheduleId: number;
}

export interface SetoranAutoSavePatch {
  actualReceivedAmount?: string | null;
  expectedAmount?: string | null;
  storedAmount?: string | null;
  amount?: string | null;
  resiPhoto?: string | null;
  atmCardSelfiePhoto?: string | null;
  notes?: string;
}

export interface SetoranWithStorage {
  task: SetoranTask;
  storage: SetoranMoneyStorage | null;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function parseAmount(raw: string | number | null | undefined): number {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function money(n: number): string {
  return n.toFixed(2);
}

function sameMoney(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return money(parseAmount(a)) === money(parseAmount(b));
}

let _shiftCodeByIdCache: Record<number, string> | null = null;
let _morningShiftIdCache: number | null = null;

async function getShiftCodeById(): Promise<Record<number, string>> {
  if (_shiftCodeByIdCache) return _shiftCodeByIdCache;

  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  _shiftCodeByIdCache = Object.fromEntries(rows.map((r) => [r.id, r.code]));
  return _shiftCodeByIdCache;
}

async function getMorningShiftId(): Promise<number> {
  if (_morningShiftIdCache != null) return _morningShiftIdCache;

  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(eq(shifts.code, 'morning'))
    .limit(1);

  if (!row) throw new Error('Morning shift not found in shifts table.');

  _morningShiftIdCache = row.id;
  return row.id;
}

async function assertMorningSchedule(scheduleId: number): Promise<string | null> {
  const [sched] = await db
    .select({ shiftId: schedules.shiftId })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!sched) return `Schedule ${scheduleId} not found.`;

  const shiftMap = await getShiftCodeById();
  const code = shiftMap[sched.shiftId];

  // If you want STRICT morning only, remove `full_day` here.
  if (code !== 'morning' && code !== 'full_day') {
    return 'Setoran hanya tersedia untuk shift morning.';
  }

  return null;
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

export async function getPriorUnpaidForStore(
  storeId: number,
  beforeDate: Date,
): Promise<string> {
  const dayStart = startOfDay(beforeDate);

  const [priorStorage] = await db
    .select({ unpaidAmount: setoranMoneyStorage.unpaidAmount })
    .from(setoranMoneyStorage)
    .where(and(
      eq(setoranMoneyStorage.storeId, storeId),
      lt(setoranMoneyStorage.date, dayStart),
    ))
    .orderBy(desc(setoranMoneyStorage.date))
    .limit(1);

  return money(parseAmount(priorStorage?.unpaidAmount));
}

async function refreshPendingCarryForward(task: SetoranTask): Promise<SetoranTask> {
  if (task.status !== 'pending' && task.status !== 'in_progress') return task;

  const carriedDeficit = await getPriorUnpaidForStore(task.storeId, task.date);

  if (sameMoney(task.carriedDeficit, carriedDeficit)) return task;

  const [updated] = await db
    .update(setoranTasks)
    .set({
      carriedDeficit,
      carriedDeficitFetchedAt: new Date(),
      unpaidAmount: '0.00',
      updatedAt: new Date(),
    })
    .where(eq(setoranTasks.id, task.id))
    .returning();

  return updated ?? task;
}

export async function getOrCreateSetoranForSchedule(
  scheduleId: number,
): Promise<TaskResult<SetoranTask>> {
  try {
    const shiftErr = await assertMorningSchedule(scheduleId);
    if (shiftErr) return { success: false, error: shiftErr };

    const [sched] = await db
      .select({
        userId: schedules.userId,
        storeId: schedules.storeId,
        date: schedules.date,
      })
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);

    if (!sched) return { success: false, error: `Schedule ${scheduleId} not found.` };

    const dayStart = startOfDay(sched.date);

    const [existing] = await db
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.scheduleId, scheduleId))
      .limit(1);

    if (existing) {
      const refreshed = await refreshPendingCarryForward(existing);
      return { success: true, data: refreshed };
    }

    const [byStoreDate] = await db
      .select()
      .from(setoranTasks)
      .where(and(
        eq(setoranTasks.storeId, sched.storeId),
        eq(setoranTasks.date, dayStart),
      ))
      .limit(1);

    if (byStoreDate) {
      const refreshed = await refreshPendingCarryForward(byStoreDate);
      return { success: true, data: refreshed };
    }

    const carriedDeficit = await getPriorUnpaidForStore(sched.storeId, dayStart);
    const morningShiftId = await getMorningShiftId();
    const now = new Date();

    const [created] = await db
      .insert(setoranTasks)
      .values({
        scheduleId,
        userId: sched.userId,
        storeId: sched.storeId,
        shiftId: morningShiftId,
        date: dayStart,
        carriedDeficit,
        carriedDeficitFetchedAt: now,
        unpaidAmount: '0.00',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return { success: true, data: created };
  } catch (err) {
    return { success: false, error: `getOrCreateSetoranForSchedule: ${err}` };
  }
}

export async function getSetoranForStoreDate(
  storeId: number,
  date: Date,
): Promise<SetoranTask | null> {
  const [row] = await db
    .select()
    .from(setoranTasks)
    .where(and(
      eq(setoranTasks.storeId, storeId),
      eq(setoranTasks.date, startOfDay(date)),
    ))
    .limit(1);

  return row ? await refreshPendingCarryForward(row) : null;
}


function actorFieldsForPatch(
  patch: SetoranAutoSavePatch,
  actor: SetoranActorContext,
  now: Date,
): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  if ('actualReceivedAmount' in patch || 'expectedAmount' in patch) {
    update.actualReceivedAmountBy = actor.userId;
    update.actualReceivedAmountAt = now;
  }

  if ('storedAmount' in patch || 'amount' in patch) {
    update.storedAmountBy = actor.userId;
    update.storedAmountAt = now;
  }

  if ('resiPhoto' in patch) {
    update.resiPhotoBy = actor.userId;
    update.resiPhotoAt = now;
  }

  if ('atmCardSelfiePhoto' in patch) {
    update.atmCardSelfiePhotoBy = actor.userId;
    update.atmCardSelfiePhotoAt = now;
  }

  if ('notes' in patch) {
    update.notesBy = actor.userId;
    update.notesAt = now;
  }

  return update;
}

function preserveSetoranFieldActors(
  existing: SetoranTask,
  input: SubmitSetoranInput,
  now: Date,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  if (!existing.actualReceivedAmountBy) {
    values.actualReceivedAmountBy = input.userId;
    values.actualReceivedAmountAt = now;
  }

  if (!existing.storedAmountBy) {
    values.storedAmountBy = input.userId;
    values.storedAmountAt = now;
  }

  if (!existing.resiPhotoBy) {
    values.resiPhotoBy = input.userId;
    values.resiPhotoAt = now;
  }

  if (!existing.atmCardSelfiePhotoBy) {
    values.atmCardSelfiePhotoBy = input.userId;
    values.atmCardSelfiePhotoAt = now;
  }

  if (input.notes !== undefined && !existing.notesBy) {
    values.notesBy = input.userId;
    values.notesAt = now;
  }

  return values;
}

function validateSetoranPayload(input: SubmitSetoranInput): string | null {
  const actualReceived = parseAmount(input.actualReceivedAmount ?? input.expectedAmount);
  if (actualReceived <= 0) return 'Nominal uang aktual diterima hari ini wajib diisi.';

  const stored = parseAmount(input.storedAmount ?? input.amount);
  if (stored <= 0) return 'Nominal uang yang disetor/disimpan wajib diisi.';

  if (!input.resiPhoto?.trim()) return 'Foto resi wajib diupload.';
  if (!input.atmCardSelfiePhoto?.trim()) return 'Foto selfie dengan kartu ATM wajib diupload.';

  return null;
}

export async function submitSetoran(
  input: SubmitSetoranInput,
): Promise<TaskResult<SetoranTask>> {
  try {
    const shiftErr = await assertMorningSchedule(input.scheduleId);
    if (shiftErr) return { success: false, error: shiftErr };

    const checkInErr = await assertCheckedIn(input.scheduleId);
    if (checkInErr) return { success: false, error: checkInErr };

    const validationErr = validateSetoranPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const ensured = await getOrCreateSetoranForSchedule(input.scheduleId);
    if (!ensured.success) return ensured;

    const existing = ensured.data;

    if (existing.status === 'completed') {
      return { success: false, error: 'Setoran hari ini sudah disubmit dan tidak bisa diubah lagi.' };
    }

    const actualReceived = parseAmount(input.actualReceivedAmount ?? input.expectedAmount);
    const previousUnpaid = parseAmount(await getPriorUnpaidForStore(existing.storeId, existing.date));
    const requiredStoreAmount = actualReceived + previousUnpaid;
    const stored = parseAmount(input.storedAmount ?? input.amount);

    if (stored > requiredStoreAmount) {
      return {
        success: false,
        error: `Nominal disetor (${stored.toLocaleString('id-ID')}) melebihi total yang wajib disetor (${requiredStoreAmount.toLocaleString('id-ID')}). Overpayment tidak diperbolehkan.`,
      };
    }

    const unpaid = Math.max(0, requiredStoreAmount - stored);
    const now = new Date();

    const [updated] = await db
      .update(setoranTasks)
      .set({
        scheduleId: input.scheduleId,
        userId: input.userId,
        expectedAmount: money(actualReceived),
        amount: money(stored),
        carriedDeficit: money(previousUnpaid),
        carriedDeficitFetchedAt: now,
        unpaidAmount: money(unpaid),
        resiPhoto: input.resiPhoto,
        atmCardSelfiePhoto: input.atmCardSelfiePhoto,
        notes: input.notes,
        ...preserveSetoranFieldActors(existing, input, now),
        completedBy: input.userId,
        completedByScheduleId: input.scheduleId,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(setoranTasks.id, existing.id))
      .returning();

    await db
      .insert(setoranMoneyStorage)
      .values({
        taskId: updated.id,
        scheduleId: input.scheduleId,
        userId: input.userId,
        storeId: updated.storeId,
        shiftId: updated.shiftId,
        date: startOfDay(updated.date),
        actualReceivedAmount: money(actualReceived),
        previousUnpaidAmount: money(previousUnpaid),
        requiredStoreAmount: money(requiredStoreAmount),
        storedAmount: money(stored),
        unpaidAmount: money(unpaid),
        resiPhoto: input.resiPhoto,
        atmCardSelfiePhoto: input.atmCardSelfiePhoto,
        notes: input.notes,
        actualReceivedAmountBy: updated.actualReceivedAmountBy,
        actualReceivedAmountAt: updated.actualReceivedAmountAt,
        storedAmountBy: updated.storedAmountBy,
        storedAmountAt: updated.storedAmountAt,
        resiPhotoBy: updated.resiPhotoBy,
        resiPhotoAt: updated.resiPhotoAt,
        atmCardSelfiePhotoBy: updated.atmCardSelfiePhotoBy,
        atmCardSelfiePhotoAt: updated.atmCardSelfiePhotoAt,
        notesBy: updated.notesBy,
        notesAt: updated.notesAt,
        completedBy: input.userId,
        completedByScheduleId: input.scheduleId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: setoranMoneyStorage.taskId,
        set: {
          scheduleId: input.scheduleId,
          userId: input.userId,
          storeId: updated.storeId,
          shiftId: updated.shiftId,
          date: startOfDay(updated.date),
          actualReceivedAmount: money(actualReceived),
          previousUnpaidAmount: money(previousUnpaid),
          requiredStoreAmount: money(requiredStoreAmount),
          storedAmount: money(stored),
          unpaidAmount: money(unpaid),
          resiPhoto: input.resiPhoto,
          atmCardSelfiePhoto: input.atmCardSelfiePhoto,
          notes: input.notes,
          actualReceivedAmountBy: updated.actualReceivedAmountBy,
          actualReceivedAmountAt: updated.actualReceivedAmountAt,
          storedAmountBy: updated.storedAmountBy,
          storedAmountAt: updated.storedAmountAt,
          resiPhotoBy: updated.resiPhotoBy,
          resiPhotoAt: updated.resiPhotoAt,
          atmCardSelfiePhotoBy: updated.atmCardSelfiePhotoBy,
          atmCardSelfiePhotoAt: updated.atmCardSelfiePhotoAt,
          notesBy: updated.notesBy,
          notesAt: updated.notesAt,
          completedBy: input.userId,
          completedByScheduleId: input.scheduleId,
          updatedAt: now,
        },
      });

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitSetoran: ${err}` };
  }
}

export async function autoSaveSetoran(
  scheduleId: number,
  patch: SetoranAutoSavePatch,
  actor?: SetoranActorContext,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const shiftErr = await assertMorningSchedule(scheduleId);
    if (shiftErr) return { success: false, error: shiftErr };

    const ensured = await getOrCreateSetoranForSchedule(scheduleId);
    if (!ensured.success) return { success: false, error: ensured.error };

    const existing = ensured.data;

    if (existing.status === 'completed') {
      return { success: true, data: { saved: [] } };
    }

    const now = new Date();
    const update: Record<string, unknown> = { updatedAt: now };

    if (actor) {
      Object.assign(update, actorFieldsForPatch(patch, actor, now));
    }

    if ('actualReceivedAmount' in patch) update.expectedAmount = patch.actualReceivedAmount;
    if ('expectedAmount' in patch) update.expectedAmount = patch.expectedAmount;
    if ('storedAmount' in patch) update.amount = patch.storedAmount;
    if ('amount' in patch) update.amount = patch.amount;
    if ('resiPhoto' in patch) update.resiPhoto = patch.resiPhoto ?? null;
    if ('atmCardSelfiePhoto' in patch) update.atmCardSelfiePhoto = patch.atmCardSelfiePhoto ?? null;
    if ('notes' in patch) update.notes = patch.notes;

    if (existing.status === 'pending') update.status = 'in_progress';

    await db
      .update(setoranTasks)
      .set(update)
      .where(eq(setoranTasks.id, existing.id));

    return {
      success: true,
      data: { saved: Object.keys(update).filter((k) => k !== 'updatedAt') },
    };
  } catch (err) {
    return { success: false, error: `autoSaveSetoran: ${err}` };
  }
}

export async function getSetoranBySchedule(scheduleId: number): Promise<SetoranTask | null> {
  const [row] = await db
    .select()
    .from(setoranTasks)
    .where(eq(setoranTasks.scheduleId, scheduleId))
    .limit(1);

  return row ? await refreshPendingCarryForward(row) : null;
}

export async function getSetoranById(id: number): Promise<SetoranTask | null> {
  const [row] = await db
    .select()
    .from(setoranTasks)
    .where(eq(setoranTasks.id, id))
    .limit(1);

  return row ? await refreshPendingCarryForward(row) : null;
}

export async function getSetoranStorageByTaskId(taskId: number): Promise<SetoranMoneyStorage | null> {
  const [row] = await db
    .select()
    .from(setoranMoneyStorage)
    .where(eq(setoranMoneyStorage.taskId, taskId))
    .limit(1);

  return row ?? null;
}

export async function getSetoranWithStorageById(id: number): Promise<SetoranWithStorage | null> {
  const task = await getSetoranById(id);
  if (!task) return null;
  const storage = await getSetoranStorageByTaskId(task.id);
  return { task, storage };
}

export async function getSetoranHistoryForStore(storeId: number, limit = 14): Promise<SetoranWithStorage[]> {
  const tasks = await db
    .select()
    .from(setoranTasks)
    .where(eq(setoranTasks.storeId, storeId))
    .orderBy(desc(setoranTasks.date))
    .limit(limit);

  const result: SetoranWithStorage[] = [];

  for (const task of tasks) {
    const storage = await getSetoranStorageByTaskId(task.id);
    result.push({ task, storage });
  }

  return result;
}

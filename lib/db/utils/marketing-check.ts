// lib/db/utils/marketing-check.ts
import type { GeoPoint } from '@/lib/geo';
import { assertInGeofence } from '@/lib/db/utils/geofence';
import { and, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import { isOpeningShift } from '@/lib/shift-tasks';
import { taskShiftIdFor } from '@/lib/db/utils/shift-lookup';
import {
  attendance,
  marketingCheckTasks,
  schedules,
  shifts,
  stores,
  type MarketingCheckTask,
} from '@/lib/db/schema';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type { GeoPoint };

export interface SubmitMarketingCheckInput {
  taskId?: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;

  /** true = there is marketing / a new promo to check; false = submit without the checklist. */
  hasMarketingCheck: boolean | null;

  promoName: boolean;
  promoPeriod: boolean;
  promoMechanism: boolean;
  randomShoeItems: boolean;
  randomNonShoeItems: boolean;
  sellTag: boolean;

  notes?: string;
}

export interface AutoSaveMarketingCheckInput {
  taskId?: number;
  scheduleId?: number;
  userId?: string;
  storeId?: number;
  geo?: GeoPoint | null;
  skipGeo?: boolean;

  hasMarketingCheck?: boolean | null;

  promoName?: boolean;
  promoPeriod?: boolean;
  promoMechanism?: boolean;
  randomShoeItems?: boolean;
  randomNonShoeItems?: boolean;
  sellTag?: boolean;

  notes?: string | null;
}

export type MarketingCheckAutoSavePatch = AutoSaveMarketingCheckInput;

const BOOLEAN_FIELDS = [
  'promoName',
  'promoPeriod',
  'promoMechanism',
  'randomShoeItems',
  'randomNonShoeItems',
  'sellTag',
] as const;

type BooleanField = typeof BOOLEAN_FIELDS[number];

const ACTOR_COLUMNS: Record<BooleanField, { by: string; at: string }> = {
  promoName: { by: 'promoNameBy', at: 'promoNameAt' },
  promoPeriod: { by: 'promoPeriodBy', at: 'promoPeriodAt' },
  promoMechanism: { by: 'promoMechanismBy', at: 'promoMechanismAt' },
  randomShoeItems: { by: 'randomShoeItemsBy', at: 'randomShoeItemsAt' },
  randomNonShoeItems: { by: 'randomNonShoeItemsBy', at: 'randomNonShoeItemsAt' },
  sellTag: { by: 'sellTagBy', at: 'sellTagAt' },
};

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [row] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);

  return row?.checkInTime
    ? null
    : 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
}

async function assertCanProgressTask(input: {
  scheduleId: number;
  storeId: number;
  geo?: GeoPoint | null;
  skipGeo?: boolean;
}): Promise<string | null> {
  const checkInError = await assertCheckedIn(input.scheduleId);
  if (checkInError) return checkInError;

  if (!input.skipGeo) {
    if (!input.geo) return 'Lokasi wajib aktif untuk mengerjakan Marketing Check.';
    const geoError = await assertInGeofence(input.storeId, input.geo);
    if (geoError) return geoError;
  }

  return null;
}

async function assertMorningSchedule(scheduleId: number): Promise<string | null> {
  const [row] = await db
    .select({ shiftCode: shifts.code })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!row) return 'Schedule tidak ditemukan.';
  if (!isOpeningShift(row.shiftCode)) {
    return 'Marketing Check hanya tersedia untuk shift morning.';
  }

  return null;
}

async function findByTaskId(taskId: number): Promise<MarketingCheckTask | null> {
  if (!Number.isFinite(taskId) || taskId <= 0) return null;

  const [row] = await db
    .select()
    .from(marketingCheckTasks)
    .where(eq(marketingCheckTasks.id, taskId))
    .limit(1);

  return row ?? null;
}

async function findByScheduleId(scheduleId: number): Promise<MarketingCheckTask | null> {
  const [row] = await db
    .select()
    .from(marketingCheckTasks)
    .where(eq(marketingCheckTasks.scheduleId, scheduleId))
    .limit(1);

  return row ?? null;
}

async function findByStoreDate(storeId: number, date: Date): Promise<MarketingCheckTask | null> {
  const [row] = await db
    .select()
    .from(marketingCheckTasks)
    .where(and(
      eq(marketingCheckTasks.storeId, storeId),
      gte(marketingCheckTasks.date, startOfDay(date)),
      lte(marketingCheckTasks.date, endOfDay(date)),
    ))
    .limit(1);

  return row ?? null;
}

function actorUpdateForBoolean(field: BooleanField, value: boolean, userId?: string, now = new Date()) {
  const actor = ACTOR_COLUMNS[field];
  const update: Record<string, unknown> = { [field]: value };

  if (userId) {
    update[actor.by] = value ? userId : null;
    update[actor.at] = value ? now : null;
  }

  return update;
}

function buildChecklistUpdate(
  patch: Partial<Record<BooleanField, boolean>>,
  userId?: string,
  now = new Date(),
): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  for (const field of BOOLEAN_FIELDS) {
    if (field in patch && typeof patch[field] === 'boolean') {
      Object.assign(update, actorUpdateForBoolean(field, patch[field] as boolean, userId, now));
    }
  }

  return update;
}

function buildSubmitChecklistUpdate(
  existing: MarketingCheckTask,
  patch: Record<BooleanField, boolean>,
  userId: string,
  now = new Date(),
): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  for (const field of BOOLEAN_FIELDS) {
    const value = patch[field];
    const actor = ACTOR_COLUMNS[field];
    update[field] = value;

    // Preserve the employee who actually checked this field during autosave.
    // If it was never autosaved, the submitter becomes the checker for this field.
    if (value && !existing[actor.by as keyof MarketingCheckTask]) {
      update[actor.by] = userId;
      update[actor.at] = now;
    }
  }

  return update;
}

// "Tidak ada marketing / promo baru": the checklist is skipped, so any ticks
// left over from autosave are cleared rather than submitted.
function buildSkippedChecklistUpdate(): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  for (const field of BOOLEAN_FIELDS) {
    const actor = ACTOR_COLUMNS[field];
    update[field] = false;
    update[actor.by] = null;
    update[actor.at] = null;
  }

  return update;
}

function validateSubmit(input: SubmitMarketingCheckInput): string | null {
  if (input.hasMarketingCheck === null) {
    return 'Pilih dulu: ada marketing / promo baru hari ini atau tidak.';
  }
  // Nothing to check today — submit without the checklist.
  if (!input.hasMarketingCheck) return null;
  if (!input.promoName) return 'Checklist Nama Promo belum ditandai.';
  if (!input.promoPeriod) return 'Checklist Periode Promo belum ditandai.';
  if (!input.promoMechanism) return 'Checklist Mekanisme Promo belum ditandai.';
  if (!input.randomShoeItems) return 'Checklist Random 5 Item Sepatu belum ditandai.';
  if (!input.randomNonShoeItems) return 'Checklist Random 5 Item Non-Sepatu belum ditandai.';
  if (!input.sellTag) return 'Checklist Sell Tag belum ditandai.';
  return null;
}

export async function getOrCreateMarketingCheckForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  rawShiftId: number,
  date: Date,
): Promise<TaskResult<MarketingCheckTask>> {
  // JKP shifts work their base shift's store-level row (JP → morning, JS → evening).
  const shiftId = await taskShiftIdFor(rawShiftId);
  try {
    const existing = await findByScheduleId(scheduleId) ?? await findByStoreDate(storeId, date);
    if (existing) return { success: true, data: existing };

    const [row] = await db
      .insert(marketingCheckTasks)
      .values({
        scheduleId,
        userId,
        storeId,
        shiftId,
        date: startOfDay(date),
        status: 'not_started',
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    return { success: true, data: row ?? (await findByStoreDate(storeId, date))! };
  } catch (error) {
    return { success: false, error: `getOrCreateMarketingCheckForSchedule: ${error}` };
  }
}

export async function autoSaveMarketingCheck(
  scheduleOrInput: number | AutoSaveMarketingCheckInput,
  maybePatch?: AutoSaveMarketingCheckInput,
): Promise<TaskResult<{ saved: string[]; task: MarketingCheckTask }>> {
  try {
    const input: AutoSaveMarketingCheckInput =
      typeof scheduleOrInput === 'number'
        ? { ...(maybePatch ?? {}), scheduleId: scheduleOrInput }
        : scheduleOrInput;

    const existing =
      (input.taskId ? await findByTaskId(input.taskId) : null) ??
      (input.scheduleId ? await findByScheduleId(input.scheduleId) : null) ??
      (input.storeId ? await findByStoreDate(input.storeId, new Date()) : null);

    if (!existing) return { success: false, error: 'Marketing Check task tidak ditemukan.' };
    if (existing.status === 'completed') {
      return { success: true, data: { saved: [], task: existing } };
    }

    const scheduleId = input.scheduleId ?? existing.scheduleId;
    const storeId = input.storeId ?? existing.storeId;
    const gateError = await assertCanProgressTask({
      scheduleId,
      storeId,
      geo: input.geo,
      skipGeo: input.skipGeo,
    });
    if (gateError) return { success: false, error: gateError };

    const morningError = await assertMorningSchedule(scheduleId);
    if (morningError) return { success: false, error: morningError };

    const now = new Date();
    const update: Record<string, unknown> = {
      updatedAt: now,
      scheduleId,
      storeId,
    };

    if (input.userId) update.userId = input.userId;
    if (existing.status === 'not_started') update.status = 'in_progress';

    if ('hasMarketingCheck' in input && input.hasMarketingCheck !== undefined) {
      update.hasMarketingCheck = input.hasMarketingCheck;
    }

    Object.assign(update, buildChecklistUpdate(input, input.userId, now));

    if ('notes' in input) {
      update.notes = input.notes ?? null;
      if (input.userId) {
        update.notesBy = input.userId;
        update.notesAt = now;
      }
    }

    const [task] = await db
      .update(marketingCheckTasks)
      .set(update)
      .where(eq(marketingCheckTasks.id, existing.id))
      .returning();

    return {
      success: true,
      data: {
        saved: Object.keys(update).filter((key) => key !== 'updatedAt'),
        task,
      },
    };
  } catch (error) {
    return { success: false, error: `autoSaveMarketingCheck: ${error}` };
  }
}

export async function submitMarketingCheck(
  input: SubmitMarketingCheckInput,
): Promise<TaskResult<MarketingCheckTask>> {
  try {
    const gateError = await assertCanProgressTask(input);
    if (gateError) return { success: false, error: gateError };

    const morningError = await assertMorningSchedule(input.scheduleId);
    if (morningError) return { success: false, error: morningError };

    const validationError = validateSubmit(input);
    if (validationError) return { success: false, error: validationError };

    const existing =
      (input.taskId ? await findByTaskId(input.taskId) : null) ??
      (await findByScheduleId(input.scheduleId)) ??
      (await findByStoreDate(input.storeId, new Date()));

    if (!existing) return { success: false, error: 'Marketing Check task tidak ditemukan.' };
    if (existing?.status === 'completed') return { success: false, error: 'Marketing Check sudah selesai.' };

    const now = new Date();
    const update = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      notesBy: input.notes !== existing.notes ? input.userId : existing.notesBy,
      notesAt: input.notes !== existing.notes ? now : existing.notesAt,
      status: 'completed' as const,
      completedAt: now,
      completedBy: input.userId,
      completedByScheduleId: input.scheduleId,
      updatedAt: now,
      hasMarketingCheck: input.hasMarketingCheck,
      ...(input.hasMarketingCheck
        ? buildSubmitChecklistUpdate(existing, {
            promoName: input.promoName,
            promoPeriod: input.promoPeriod,
            promoMechanism: input.promoMechanism,
            randomShoeItems: input.randomShoeItems,
            randomNonShoeItems: input.randomNonShoeItems,
            sellTag: input.sellTag,
          }, input.userId, now)
        : buildSkippedChecklistUpdate()),
    };

    const [task] = await db
      .update(marketingCheckTasks)
      .set(update)
      .where(eq(marketingCheckTasks.id, existing.id))
      .returning();

    return { success: true, data: task };
  } catch (error) {
    return { success: false, error: `submitMarketingCheck: ${error}` };
  }
}

export async function getMarketingCheckById(id: number): Promise<MarketingCheckTask | null> {
  return findByTaskId(id);
}

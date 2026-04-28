// lib/db/utils/marketing-check.ts

import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import {
  marketingCheckTasks,
  shifts,
  schedules,
  attendance,
  type MarketingCheckTask,
} from '@/lib/db/schema';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface SubmitMarketingCheckInput {
  scheduleId: number;
  userId: string;
  storeId: number;
  geo?: GeoPoint | null;
  skipGeo?: boolean;

  promoName: boolean;
  promoPeriod: boolean;
  promoMechanism: boolean;
  randomShoeItems: boolean;
  randomNonShoeItems: boolean;
  sellTag: boolean;

  notes?: string;
}

export interface MarketingCheckAutoSavePatch {
  promoName?: boolean;
  promoPeriod?: boolean;
  promoMechanism?: boolean;
  randomShoeItems?: boolean;
  randomNonShoeItems?: boolean;
  sellTag?: boolean;
  notes?: string;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

let _morningShiftIdCache: number | null = null;
let _eveningShiftIdCache: number | null = null;

async function getShiftIdByCode(code: 'morning' | 'evening'): Promise<number> {
  if (code === 'morning' && _morningShiftIdCache != null) return _morningShiftIdCache;
  if (code === 'evening' && _eveningShiftIdCache != null) return _eveningShiftIdCache;

  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(eq(shifts.code, code))
    .limit(1);

  if (!row) throw new Error(`${code} shift not found in shifts table.`);

  if (code === 'morning') _morningShiftIdCache = row.id;
  if (code === 'evening') _eveningShiftIdCache = row.id;

  return row.id;
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

function validateMarketingCheckPayload(input: SubmitMarketingCheckInput): string | null {
  if (!input.promoName) return 'Checklist "Nama promo" belum ditandai.';
  if (!input.promoPeriod) return 'Checklist "Periode promo" belum ditandai.';
  if (!input.promoMechanism) return 'Checklist "Mekanisme promo" belum ditandai.';
  if (!input.randomShoeItems) return 'Checklist "5 item sepatu" belum ditandai.';
  if (!input.randomNonShoeItems) return 'Checklist "5 item non-sepatu" belum ditandai.';
  if (!input.sellTag) return 'Checklist "Sell tag" belum ditandai.';
  return null;
}

export async function getOrCreateMarketingCheckForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<TaskResult<MarketingCheckTask>> {
  try {
    const [existingBySchedule] = await db
      .select()
      .from(marketingCheckTasks)
      .where(eq(marketingCheckTasks.scheduleId, scheduleId))
      .limit(1);

    if (existingBySchedule) return { success: true, data: existingBySchedule };

    const dayStart = startOfDay(date);

    const [existingByStoreDateShift] = await db
      .select()
      .from(marketingCheckTasks)
      .where(and(
        eq(marketingCheckTasks.storeId, storeId),
        eq(marketingCheckTasks.shiftId, shiftId),
        eq(marketingCheckTasks.date, dayStart),
      ))
      .limit(1);

    if (existingByStoreDateShift) return { success: true, data: existingByStoreDateShift };

    const [created] = await db
      .insert(marketingCheckTasks)
      .values({
        scheduleId,
        userId,
        storeId,
        shiftId,
        date: dayStart,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { success: true, data: created };
  } catch (err) {
    return { success: false, error: `getOrCreateMarketingCheckForSchedule: ${err}` };
  }
}

export async function submitMarketingCheck(
  input: SubmitMarketingCheckInput,
): Promise<TaskResult<MarketingCheckTask>> {
  try {
    const checkInErr = await assertCheckedIn(input.scheduleId);
    if (checkInErr) return { success: false, error: checkInErr };

    const validationErr = validateMarketingCheckPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const [existing] = await db
      .select()
      .from(marketingCheckTasks)
      .where(eq(marketingCheckTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Marketing Check task not found.' };
    }

    if (existing.status === 'verified') {
      return { success: false, error: 'Marketing Check sudah diverifikasi.' };
    }

    const now = new Date();

    const [updated] = await db
      .update(marketingCheckTasks)
      .set({
        userId: input.userId,
        promoName: input.promoName,
        promoPeriod: input.promoPeriod,
        promoMechanism: input.promoMechanism,
        randomShoeItems: input.randomShoeItems,
        randomNonShoeItems: input.randomNonShoeItems,
        sellTag: input.sellTag,
        submittedLat: input.geo?.lat != null ? String(input.geo.lat) : null,
        submittedLng: input.geo?.lng != null ? String(input.geo.lng) : null,
        notes: input.notes,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(marketingCheckTasks.id, existing.id))
      .returning();

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitMarketingCheck: ${err}` };
  }
}

export async function autoSaveMarketingCheck(
  scheduleId: number,
  patch: MarketingCheckAutoSavePatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: marketingCheckTasks.id, status: marketingCheckTasks.status })
      .from(marketingCheckTasks)
      .where(eq(marketingCheckTasks.scheduleId, scheduleId))
      .limit(1);

    if (!existing) return { success: false, error: 'Marketing Check task not found.' };
    if (existing.status === 'verified') return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('promoName' in patch) update.promoName = Boolean(patch.promoName);
    if ('promoPeriod' in patch) update.promoPeriod = Boolean(patch.promoPeriod);
    if ('promoMechanism' in patch) update.promoMechanism = Boolean(patch.promoMechanism);
    if ('randomShoeItems' in patch) update.randomShoeItems = Boolean(patch.randomShoeItems);
    if ('randomNonShoeItems' in patch) update.randomNonShoeItems = Boolean(patch.randomNonShoeItems);
    if ('sellTag' in patch) update.sellTag = Boolean(patch.sellTag);
    if ('notes' in patch) update.notes = patch.notes;

    if (existing.status === 'pending') update.status = 'in_progress';

    await db
      .update(marketingCheckTasks)
      .set(update)
      .where(eq(marketingCheckTasks.id, existing.id));

    return {
      success: true,
      data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') },
    };
  } catch (err) {
    return { success: false, error: `autoSaveMarketingCheck: ${err}` };
  }
}

export async function getMarketingCheckBySchedule(scheduleId: number): Promise<MarketingCheckTask | null> {
  const [row] = await db
    .select()
    .from(marketingCheckTasks)
    .where(eq(marketingCheckTasks.scheduleId, scheduleId))
    .limit(1);

  return row ?? null;
}

export async function getMarketingCheckById(id: number): Promise<MarketingCheckTask | null> {
  const [row] = await db
    .select()
    .from(marketingCheckTasks)
    .where(eq(marketingCheckTasks.id, id))
    .limit(1);

  return row ?? null;
}
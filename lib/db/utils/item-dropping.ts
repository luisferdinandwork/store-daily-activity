// lib/db/utils/item-dropping.ts
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  itemDroppingTasks,
  itemDroppingEntries,
  schedules,
  type ItemDroppingTask,
  type ItemDroppingEntry,
} from '@/lib/db/schema';
import {
  getMorningShiftId,
  getEveningShiftId,
  getFullDayShiftId,
  startOfDay,
  endOfDay,
} from '@/lib/db/utils/shift-lookup';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface AutoSaveItemDroppingPatch {
  notes?: string;
}

export async function getActiveItemDroppingTask(
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemDroppingTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [today] = await db
    .select()
    .from(itemDroppingTasks)
    .where(and(
      eq(itemDroppingTasks.storeId, storeId),
      eq(itemDroppingTasks.shiftId, shiftId),
      gte(itemDroppingTasks.date, dayStart),
      lte(itemDroppingTasks.date, dayEnd),
    ))
    .limit(1);

  return today ?? null;
}

export async function getItemDroppingEntries(
  taskId: number,
): Promise<ItemDroppingEntry[]> {
  return db
    .select()
    .from(itemDroppingEntries)
    .where(eq(itemDroppingEntries.taskId, taskId))
    .orderBy(itemDroppingEntries.dropTime);
}

export async function autoSaveItemDroppingById(
  taskId: number,
  patch: AutoSaveItemDroppingPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({
        id: itemDroppingTasks.id,
        status: itemDroppingTasks.status,
      })
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.id, taskId))
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Item dropping task not found.' };
    }

    if (existing.status === 'completed') {
      return { success: true, data: { saved: [] } };
    }

    const update: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if ('notes' in patch) {
      update.notes = patch.notes;
    }

    await db
      .update(itemDroppingTasks)
      .set(update)
      .where(eq(itemDroppingTasks.id, existing.id));

    return {
      success: true,
      data: {
        saved: Object.keys(update).filter((key) => key !== 'updatedAt'),
      },
    };
  } catch (err) {
    return { success: false, error: `autoSaveItemDroppingById: ${err}` };
  }
}

export async function autoSaveItemDropping(
  scheduleId: number,
  patch: AutoSaveItemDroppingPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date, shiftId: schedules.shiftId })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) {
    return { success: false, error: 'Schedule not found.' };
  }

  const fullDayShiftId = await getFullDayShiftId();
  const targetShiftId = schedule.shiftId === fullDayShiftId
    ? await getMorningShiftId()
    : schedule.shiftId;

  const existing = await getActiveItemDroppingTask(schedule.storeId, targetShiftId, schedule.date);

  if (!existing) {
    return { success: false, error: 'Item dropping task not found.' };
  }

  return autoSaveItemDroppingById(existing.id, patch);
}

async function getOrCreateSingleItemDroppingRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  targetShiftId: number,
  date: Date,
): Promise<ItemDroppingTask> {
  const existing = await getActiveItemDroppingTask(storeId, targetShiftId, date);
  if (existing) return existing;

  const dayStart = startOfDay(date);

  const [row] = await db
    .insert(itemDroppingTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: targetShiftId,
      date: dayStart,
      hasDropping: false,
      status: 'not_started',
    })
    .onConflictDoNothing()
    .returning();

  return row ?? (await getActiveItemDroppingTask(storeId, targetShiftId, date))!;
}

/**
 * Ensures the item dropping row(s) for this schedule's shift exist. A
 * full_day schedule gets BOTH the morning and evening rows (mirrors
 * briefing/serah terima); a morning/evening schedule gets its own row,
 * shared with every other employee on that same shift/store/day.
 */
export async function getOrCreateItemDroppingForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemDroppingTask[]> {
  const morningShiftId = await getMorningShiftId();
  const eveningShiftId = await getEveningShiftId();
  const fullDayShiftId = await getFullDayShiftId();

  const targetShiftIds =
    shiftId === fullDayShiftId ? [morningShiftId, eveningShiftId] : [shiftId];

  const rows: ItemDroppingTask[] = [];
  for (const targetShiftId of targetShiftIds) {
    rows.push(
      await getOrCreateSingleItemDroppingRow(scheduleId, userId, storeId, targetShiftId, date),
    );
  }

  return rows;
}

/**
 * Single-row variant for flows that already know exactly which shift's row
 * they need (e.g. the BC transfer-order sync pipeline, which re-syncs
 * whichever specific task the employee currently has open — see
 * lib/db/utils/item-transfers.ts).
 */
export async function getOrCreateItemDroppingRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  targetShiftId: number,
  date: Date,
): Promise<ItemDroppingTask> {
  return getOrCreateSingleItemDroppingRow(scheduleId, userId, storeId, targetShiftId, date);
}

export async function getItemDroppingBySchedule(
  scheduleId: number,
): Promise<ItemDroppingTask | null> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date, shiftId: schedules.shiftId })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return null;

  const fullDayShiftId = await getFullDayShiftId();
  const targetShiftId = schedule.shiftId === fullDayShiftId
    ? await getMorningShiftId()
    : schedule.shiftId;

  return getActiveItemDroppingTask(schedule.storeId, targetShiftId, schedule.date);
}

export async function getItemDroppingById(
  id: number,
): Promise<ItemDroppingTask | null> {
  const [row] = await db
    .select()
    .from(itemDroppingTasks)
    .where(eq(itemDroppingTasks.id, id))
    .limit(1);

  return row ?? null;
}

export async function getItemDroppingWithEntries(
  taskId: number,
): Promise<{ task: ItemDroppingTask; entries: ItemDroppingEntry[] } | null> {
  const task = await getItemDroppingById(taskId);
  if (!task) return null;

  const entries = await getItemDroppingEntries(taskId);

  return { task, entries };
}

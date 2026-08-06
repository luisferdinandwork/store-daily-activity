// lib/db/utils/item-return.ts
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  itemReturnTasks,
  itemReturnEntries,
  schedules,
  type ItemReturnTask,
  type ItemReturnEntry,
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

export interface AutoSaveItemReturnPatch {
  notes?: string;
}

export async function getActiveItemReturnTask(
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemReturnTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [today] = await db
    .select()
    .from(itemReturnTasks)
    .where(and(
      eq(itemReturnTasks.storeId, storeId),
      eq(itemReturnTasks.shiftId, shiftId),
      gte(itemReturnTasks.date, dayStart),
      lte(itemReturnTasks.date, dayEnd),
    ))
    .limit(1);

  return today ?? null;
}

export async function getItemReturnEntries(taskId: number): Promise<ItemReturnEntry[]> {
  return db
    .select()
    .from(itemReturnEntries)
    .where(eq(itemReturnEntries.taskId, taskId))
    .orderBy(itemReturnEntries.returnTime);
}

export async function autoSaveItemReturnById(
  taskId: number,
  patch: AutoSaveItemReturnPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: itemReturnTasks.id, status: itemReturnTasks.status })
      .from(itemReturnTasks)
      .where(eq(itemReturnTasks.id, taskId))
      .limit(1);

    if (!existing) return { success: false, error: 'Item return task not found.' };
    if (existing.status === 'completed') return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ('notes' in patch) update.notes = patch.notes;

    await db.update(itemReturnTasks).set(update).where(eq(itemReturnTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter((key) => key !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveItemReturnById: ${err}` };
  }
}

export async function autoSaveItemReturn(
  scheduleId: number,
  patch: AutoSaveItemReturnPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date, shiftId: schedules.shiftId })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return { success: false, error: 'Schedule not found.' };

  const fullDayShiftId = await getFullDayShiftId();
  const targetShiftId = schedule.shiftId === fullDayShiftId
    ? await getMorningShiftId()
    : schedule.shiftId;

  const existing = await getActiveItemReturnTask(schedule.storeId, targetShiftId, schedule.date);

  if (!existing) return { success: false, error: 'Item return task not found.' };
  return autoSaveItemReturnById(existing.id, patch);
}

async function getOrCreateSingleItemReturnRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  targetShiftId: number,
  date: Date,
): Promise<ItemReturnTask> {
  const existing = await getActiveItemReturnTask(storeId, targetShiftId, date);
  if (existing) return existing;

  const dayStart = startOfDay(date);

  const [row] = await db
    .insert(itemReturnTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: targetShiftId,
      date: dayStart,
      hasReturn: false,
      status: 'not_started',
    })
    .onConflictDoNothing()
    .returning();

  return row ?? (await getActiveItemReturnTask(storeId, targetShiftId, date))!;
}

/**
 * Ensures the item return row(s) for this schedule's shift exist. A
 * full_day schedule gets BOTH the morning and evening rows (mirrors
 * briefing/serah terima); a morning/evening schedule gets its own row,
 * shared with every other employee on that same shift/store/day.
 */
export async function getOrCreateItemReturnForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemReturnTask[]> {
  const morningShiftId = await getMorningShiftId();
  const eveningShiftId = await getEveningShiftId();
  const fullDayShiftId = await getFullDayShiftId();

  const targetShiftIds =
    shiftId === fullDayShiftId ? [morningShiftId, eveningShiftId] : [shiftId];

  const rows: ItemReturnTask[] = [];
  for (const targetShiftId of targetShiftIds) {
    rows.push(
      await getOrCreateSingleItemReturnRow(scheduleId, userId, storeId, targetShiftId, date),
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
export async function getOrCreateItemReturnRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  targetShiftId: number,
  date: Date,
): Promise<ItemReturnTask> {
  return getOrCreateSingleItemReturnRow(scheduleId, userId, storeId, targetShiftId, date);
}

export async function getItemReturnBySchedule(scheduleId: number): Promise<ItemReturnTask | null> {
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

  return getActiveItemReturnTask(schedule.storeId, targetShiftId, schedule.date);
}

export async function getItemReturnById(id: number): Promise<ItemReturnTask | null> {
  const [row] = await db.select().from(itemReturnTasks).where(eq(itemReturnTasks.id, id)).limit(1);
  return row ?? null;
}

export async function getItemReturnWithEntries(
  taskId: number,
): Promise<{ task: ItemReturnTask; entries: ItemReturnEntry[] } | null> {
  const task = await getItemReturnById(taskId);
  if (!task) return null;
  const entries = await getItemReturnEntries(taskId);
  return { task, entries };
}

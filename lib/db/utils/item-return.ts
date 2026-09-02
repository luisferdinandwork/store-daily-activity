// lib/db/utils/item-return.ts
//
// Item Return is a per-STORE, per-DAY shared task — one row for the whole
// store, seen and actionable by every shift (transfer orders belong to a
// store, not a shift). `shiftId` on the row is just provenance.
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  itemReturnTasks,
  itemReturnEntries,
  schedules,
  type ItemReturnTask,
  type ItemReturnEntry,
} from '@/lib/db/schema';
import { startOfDay, endOfDay } from '@/lib/db/utils/shift-lookup';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface AutoSaveItemReturnPatch {
  notes?: string;
}

export async function getActiveItemReturnTask(
  storeId: number,
  date: Date,
): Promise<ItemReturnTask | null> {
  const [today] = await db
    .select()
    .from(itemReturnTasks)
    .where(and(
      eq(itemReturnTasks.storeId, storeId),
      gte(itemReturnTasks.date, startOfDay(date)),
      lte(itemReturnTasks.date, endOfDay(date)),
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
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return { success: false, error: 'Schedule not found.' };

  const existing = await getActiveItemReturnTask(schedule.storeId, schedule.date);
  if (!existing) return { success: false, error: 'Item return task not found.' };
  return autoSaveItemReturnById(existing.id, patch);
}

/**
 * Get-or-create the single store/day Item Return task, shared by every shift.
 * `shiftId` is stored as provenance (the shift that created it).
 */
export async function getOrCreateItemReturnRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemReturnTask> {
  const existing = await getActiveItemReturnTask(storeId, date);
  if (existing) return existing;

  const [row] = await db
    .insert(itemReturnTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId,
      date: startOfDay(date),
      hasReturn: false,
      status: 'not_started',
    })
    .onConflictDoNothing({ target: [itemReturnTasks.storeId, itemReturnTasks.date] })
    .returning();

  return row ?? (await getActiveItemReturnTask(storeId, date))!;
}

/** Back-compat alias — the store/day task is the same for any shift now. */
export async function getOrCreateItemReturnForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemReturnTask> {
  return getOrCreateItemReturnRow(scheduleId, userId, storeId, shiftId, date);
}

export async function getItemReturnBySchedule(scheduleId: number): Promise<ItemReturnTask | null> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return null;
  return getActiveItemReturnTask(schedule.storeId, schedule.date);
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

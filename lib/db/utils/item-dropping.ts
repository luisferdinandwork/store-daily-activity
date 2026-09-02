// lib/db/utils/item-dropping.ts
//
// Item Receiving (Dropping) is a per-STORE, per-DAY shared task — one row for
// the whole store, seen and actionable by every shift. `shiftId` on the row
// is just provenance.
import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  itemDroppingTasks,
  itemDroppingEntries,
  schedules,
  type ItemDroppingTask,
  type ItemDroppingEntry,
} from '@/lib/db/schema';
import { startOfDay, endOfDay } from '@/lib/db/utils/shift-lookup';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface AutoSaveItemDroppingPatch {
  notes?: string;
}

export async function getActiveItemDroppingTask(
  storeId: number,
  date: Date,
): Promise<ItemDroppingTask | null> {
  const [today] = await db
    .select()
    .from(itemDroppingTasks)
    .where(and(
      eq(itemDroppingTasks.storeId, storeId),
      gte(itemDroppingTasks.date, startOfDay(date)),
      lte(itemDroppingTasks.date, endOfDay(date)),
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
      .select({ id: itemDroppingTasks.id, status: itemDroppingTasks.status })
      .from(itemDroppingTasks)
      .where(eq(itemDroppingTasks.id, taskId))
      .limit(1);

    if (!existing) return { success: false, error: 'Item dropping task not found.' };
    if (existing.status === 'completed') return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ('notes' in patch) update.notes = patch.notes;

    await db.update(itemDroppingTasks).set(update).where(eq(itemDroppingTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter((key) => key !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveItemDroppingById: ${err}` };
  }
}

export async function autoSaveItemDropping(
  scheduleId: number,
  patch: AutoSaveItemDroppingPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return { success: false, error: 'Schedule not found.' };

  const existing = await getActiveItemDroppingTask(schedule.storeId, schedule.date);
  if (!existing) return { success: false, error: 'Item dropping task not found.' };
  return autoSaveItemDroppingById(existing.id, patch);
}

/**
 * Get-or-create the single store/day Item Receiving task, shared by every
 * shift. `shiftId` is stored as provenance.
 */
export async function getOrCreateItemDroppingRow(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemDroppingTask> {
  const existing = await getActiveItemDroppingTask(storeId, date);
  if (existing) return existing;

  const [row] = await db
    .insert(itemDroppingTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId,
      date: startOfDay(date),
      hasDropping: false,
      status: 'not_started',
    })
    .onConflictDoNothing({ target: [itemDroppingTasks.storeId, itemDroppingTasks.date] })
    .returning();

  return row ?? (await getActiveItemDroppingTask(storeId, date))!;
}

/** Back-compat alias — the store/day task is the same for any shift now. */
export async function getOrCreateItemDroppingForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date,
): Promise<ItemDroppingTask> {
  return getOrCreateItemDroppingRow(scheduleId, userId, storeId, shiftId, date);
}

export async function getItemDroppingBySchedule(
  scheduleId: number,
): Promise<ItemDroppingTask | null> {
  const [schedule] = await db
    .select({ storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!schedule) return null;
  return getActiveItemDroppingTask(schedule.storeId, schedule.date);
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

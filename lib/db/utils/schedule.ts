// lib/db/utils/schedule.ts
// ─────────────────────────────────────────────────────────────────────────────
// Monthly schedule management.
// Tasks are created via lib/db/utils/tasks.ts::materialiseTasksForSchedule.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import {
  areas, users, stores,
  monthlySchedules, monthlyScheduleEntries, schedules, attendance,
  type Area, type MonthlySchedule, type MonthlyScheduleEntry,
} from '@/lib/db/schema';
import { eq, and, gte, lte, inArray, isNull, sql } from 'drizzle-orm';
import { materialiseTasksForSchedule, deleteTasksForSchedule } from './tasks';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SHIFT_CONFIG = {
  morning: { startHour: 8,  endHour: 17, lateAfterMinutes: 30, breakType: 'lunch'  as const },
  evening: { startHour: 13, endHour: 22, lateAfterMinutes: 30, breakType: 'dinner' as const },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Shift = 'morning' | 'evening';

export interface DayAssignment {
  userId:  string;
  storeId: number;   // serial integer PK
  date:    Date;
  shift:   Shift | null;
  isOff:   boolean;
  isLeave: boolean;
}

export interface CreateMonthlyScheduleInput {
  storeId:    number;   // serial integer PK
  yearMonth:  string;
  entries:    DayAssignment[];
  note?:      string;
  importedBy: string;
}

export interface MonthlyScheduleWithEntries {
  schedule: MonthlySchedule;
  entries:  (MonthlyScheduleEntry & { userName: string | null; userEmployeeType: string | null })[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
export function endOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}
export function yearMonthToDate(ym: string): Date {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
}
export function dateToYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Authorization ────────────────────────────────────────────────────────────

export async function canManageSchedule(
  actorId: string,
  storeId: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const [actor] = await db
    .select({
      role:         users.role,
      employeeType: users.employeeType,
      homeStoreId:  users.homeStoreId,
      areaId:       users.areaId,
    })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  if (!actor) return { allowed: false, reason: 'Actor not found.' };

  if (actor.role === 'ops') {
    if (!actor.areaId) return { allowed: false, reason: 'OPS user has no area assigned.' };
    const [targetStore] = await db
      .select({ areaId: stores.areaId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!targetStore) return { allowed: false, reason: 'Store not found.' };
    if (targetStore.areaId !== actor.areaId)
      return { allowed: false, reason: 'This store is not in your area.' };
    return { allowed: true };
  }

  if (actor.employeeType === 'pic_1') {
    if (actor.homeStoreId !== storeId)
      return { allowed: false, reason: 'PIC 1 can only manage schedules for their home store.' };
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:  'Only OPS (for their area) or PIC 1 (for their store) can manage schedules.',
  };
}

// ─── Monthly Schedule CRUD ────────────────────────────────────────────────────

export async function createOrReplaceMonthlySchedule(
  data: CreateMonthlyScheduleInput,
): Promise<{ success: boolean; scheduleId?: number; error?: string }> {
  try {
    const auth = await canManageSchedule(data.importedBy, data.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };
    if (!data.entries.length) return { success: false, error: 'No entries provided.' };

    const [existing] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(
        and(
          eq(monthlySchedules.storeId,   data.storeId),
          eq(monthlySchedules.yearMonth, data.yearMonth),
        ),
      )
      .limit(1);

    let monthlyScheduleId: number;

    if (existing) {
      monthlyScheduleId = existing.id;

      const entriesToCheck = await db
        .select({
          id:      monthlyScheduleEntries.id,
          shift:   monthlyScheduleEntries.shift,
          isOff:   monthlyScheduleEntries.isOff,
          isLeave: monthlyScheduleEntries.isLeave,
        })
        .from(monthlyScheduleEntries)
        .where(eq(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleId));

      const deletableIds: number[] = [];
      for (const entry of entriesToCheck) {
        if (entry.isOff || entry.isLeave || !entry.shift) { deletableIds.push(entry.id); continue; }
        const [sched] = await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.monthlyScheduleEntryId, entry.id)).limit(1);
        if (!sched) { deletableIds.push(entry.id); continue; }
        const [att] = await db.select({ id: attendance.id }).from(attendance).where(eq(attendance.scheduleId, sched.id)).limit(1);
        if (!att) deletableIds.push(entry.id);
      }

      if (deletableIds.length > 0) {
        const entrySchedules = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(inArray(schedules.monthlyScheduleEntryId, deletableIds));

        if (entrySchedules.length > 0) {
          const schedIds = entrySchedules.map(s => s.id);
          await Promise.all(schedIds.map(id => deleteTasksForSchedule(id)));
          await db.delete(schedules).where(inArray(schedules.id, schedIds));
        }
        await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, deletableIds));
      }

      await db.update(monthlySchedules).set({ note: data.note, updatedAt: new Date() }).where(eq(monthlySchedules.id, monthlyScheduleId));
    } else {
      const [ms] = await db
        .insert(monthlySchedules)
        .values({ storeId: data.storeId, yearMonth: data.yearMonth, importedBy: data.importedBy, note: data.note })
        .returning({ id: monthlySchedules.id });
      monthlyScheduleId = ms.id;
    }

    const BATCH = 100;
    for (let i = 0; i < data.entries.length; i += BATCH) {
      const batch = data.entries.slice(i, i + BATCH);
      await db
        .insert(monthlyScheduleEntries)
        .values(batch.map(e => ({
          monthlyScheduleId,
          userId:  e.userId,
          storeId: e.storeId,
          date:    startOfDay(e.date),
          shift:   e.shift ?? undefined,
          isOff:   e.isOff,
          isLeave: e.isLeave,
        })))
        .onConflictDoUpdate({
          target: [monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleEntries.userId, monthlyScheduleEntries.date],
          set: {
            shift:     sql`excluded.shift`,
            isOff:     sql`excluded.is_off`,
            isLeave:   sql`excluded.is_leave`,
            updatedAt: new Date(),
          },
        });
    }

    await materialiseSchedulesForMonth(data.storeId, data.yearMonth);

    return { success: true, scheduleId: monthlyScheduleId };
  } catch (err) {
    return { success: false, error: `createOrReplaceMonthlySchedule: ${err}` };
  }
}

export async function updateMonthlyScheduleEntry(
  entryId: number,
  patch:   { shift?: Shift | null; isOff?: boolean; isLeave?: boolean },
  actorId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [entry] = await db
      .select()
      .from(monthlyScheduleEntries)
      .where(eq(monthlyScheduleEntries.id, entryId))
      .limit(1);

    if (!entry) return { success: false, error: 'Entry not found.' };

    const auth = await canManageSchedule(actorId, entry.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [sched] = await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.monthlyScheduleEntryId, entryId)).limit(1);
    if (sched) {
      const [att] = await db.select({ id: attendance.id }).from(attendance).where(eq(attendance.scheduleId, sched.id)).limit(1);
      if (att) return { success: false, error: 'Cannot edit a day that already has an attendance record.' };
      await deleteTasksForSchedule(sched.id);
      await db.delete(schedules).where(eq(schedules.id, sched.id));
    }

    await db.update(monthlyScheduleEntries).set({ ...patch, updatedAt: new Date() }).where(eq(monthlyScheduleEntries.id, entryId));

    const updatedShift   = patch.shift   !== undefined ? patch.shift   : entry.shift;
    const updatedIsOff   = patch.isOff   !== undefined ? patch.isOff   : entry.isOff;
    const updatedIsLeave = patch.isLeave !== undefined ? patch.isLeave : entry.isLeave;

    if (!updatedIsOff && !updatedIsLeave && updatedShift) {
      const [ms] = await db
        .select({ storeId: monthlySchedules.storeId, yearMonth: monthlySchedules.yearMonth })
        .from(monthlySchedules)
        .where(eq(monthlySchedules.id, entry.monthlyScheduleId))
        .limit(1);
      if (ms) await materialiseSchedulesForMonth(ms.storeId, ms.yearMonth);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `updateMonthlyScheduleEntry: ${err}` };
  }
}

export async function deleteMonthlySchedule(
  storeId:   number,
  yearMonth: string,
  actorId:   string,
): Promise<{ success: boolean; lockedCount?: number; error?: string }> {
  try {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [ms] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
      .limit(1);
    if (!ms) return { success: false, error: 'Monthly schedule not found.' };

    const allEntries    = await db.select({ id: monthlyScheduleEntries.id }).from(monthlyScheduleEntries).where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));
    const entryIds      = allEntries.map(e => e.id);
    const entrySchedules = entryIds.length > 0
      ? await db.select({ id: schedules.id, entryId: schedules.monthlyScheduleEntryId }).from(schedules).where(inArray(schedules.monthlyScheduleEntryId, entryIds))
      : [];

    let lockedCount = 0;
    const deletableSchedIds: number[] = [];

    for (const s of entrySchedules) {
      const [att] = await db.select({ id: attendance.id }).from(attendance).where(eq(attendance.scheduleId, s.id)).limit(1);
      if (att) lockedCount++;
      else deletableSchedIds.push(s.id);
    }

    if (deletableSchedIds.length > 0) {
      await Promise.all(deletableSchedIds.map(id => deleteTasksForSchedule(id)));
      await db.delete(schedules).where(inArray(schedules.id, deletableSchedIds));
    }

    if (lockedCount === 0) {
      if (entryIds.length > 0) await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, entryIds));
      await db.delete(monthlySchedules).where(eq(monthlySchedules.id, ms.id));
    } else {
      const attendedSchedIds = new Set(entrySchedules.filter(s => !deletableSchedIds.includes(s.id)).map(s => s.id));
      const attendedEntryIds = new Set(entrySchedules.filter(s => attendedSchedIds.has(s.id)).map(s => s.entryId).filter(Boolean));
      const toDeleteEntries  = entryIds.filter(id => !attendedEntryIds.has(id));
      if (toDeleteEntries.length > 0) await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, toDeleteEntries));
    }

    return { success: true, lockedCount };
  } catch (err) {
    return { success: false, error: `deleteMonthlySchedule: ${err}` };
  }
}

export async function getMonthlySchedule(storeId: number, yearMonth: string): Promise<MonthlyScheduleWithEntries | null> {
  const [ms] = await db
    .select()
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
    .limit(1);
  if (!ms) return null;

  const rawEntries = await db
    .select({ entry: monthlyScheduleEntries, user: users })
    .from(monthlyScheduleEntries)
    .leftJoin(users, eq(monthlyScheduleEntries.userId, users.id))
    .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id))
    .orderBy(monthlyScheduleEntries.date, users.name);

  return {
    schedule: ms,
    entries:  rawEntries.map(r => ({
      ...r.entry,
      userName:         r.user?.name         ?? null,
      userEmployeeType: r.user?.employeeType ?? null,
    })),
  };
}

export async function listMonthlySchedules(storeId: number): Promise<MonthlySchedule[]> {
  return db
    .select()
    .from(monthlySchedules)
    .where(eq(monthlySchedules.storeId, storeId))
    .orderBy(sql`${monthlySchedules.yearMonth} DESC`);
}

// ─── Materialisation ──────────────────────────────────────────────────────────

export async function materialiseSchedulesForMonth(
  storeId:   number,
  yearMonth: string,
): Promise<{ schedulesCreated: number; tasksCreated: number; errors: string[] }> {
  let schedulesCreated = 0;
  let tasksCreated     = 0;
  const errors: string[] = [];

  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
    .limit(1);
  if (!ms) return { schedulesCreated, tasksCreated, errors: ['Monthly schedule not found'] };

  const entries = await db
    .select()
    .from(monthlyScheduleEntries)
    .where(
      and(
        eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
        eq(monthlyScheduleEntries.isOff,   false),
        eq(monthlyScheduleEntries.isLeave, false),
      ),
    );

  for (const entry of entries) {
    if (!entry.shift) continue;
    try {
      const result = await createScheduleRow(entry);
      if (result.created) {
        schedulesCreated++;
        const taskResult = await materialiseTasksForSchedule(result.scheduleId!);
        tasksCreated += taskResult.created.length;
        errors.push(...taskResult.errors);
      }
    } catch (err) {
      errors.push(`Entry ${entry.id}: ${err}`);
    }
  }

  return { schedulesCreated, tasksCreated, errors };
}

async function createScheduleRow(
  entry: MonthlyScheduleEntry,
): Promise<{ created: boolean; scheduleId?: number }> {
  const [existing] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.monthlyScheduleEntryId, entry.id))
    .limit(1);
  if (existing) return { created: false };

  const [newSched] = await db
    .insert(schedules)
    .values({
      userId:                 entry.userId,
      storeId:                entry.storeId,
      shift:                  entry.shift as Shift,
      date:                   startOfDay(entry.date),
      monthlyScheduleEntryId: entry.id,
      isHoliday:              false,
    })
    .returning({ id: schedules.id });

  // Backfill attendance link if a check-in already exists for this employee/shift/day
  const [existingAtt] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(
      and(
        eq(attendance.userId,  entry.userId),
        eq(attendance.storeId, entry.storeId),
        eq(attendance.shift,   entry.shift!),
        gte(attendance.date,   startOfDay(entry.date)),
        lte(attendance.date,   endOfDay(entry.date)),
      ),
    )
    .limit(1);

  if (existingAtt) {
    await db
      .update(attendance)
      .set({ scheduleId: newSched.id, updatedAt: new Date() })
      .where(eq(attendance.id, existingAtt.id));
  }

  return { created: true, scheduleId: newSched.id };
}
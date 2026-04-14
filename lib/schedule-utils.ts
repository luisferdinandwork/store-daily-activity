// lib/schedule-utils.ts
/**
 * Monthly schedule management + attendance utilities.
 */

import { db } from '@/lib/db';
import {
  areas, users, stores,
  monthlySchedules, monthlyScheduleEntries,
  schedules, attendance, breakSessions,
  userRoles, employeeTypes, shifts,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, itemDroppingTasks, briefingTasks,
  eodZReportTasks, edcReconciliationTasks,
  openStatementTasks, groomingTasks,
  type Area, type MonthlySchedule, type MonthlyScheduleEntry,
} from '@/lib/db/schema';
import { eq, and, gte, lte, inArray, isNull, sql } from 'drizzle-orm';

export type { BreakType } from '@/lib/db/schema';
import type { BreakType } from '@/lib/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SHIFT_CONFIG = {
  morning: {
    startHour:        8,
    endHour:          17,
    lateAfterMinutes: 30,
    breakTypes: ['lunch'] as BreakType[],
    maxBreaks:  1,
  },
  evening: {
    startHour:        13,
    endHour:          22,
    lateAfterMinutes: 30,
    breakTypes: ['dinner'] as BreakType[],
    maxBreaks:  1,
  },
  full_day: {
    startHour:        8,
    endHour:          22,
    lateAfterMinutes: 30,
    breakTypes: ['full_day_lunch', 'full_day_dinner'] as BreakType[],
    maxBreaks:  2,
  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Shift = 'morning' | 'evening' | 'full_day';

export interface DayAssignment {
  userId:  string;
  storeId: number;
  date:    Date;
  shift:   Shift | null;
  isOff:   boolean;
  isLeave: boolean;
}

export interface CreateMonthlyScheduleInput {
  storeId:    number;
  yearMonth:  string;
  entries:    DayAssignment[];
  note?:      string;
  importedBy: string;
}

export interface MonthlyScheduleWithEntries {
  schedule: MonthlySchedule;
  entries:  (MonthlyScheduleEntry & {
    userName:         string | null;
    userEmployeeType: string | null;
    shiftCode:        string | null;
  })[];
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

let shiftIdCache: Record<string, number> | null = null;
async function getShiftIdMap(): Promise<Record<string, number>> {
  if (shiftIdCache) return shiftIdCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  shiftIdCache = Object.fromEntries(rows.map(r => [r.code, r.id]));
  return shiftIdCache!;
}

/**
 * Delete all task rows referencing the given schedule IDs.
 * Uses Drizzle ORM queries (not raw SQL) so it works with all drivers
 * including Neon HTTP which doesn't return a plain array from db.execute().
 */
async function deleteAllTasksForSchedules(scheduleIds: number[]): Promise<void> {
  if (scheduleIds.length === 0) return;
  await Promise.all([
    db.delete(storeOpeningTasks) .where(inArray(storeOpeningTasks.scheduleId,  scheduleIds)),
    db.delete(setoranTasks)      .where(inArray(setoranTasks.scheduleId,       scheduleIds)),
    db.delete(cekBinTasks)       .where(inArray(cekBinTasks.scheduleId,        scheduleIds)),
    db.delete(productCheckTasks) .where(inArray(productCheckTasks.scheduleId,  scheduleIds)),
    db.delete(itemDroppingTasks) .where(inArray(itemDroppingTasks.scheduleId,  scheduleIds)),
    db.delete(briefingTasks)     .where(inArray(briefingTasks.scheduleId,      scheduleIds)),
    db.delete(edcReconciliationTasks) .where(inArray(edcReconciliationTasks.scheduleId, scheduleIds)),
    db.delete(eodZReportTasks)   .where(inArray(eodZReportTasks.scheduleId,    scheduleIds)),
    db.delete(openStatementTasks).where(inArray(openStatementTasks.scheduleId, scheduleIds)),
    db.delete(groomingTasks)     .where(inArray(groomingTasks.scheduleId,      scheduleIds as any)),
  ]);
}

// ─── Authorization ────────────────────────────────────────────────────────────

export async function getStoreArea(storeId: number): Promise<Area | null> {
  const [store] = await db.select({ areaId: stores.areaId }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store?.areaId) return null;
  const [area] = await db.select().from(areas).where(eq(areas.id, store.areaId)).limit(1);
  return area ?? null;
}

export async function getStoresForOps(opsUserId: string): Promise<number[]> {
  const [opsUser] = await db.select({ areaId: users.areaId }).from(users).where(eq(users.id, opsUserId)).limit(1);
  if (!opsUser?.areaId) return [];
  const areaStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.areaId, opsUser.areaId));
  return areaStores.map(s => s.id);
}

/**
 * Check whether `actorId` may manage schedules for `storeId`.
 *
 * Pass `targetEntryStoreId` when an operation targets an entry whose storeId
 * may differ from the schedule's owning store (cross-posted employee). Both
 * stores must be in the OPS user's area. PIC 1 cannot cross-post.
 */
export async function canManageSchedule(
  actorId:             string,
  storeId:             number,
  targetEntryStoreId?: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const [actor] = await db
    .select({ roleId: users.roleId, employeeTypeId: users.employeeTypeId, homeStoreId: users.homeStoreId, areaId: users.areaId })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  if (!actor) return { allowed: false, reason: 'Actor not found.' };

  if (actor.roleId) {
    const [role] = await db.select({ code: userRoles.code }).from(userRoles)
      .where(eq(userRoles.id, actor.roleId)).limit(1);

    if (role?.code === 'ops') {
      if (!actor.areaId) return { allowed: false, reason: 'OPS user has no area assigned.' };

      const [targetStore] = await db.select({ areaId: stores.areaId }).from(stores)
        .where(eq(stores.id, storeId)).limit(1);
      if (!targetStore)                        return { allowed: false, reason: 'Store not found.' };
      if (targetStore.areaId !== actor.areaId) return { allowed: false, reason: 'This store is not in your area.' };

      if (targetEntryStoreId && targetEntryStoreId !== storeId) {
        const [entryStore] = await db.select({ areaId: stores.areaId }).from(stores)
          .where(eq(stores.id, targetEntryStoreId)).limit(1);
        if (!entryStore)                        return { allowed: false, reason: 'Cross-post target store not found.' };
        if (entryStore.areaId !== actor.areaId) return { allowed: false, reason: 'Cross-post target store is not in your area.' };
      }

      return { allowed: true };
    }
  }

  if (actor.employeeTypeId) {
    const [empType] = await db.select({ code: employeeTypes.code }).from(employeeTypes)
      .where(eq(employeeTypes.id, actor.employeeTypeId)).limit(1);

    if (empType?.code === 'pic_1') {
      if (Number(actor.homeStoreId) !== Number(storeId))
        return { allowed: false, reason: 'PIC 1 can only manage schedules for their home store.' };
      if (targetEntryStoreId && targetEntryStoreId !== storeId)
        return { allowed: false, reason: 'PIC 1 can only assign employees to their home store.' };
      return { allowed: true };
    }
  }

  return { allowed: false, reason: 'Only OPS (for their area) or PIC 1 (for their store) can manage schedules.' };
}

// ─── Monthly Schedule CRUD ────────────────────────────────────────────────────

export async function createEmptyMonthlySchedule(
  storeId:   number,
  yearMonth: string,
  actorId:   string,
  note?:     string,
): Promise<{ success: boolean; scheduleId?: number; error?: string }> {
  try {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    if (!/^\d{4}-\d{2}$/.test(yearMonth))
      return { success: false, error: 'yearMonth must be in YYYY-MM format.' };

    const [existing] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth))).limit(1);
    if (existing) return { success: false, error: `A schedule for ${yearMonth} already exists.` };

    const [ms] = await db.insert(monthlySchedules)
      .values({ storeId, yearMonth, importedBy: actorId, note })
      .returning({ id: monthlySchedules.id });
    return { success: true, scheduleId: ms.id };
  } catch (err) {
    return { success: false, error: `createEmptyMonthlySchedule: ${err}` };
  }
}

export async function createOrReplaceMonthlySchedule(
  data: CreateMonthlyScheduleInput,
): Promise<{ success: boolean; scheduleId?: number; error?: string }> {
  try {
    const auth = await canManageSchedule(data.importedBy, data.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };
    if (!data.entries.length) return { success: false, error: 'No entries provided.' };

    const uniqueEntryStoreIds = [...new Set(data.entries.map(e => e.storeId).filter(id => id !== data.storeId))];
    for (const entryStoreId of uniqueEntryStoreIds) {
      const crossCheck = await canManageSchedule(data.importedBy, data.storeId, entryStoreId);
      if (!crossCheck.allowed) return { success: false, error: crossCheck.reason };
    }

    const [existing] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, data.storeId), eq(monthlySchedules.yearMonth, data.yearMonth))).limit(1);

    let monthlyScheduleId: number;

    if (existing) {
      monthlyScheduleId = existing.id;

      const entriesToCheck = await db.select({ id: monthlyScheduleEntries.id })
        .from(monthlyScheduleEntries)
        .where(eq(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleId));
      const entryIds = entriesToCheck.map(e => e.id);

      if (entryIds.length > 0) {
        const entrySchedules = await db
          .select({ id: schedules.id, entryId: schedules.monthlyScheduleEntryId })
          .from(schedules)
          .where(inArray(schedules.monthlyScheduleEntryId, entryIds));

        const lockedSchedIds = new Set<number>();
        if (entrySchedules.length > 0) {
          const schedIds = entrySchedules.map(s => s.id);
          const attended = await db.select({ scheduleId: attendance.scheduleId })
            .from(attendance).where(inArray(attendance.scheduleId, schedIds));
          for (const a of attended) lockedSchedIds.add(a.scheduleId);
        }

        const deletableSchedIds = entrySchedules.filter(s => !lockedSchedIds.has(s.id)).map(s => s.id);
        const lockedEntryIds    = new Set(entrySchedules.filter(s => lockedSchedIds.has(s.id)).map(s => s.entryId).filter((id): id is number => id != null));
        const deletableEntryIds = entryIds.filter(id => !lockedEntryIds.has(id));

        await deleteAllTasksForSchedules(deletableSchedIds);
        if (deletableSchedIds.length > 0)  await db.delete(schedules).where(inArray(schedules.id, deletableSchedIds));
        if (deletableEntryIds.length > 0)  await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, deletableEntryIds));
      }

      await db.update(monthlySchedules).set({ note: data.note, updatedAt: new Date() })
        .where(eq(monthlySchedules.id, monthlyScheduleId));
    } else {
      const [ms] = await db.insert(monthlySchedules)
        .values({ storeId: data.storeId, yearMonth: data.yearMonth, importedBy: data.importedBy, note: data.note })
        .returning({ id: monthlySchedules.id });
      monthlyScheduleId = ms.id;
    }

    const BATCH    = 100;
    const shiftMap = await getShiftIdMap();

    for (let i = 0; i < data.entries.length; i += BATCH) {
      const batch = data.entries.slice(i, i + BATCH);
      await db.insert(monthlyScheduleEntries)
        .values(batch.map(e => ({
          monthlyScheduleId,
          userId:  e.userId,
          storeId: e.storeId,
          date:    startOfDay(e.date),
          shiftId: e.shift ? shiftMap[e.shift] : null,
          isOff:   e.isOff,
          isLeave: e.isLeave,
        })))
        .onConflictDoUpdate({
          target: [monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleEntries.userId, monthlyScheduleEntries.date],
          set: { shiftId: sql`excluded.shift_id`, isOff: sql`excluded.is_off`, isLeave: sql`excluded.is_leave`, updatedAt: new Date() },
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
    const [entry] = await db.select().from(monthlyScheduleEntries)
      .where(eq(monthlyScheduleEntries.id, entryId)).limit(1);
    if (!entry) return { success: false, error: 'Entry not found.' };

    const [ms] = await db.select({ storeId: monthlySchedules.storeId }).from(monthlySchedules)
      .where(eq(monthlySchedules.id, entry.monthlyScheduleId)).limit(1);
    if (!ms) return { success: false, error: 'Monthly schedule not found.' };

    const auth = await canManageSchedule(actorId, ms.storeId, entry.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [sched] = await db.select({ id: schedules.id }).from(schedules)
      .where(eq(schedules.monthlyScheduleEntryId, entryId)).limit(1);

    if (sched) {
      const [att] = await db.select({ id: attendance.id }).from(attendance)
        .where(eq(attendance.scheduleId, sched.id)).limit(1);
      if (att) return { success: false, error: 'Cannot edit a day that already has an attendance record.' };

      await deleteAllTasksForSchedules([sched.id]);
      await db.delete(schedules).where(eq(schedules.id, sched.id));
    }

    const finalShift:   Shift | null = patch.shift   !== undefined ? patch.shift   : null;
    const finalIsOff:   boolean      = patch.isOff   !== undefined ? patch.isOff   : entry.isOff;
    const finalIsLeave: boolean      = patch.isLeave !== undefined ? patch.isLeave : entry.isLeave;
    const normalisedShift            = (finalIsOff || finalIsLeave) ? null : finalShift;
    const shiftMap                   = await getShiftIdMap();

    await db.update(monthlyScheduleEntries).set({
      shiftId:   normalisedShift ? shiftMap[normalisedShift] ?? null : null,
      isOff:     finalIsOff,
      isLeave:   finalIsLeave,
      updatedAt: new Date(),
    }).where(eq(monthlyScheduleEntries.id, entryId));

    if (!finalIsOff && !finalIsLeave && normalisedShift) {
      const shiftIdToUse = shiftMap[normalisedShift];
      if (!shiftIdToUse) return { success: false, error: `Shift lookup failed for ${normalisedShift}.` };

      const [newSched] = await db.insert(schedules).values({
        userId:                 entry.userId,
        storeId:                entry.storeId,
        shiftId:                shiftIdToUse,
        date:                   startOfDay(entry.date),
        monthlyScheduleEntryId: entryId,
        isHoliday:              false,
      }).returning({ id: schedules.id });

      const [existingAtt] = await db.select({ id: attendance.id }).from(attendance).where(and(
        eq(attendance.userId,  entry.userId),
        eq(attendance.storeId, entry.storeId),
        eq(attendance.shiftId, shiftIdToUse),
        gte(attendance.date,   startOfDay(entry.date)),
        lte(attendance.date,   endOfDay(entry.date)),
      )).limit(1);

      if (existingAtt) {
        await db.update(attendance).set({ scheduleId: newSched.id, updatedAt: new Date() })
          .where(eq(attendance.id, existingAtt.id));
      }
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

    const [ms] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth))).limit(1);
    if (!ms) return { success: false, error: 'Monthly schedule not found.' };

    const allEntries = await db.select({ id: monthlyScheduleEntries.id })
      .from(monthlyScheduleEntries)
      .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));
    const entryIds = allEntries.map(e => e.id);

    const entrySchedules = entryIds.length > 0
      ? await db.select({ id: schedules.id, entryId: schedules.monthlyScheduleEntryId })
          .from(schedules).where(inArray(schedules.monthlyScheduleEntryId, entryIds))
      : [];

    const lockedSchedIds = new Set<number>();
    if (entrySchedules.length > 0) {
      const schedIds = entrySchedules.map(s => s.id);
      const attended = await db.select({ scheduleId: attendance.scheduleId })
        .from(attendance).where(inArray(attendance.scheduleId, schedIds));
      for (const a of attended) lockedSchedIds.add(a.scheduleId);
    }

    const deletableSchedIds = entrySchedules.filter(s => !lockedSchedIds.has(s.id)).map(s => s.id);
    const lockedCount       = lockedSchedIds.size;
    const lockedEntryIds    = new Set(entrySchedules.filter(s => lockedSchedIds.has(s.id)).map(s => s.entryId).filter((id): id is number => id != null));

    await deleteAllTasksForSchedules(deletableSchedIds);
    if (deletableSchedIds.length > 0)
      await db.delete(schedules).where(inArray(schedules.id, deletableSchedIds));

    if (lockedCount === 0) {
      if (entryIds.length > 0)
        await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, entryIds));
      await db.delete(monthlySchedules).where(eq(monthlySchedules.id, ms.id));
    } else {
      const deletableEntryIds = entryIds.filter(id => !lockedEntryIds.has(id));
      if (deletableEntryIds.length > 0)
        await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, deletableEntryIds));
    }

    return { success: true, lockedCount };
  } catch (err) {
    return { success: false, error: `deleteMonthlySchedule: ${err}` };
  }
}

export async function createMonthlyScheduleEntry(
  storeId:   number,
  yearMonth: string,
  userId:    string,
  date:      Date,
  state:     { shift: Shift | null; isOff: boolean; isLeave: boolean; entryStoreId?: number },
  actorId:   string,
): Promise<{ success: boolean; entryId?: number; error?: string }> {
  try {
    const entryStoreId = state.entryStoreId ?? storeId;
    const auth = await canManageSchedule(actorId, storeId, entryStoreId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [ms] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth))).limit(1);
    if (!ms) return { success: false, error: `No monthly schedule for ${yearMonth}. Create one first.` };

    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return { success: false, error: 'User not found.' };

    const dateStart = startOfDay(date);

    const [existingEntry] = await db.select({ id: monthlyScheduleEntries.id })
      .from(monthlyScheduleEntries)
      .where(and(
        eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
        eq(monthlyScheduleEntries.userId, userId),
        eq(monthlyScheduleEntries.date, dateStart),
      )).limit(1);
    if (existingEntry) return { success: false, error: 'This employee already has a schedule for this day. Edit it instead.' };

    const normalisedShift = (state.isOff || state.isLeave) ? null : state.shift;
    const shiftMap        = await getShiftIdMap();

    const [newEntry] = await db.insert(monthlyScheduleEntries).values({
      monthlyScheduleId: ms.id,
      userId,
      storeId:  entryStoreId,
      date:     dateStart,
      shiftId:  normalisedShift ? shiftMap[normalisedShift] ?? null : null,
      isOff:    state.isOff,
      isLeave:  state.isLeave,
    }).returning({ id: monthlyScheduleEntries.id });

    if (!state.isOff && !state.isLeave && normalisedShift) {
      const shiftIdToUse = shiftMap[normalisedShift];
      if (shiftIdToUse) {
        await db.insert(schedules).values({
          userId,
          storeId:                entryStoreId,
          shiftId:                shiftIdToUse,
          date:                   dateStart,
          monthlyScheduleEntryId: newEntry.id,
          isHoliday:              false,
        });
      }
    }

    return { success: true, entryId: newEntry.id };
  } catch (err) {
    return { success: false, error: `createMonthlyScheduleEntry: ${err}` };
  }
}

export async function getMonthlySchedule(storeId: number, yearMonth: string): Promise<MonthlyScheduleWithEntries | null> {
  const [ms] = await db.select().from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth))).limit(1);
  if (!ms) return null;

  const rawEntries = await db
    .select({ entry: monthlyScheduleEntries, user: users, empType: employeeTypes, shiftRow: shifts })
    .from(monthlyScheduleEntries)
    .leftJoin(users,         eq(monthlyScheduleEntries.userId,  users.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId,           employeeTypes.id))
    .leftJoin(shifts,        eq(monthlyScheduleEntries.shiftId, shifts.id))
    .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id))
    .orderBy(monthlyScheduleEntries.date, users.name);

  return {
    schedule: ms,
    entries:  rawEntries.map(r => ({
      ...r.entry,
      userName:         r.user?.name     ?? null,
      userEmployeeType: r.empType?.label ?? null,
      shiftCode:        r.shiftRow?.code ?? null,
    })),
  };
}

export async function listMonthlySchedules(storeId: number): Promise<MonthlySchedule[]> {
  return db.select().from(monthlySchedules)
    .where(eq(monthlySchedules.storeId, storeId))
    .orderBy(sql`${monthlySchedules.yearMonth} DESC`);
}

// ─── Materialisation ──────────────────────────────────────────────────────────

export async function materialiseSchedulesForMonth(
  storeId:   number,
  yearMonth: string,
): Promise<{ schedulesCreated: number; errors: string[] }> {
  let schedulesCreated = 0;
  const errors: string[] = [];

  const [ms] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth))).limit(1);
  if (!ms) return { schedulesCreated, errors: ['Monthly schedule not found'] };

  const entries = await db.select().from(monthlyScheduleEntries).where(and(
    eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
    eq(monthlyScheduleEntries.isOff,   false),
    eq(monthlyScheduleEntries.isLeave, false),
  ));

  const shiftMap = await getShiftIdMap();
  const idToCode: Record<number, Shift> = {};
  for (const [code, id] of Object.entries(shiftMap)) idToCode[id] = code as Shift;

  for (const entry of entries) {
    if (!entry.shiftId) continue;

    const typedShift = idToCode[entry.shiftId];
    if (!typedShift) { errors.push(`Entry ${entry.id}: Shift ID ${entry.shiftId} not found.`); continue; }

    try {
      const [existing] = await db.select({ id: schedules.id }).from(schedules)
        .where(eq(schedules.monthlyScheduleEntryId, entry.id)).limit(1);
      if (existing) continue;

      const [newSched] = await db.insert(schedules).values({
        userId:                 entry.userId,
        storeId:                entry.storeId,
        shiftId:                entry.shiftId,
        date:                   startOfDay(entry.date),
        monthlyScheduleEntryId: entry.id,
        isHoliday:              false,
      }).returning({ id: schedules.id });

      schedulesCreated++;

      const [existingAtt] = await db.select({ id: attendance.id }).from(attendance).where(and(
        eq(attendance.userId,  entry.userId),
        eq(attendance.storeId, entry.storeId),
        eq(attendance.shiftId, entry.shiftId),
        gte(attendance.date,   startOfDay(entry.date)),
        lte(attendance.date,   endOfDay(entry.date)),
      )).limit(1);

      if (existingAtt) {
        await db.update(attendance).set({ scheduleId: newSched.id, updatedAt: new Date() })
          .where(eq(attendance.id, existingAtt.id));
      }
    } catch (err) {
      errors.push(`Entry ${entry.id}: ${err}`);
    }
  }

  return { schedulesCreated, errors };
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function employeeCheckIn(
  userId:  string,
  storeId: number,
  shift:   Shift,
): Promise<{ success: boolean; action?: 'checked_in' | 'returned_from_break'; attendanceId?: number; scheduleId?: number; status?: string; error?: string }> {
  try {
    const now      = new Date();
    const dayStart = startOfDay(now);
    const dayEnd   = endOfDay(now);

    const shiftMap     = await getShiftIdMap();
    const shiftIdToUse = shiftMap[shift];
    if (!shiftIdToUse) return { success: false, error: `Invalid shift: ${shift}` };

    const [sched] = await db.select().from(schedules).where(and(
      eq(schedules.userId,    userId),
      eq(schedules.storeId,   storeId),
      eq(schedules.shiftId,   shiftIdToUse),
      eq(schedules.isHoliday, false),
      gte(schedules.date,     dayStart),
      lte(schedules.date,     dayEnd),
    )).limit(1);

    if (!sched) return { success: false, error: 'You are not scheduled for this shift today.' };

    const [existing] = await db.select().from(attendance)
      .where(eq(attendance.scheduleId, sched.id)).limit(1);

    if (!existing) {
      const cfg           = SHIFT_CONFIG[shift];
      const shiftStart    = new Date(now); shiftStart.setHours(cfg.startHour, 0, 0, 0);
      const lateThreshold = new Date(shiftStart); lateThreshold.setMinutes(cfg.lateAfterMinutes);
      const attStatus     = now > lateThreshold ? 'late' : 'present';

      const [att] = await db.insert(attendance).values({
        scheduleId: sched.id, userId, storeId, date: sched.date,
        shiftId: shiftIdToUse, status: attStatus, checkInTime: now, onBreak: false, recordedBy: userId,
      }).returning({ id: attendance.id });

      return { success: true, action: 'checked_in', attendanceId: att.id, scheduleId: sched.id, status: attStatus };
    }

    if (existing.onBreak) return endBreak(userId, storeId, existing.id);

    return { success: true, action: 'checked_in', attendanceId: existing.id, scheduleId: sched.id, status: existing.status };
  } catch (err) { return { success: false, error: `Check-in failed: ${err}` }; }
}

export async function employeeCheckOut(userId: string, storeId: number, shift: Shift): Promise<{ success: boolean; error?: string }> {
  try {
    const now = new Date();

    const shiftMap     = await getShiftIdMap();
    const shiftIdToUse = shiftMap[shift];
    if (!shiftIdToUse) return { success: false, error: 'Invalid shift.' };

    const [sched] = await db.select({ id: schedules.id }).from(schedules).where(and(
      eq(schedules.userId,    userId),
      eq(schedules.storeId,   storeId),
      eq(schedules.shiftId,   shiftIdToUse),
      eq(schedules.isHoliday, false),
      gte(schedules.date,     startOfDay(now)),
      lte(schedules.date,     endOfDay(now)),
    )).limit(1);
    if (!sched) return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db.select().from(attendance)
      .where(eq(attendance.scheduleId, sched.id)).limit(1);
    if (!att)             return { success: false, error: 'No check-in record found.' };
    if (att.checkOutTime) return { success: false, error: 'Already checked out.' };
    if (att.onBreak)      return { success: false, error: 'Currently on break. Please return first.' };

    await db.update(attendance).set({ checkOutTime: now, updatedAt: new Date() })
      .where(eq(attendance.id, att.id));
    return { success: true };
  } catch (err) { return { success: false, error: `Check-out failed: ${err}` }; }
}

export async function startBreak(
  userId:    string,
  storeId:   number,
  shift:     Shift,
  breakType: BreakType,
): Promise<{ success: boolean; breakSessionId?: number; breakType?: BreakType; error?: string }> {
  try {
    const now = new Date();
    const cfg = SHIFT_CONFIG[shift];

    if (!(cfg.breakTypes as readonly string[]).includes(breakType))
      return { success: false, error: `Break type "${breakType}" is not valid for a ${shift} shift. Valid: ${cfg.breakTypes.join(', ')}.` };

    const shiftMap     = await getShiftIdMap();
    const shiftIdToUse = shiftMap[shift];
    if (!shiftIdToUse) return { success: false, error: 'Invalid shift.' };

    const [sched] = await db.select({ id: schedules.id }).from(schedules).where(and(
      eq(schedules.userId,    userId),
      eq(schedules.storeId,   storeId),
      eq(schedules.shiftId,   shiftIdToUse),
      eq(schedules.isHoliday, false),
      gte(schedules.date,     startOfDay(now)),
      lte(schedules.date,     endOfDay(now)),
    )).limit(1);
    if (!sched) return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db.select().from(attendance)
      .where(eq(attendance.scheduleId, sched.id)).limit(1);
    if (!att || !att.checkInTime) return { success: false, error: 'Not checked in yet.' };
    if (att.checkOutTime)         return { success: false, error: 'Already checked out.' };
    if (att.onBreak)              return { success: false, error: 'Already on break.' };

    const priorBreaks = await db.select().from(breakSessions)
      .where(eq(breakSessions.attendanceId, att.id));

    if (priorBreaks.length >= cfg.maxBreaks)
      return { success: false, error: `Already used all ${cfg.maxBreaks} break(s) for this ${shift} shift.` };
    if (priorBreaks.some(b => b.breakType === breakType))
      return { success: false, error: `Already used the "${breakType}" break for this shift.` };

    const [session] = await db.insert(breakSessions)
      .values({ attendanceId: att.id, userId, storeId, breakType, breakOutTime: now })
      .returning({ id: breakSessions.id });

    await db.update(attendance).set({ onBreak: true, updatedAt: new Date() })
      .where(eq(attendance.id, att.id));

    return { success: true, breakSessionId: session.id, breakType };
  } catch (err) { return { success: false, error: `startBreak failed: ${err}` }; }
}

export async function endBreak(
  userId:       string,
  storeId:      number,
  attendanceId: number,
): Promise<{ success: boolean; action?: 'returned_from_break'; attendanceId?: number; scheduleId?: number; status?: string; error?: string }> {
  try {
    const now = new Date();

    const [openBreak] = await db.select().from(breakSessions).where(and(
      eq(breakSessions.attendanceId, attendanceId),
      eq(breakSessions.userId,       userId),
      isNull(breakSessions.returnTime),
    )).limit(1);
    if (!openBreak) return { success: false, error: 'No active break session found.' };

    await db.update(breakSessions).set({ returnTime: now, updatedAt: new Date() })
      .where(eq(breakSessions.id, openBreak.id));

    const [updatedAtt] = await db.update(attendance)
      .set({ onBreak: false, updatedAt: new Date() })
      .where(eq(attendance.id, attendanceId))
      .returning({ id: attendance.id, scheduleId: attendance.scheduleId, status: attendance.status });

    return { success: true, action: 'returned_from_break', attendanceId: updatedAtt.id, scheduleId: updatedAtt.scheduleId, status: updatedAtt.status };
  } catch (err) { return { success: false, error: `endBreak failed: ${err}` }; }
}

export async function getTodayAttendance(userId: string, storeId: number) {
  const now  = new Date();
  const rows = await db.select({ att: attendance, schedule: schedules })
    .from(attendance)
    .leftJoin(schedules, eq(attendance.scheduleId, schedules.id))
    .where(and(
      eq(attendance.userId,  userId),
      eq(attendance.storeId, storeId),
      gte(attendance.date,   startOfDay(now)),
      lte(attendance.date,   endOfDay(now)),
    ))
    .limit(1);

  if (!rows[0]) return null;

  const breaks = await db.select().from(breakSessions)
    .where(eq(breakSessions.attendanceId, rows[0].att.id))
    .orderBy(breakSessions.breakOutTime);

  return { ...rows[0], breaks };
}

export async function getAttendanceForDate(storeId: number, date: Date) {
  return db.select({ schedule: schedules, user: users, attendance })
    .from(schedules)
    .leftJoin(users,      eq(schedules.userId,      users.id))
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(and(
      eq(schedules.storeId,   storeId),
      eq(schedules.isHoliday, false),
      gte(schedules.date,     startOfDay(date)),
      lte(schedules.date,     endOfDay(date)),
    ))
    .orderBy(schedules.shiftId, users.name);
}

export async function opsMarkAttendance(
  scheduleId: number,
  status:     'present' | 'absent' | 'late' | 'excused',
  actorId:    string,
  notes?:     string,
): Promise<{ success: boolean; attendanceId?: number; error?: string }> {
  try {
    const [sched] = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
    if (!sched) return { success: false, error: 'Schedule not found.' };

    const auth = await canManageSchedule(actorId, sched.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [existing] = await db.select().from(attendance)
      .where(eq(attendance.scheduleId, scheduleId)).limit(1);
    let attendanceId: number;

    if (existing) {
      await db.update(attendance).set({ status, notes, recordedBy: actorId, updatedAt: new Date() })
        .where(eq(attendance.id, existing.id));
      attendanceId = existing.id;
    } else {
      const [att] = await db.insert(attendance).values({
        scheduleId, userId: sched.userId, storeId: sched.storeId, date: sched.date,
        shiftId: sched.shiftId, status, onBreak: false, notes, recordedBy: actorId,
      }).returning({ id: attendance.id });
      attendanceId = att.id;
    }

    return { success: true, attendanceId };
  } catch (err) { return { success: false, error: `opsMarkAttendance: ${err}` }; }
}
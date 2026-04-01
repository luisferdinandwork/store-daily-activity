// lib/schedule-utils.ts
/**
 * Monthly schedule management + attendance utilities.
 *
 * All store/schedule/entry PKs are serial integers (number) in the schema.
 * Session values arriving as strings must be coerced with Number() at the
 * API boundary before being passed into these functions.
 */

import { db } from '@/lib/db';
import {
  areas, users, stores,
  monthlySchedules, monthlyScheduleEntries,
  schedules, attendance, breakSessions,
  type Area, type MonthlySchedule, type MonthlyScheduleEntry,
} from '@/lib/db/schema';
import { eq, and, gte, lte, inArray, isNull, sql } from 'drizzle-orm';

// ─── Re-export BreakType from schema so callers can import it from here ───────
export type { BreakType } from '@/lib/db/schema';
import type { BreakType } from '@/lib/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SHIFT_CONFIG = {
  morning: { startHour: 8,  endHour: 17, lateAfterMinutes: 30, breakType: 'lunch'  as BreakType },
  evening: { startHour: 13, endHour: 22, lateAfterMinutes: 30, breakType: 'dinner' as BreakType },
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

export async function getStoreArea(storeId: number): Promise<Area | null> {
  const [store] = await db
    .select({ areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store?.areaId) return null;
  const [area] = await db.select().from(areas).where(eq(areas.id, store.areaId)).limit(1);
  return area ?? null;
}

export async function getStoresForOps(opsUserId: string): Promise<number[]> {
  const [opsUser] = await db
    .select({ areaId: users.areaId })
    .from(users)
    .where(eq(users.id, opsUserId))
    .limit(1);
  if (!opsUser?.areaId) return [];
  const areaStores = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.areaId, opsUser.areaId));
  return areaStores.map(s => s.id);
}

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
        if (entry.isOff || entry.isLeave || !entry.shift) {
          deletableIds.push(entry.id);
          continue;
        }
        const [sched] = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(eq(schedules.monthlyScheduleEntryId, entry.id))
          .limit(1);
        if (!sched) { deletableIds.push(entry.id); continue; }
        const [att] = await db
          .select({ id: attendance.id })
          .from(attendance)
          .where(eq(attendance.scheduleId, sched.id))
          .limit(1);
        if (!att) deletableIds.push(entry.id);
      }

      if (deletableIds.length > 0) {
        const entrySchedules = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(inArray(schedules.monthlyScheduleEntryId, deletableIds));

        if (entrySchedules.length > 0) {
          const schedIds = entrySchedules.map(s => s.id);
          await db.delete(schedules).where(inArray(schedules.id, schedIds));
        }
        await db
          .delete(monthlyScheduleEntries)
          .where(inArray(monthlyScheduleEntries.id, deletableIds));
      }

      await db
        .update(monthlySchedules)
        .set({ note: data.note, updatedAt: new Date() })
        .where(eq(monthlySchedules.id, monthlyScheduleId));
    } else {
      const [ms] = await db
        .insert(monthlySchedules)
        .values({
          storeId:    data.storeId,
          yearMonth:  data.yearMonth,
          importedBy: data.importedBy,
          note:       data.note,
        })
        .returning({ id: monthlySchedules.id });
      monthlyScheduleId = ms.id;
    }

    const BATCH = 100;
    for (let i = 0; i < data.entries.length; i += BATCH) {
      const batch = data.entries.slice(i, i + BATCH);
      await db
        .insert(monthlyScheduleEntries)
        .values(
          batch.map(e => ({
            monthlyScheduleId,
            userId:  e.userId,
            storeId: e.storeId,
            date:    startOfDay(e.date),
            shift:   e.shift ?? undefined,
            isOff:   e.isOff,
            isLeave: e.isLeave,
          })),
        )
        .onConflictDoUpdate({
          target: [
            monthlyScheduleEntries.monthlyScheduleId,
            monthlyScheduleEntries.userId,
            monthlyScheduleEntries.date,
          ],
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
    console.error('[createOrReplaceMonthlySchedule]', err);
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

    const [sched] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(eq(schedules.monthlyScheduleEntryId, entryId))
      .limit(1);

    if (sched) {
      const [att] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(eq(attendance.scheduleId, sched.id))
        .limit(1);
      if (att) return { success: false, error: 'Cannot edit a day that already has an attendance record.' };
      await db.delete(schedules).where(eq(schedules.id, sched.id));
    }

    await db
      .update(monthlyScheduleEntries)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(monthlyScheduleEntries.id, entryId));

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

    const allEntries = await db
      .select({ id: monthlyScheduleEntries.id })
      .from(monthlyScheduleEntries)
      .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));

    const entryIds = allEntries.map(e => e.id);
    const entrySchedules = entryIds.length > 0
      ? await db
          .select({ id: schedules.id, entryId: schedules.monthlyScheduleEntryId })
          .from(schedules)
          .where(inArray(schedules.monthlyScheduleEntryId, entryIds))
      : [];

    let lockedCount = 0;
    const deletableSchedIds: number[] = [];

    for (const s of entrySchedules) {
      const [att] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(eq(attendance.scheduleId, s.id))
        .limit(1);
      if (att) lockedCount++;
      else deletableSchedIds.push(s.id);
    }

    if (deletableSchedIds.length > 0) {
      await db.delete(schedules).where(inArray(schedules.id, deletableSchedIds));
    }

    if (lockedCount === 0) {
      if (entryIds.length > 0)
        await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, entryIds));
      await db.delete(monthlySchedules).where(eq(monthlySchedules.id, ms.id));
    } else {
      const attendedSchedIds = new Set(
        entrySchedules.filter(s => !deletableSchedIds.includes(s.id)).map(s => s.id),
      );
      const attendedEntryIds = new Set(
        entrySchedules
          .filter(s => attendedSchedIds.has(s.id))
          .map(s => s.entryId)
          .filter((id): id is number => id != null),
      );
      const toDeleteEntries = entryIds.filter(id => !attendedEntryIds.has(id));
      if (toDeleteEntries.length > 0)
        await db.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, toDeleteEntries));
    }

    return { success: true, lockedCount };
  } catch (err) {
    return { success: false, error: `deleteMonthlySchedule: ${err}` };
  }
}

export async function getMonthlySchedule(
  storeId:   number,
  yearMonth: string,
): Promise<MonthlyScheduleWithEntries | null> {
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
): Promise<{ schedulesCreated: number; errors: string[] }> {
  let schedulesCreated = 0;
  const errors: string[] = [];

  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
    .limit(1);
  if (!ms) return { schedulesCreated, errors: ['Monthly schedule not found'] };

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
      const created = await createScheduleRow(entry);
      if (created) schedulesCreated++;
    } catch (err) {
      errors.push(`Entry ${entry.id}: ${err}`);
    }
  }

  return { schedulesCreated, errors };
}

async function createScheduleRow(entry: MonthlyScheduleEntry): Promise<boolean> {
  const [existing] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.monthlyScheduleEntryId, entry.id))
    .limit(1);
  if (existing) return false;

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

  return true;
}

// ─── Check-in / Check-out ─────────────────────────────────────────────────────

export async function employeeCheckIn(
  userId:  string,
  storeId: number,
  shift:   Shift,
): Promise<{
  success:       boolean;
  action?:       'checked_in' | 'returned_from_break';
  attendanceId?: number;
  scheduleId?:   number;
  status?:       string;
  error?:        string;
}> {
  try {
    const now      = new Date();
    const dayStart = startOfDay(now);
    const dayEnd   = endOfDay(now);

    const [sched] = await db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.userId,    userId),
          eq(schedules.storeId,   storeId),
          eq(schedules.shift,     shift),
          eq(schedules.isHoliday, false),
          gte(schedules.date,     dayStart),
          lte(schedules.date,     dayEnd),
        ),
      )
      .limit(1);

    if (!sched)
      return {
        success: false,
        error:   'You are not scheduled for this shift today. Please contact your PIC 1 or OPS manager.',
      };

    const [existing] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (!existing) {
      const cfg           = SHIFT_CONFIG[shift];
      const shiftStart    = new Date(now); shiftStart.setHours(cfg.startHour, 0, 0, 0);
      const lateThreshold = new Date(shiftStart); lateThreshold.setMinutes(cfg.lateAfterMinutes);
      const attStatus     = now > lateThreshold ? 'late' : 'present';

      const [att] = await db
        .insert(attendance)
        .values({
          scheduleId:  sched.id,
          userId,
          storeId,
          date:        sched.date,
          shift:       sched.shift,
          status:      attStatus,
          checkInTime: now,
          onBreak:     false,
          recordedBy:  userId,
        })
        .returning({ id: attendance.id });

      return {
        success:      true,
        action:       'checked_in',
        attendanceId: att.id,
        scheduleId:   sched.id,
        status:       attStatus,
      };
    }

    // Already checked in — if on break, end it; otherwise return current state
    if (existing.onBreak) {
      return endBreak(userId, storeId, existing.id);
    }

    return {
      success:      true,
      action:       'checked_in',
      attendanceId: existing.id,
      scheduleId:   sched.id,
      status:       existing.status,
    };
  } catch (err) {
    return { success: false, error: `Check-in failed: ${err}` };
  }
}

export async function employeeCheckOut(
  userId:  string,
  storeId: number,
  shift:   Shift,
): Promise<{ success: boolean; error?: string }> {
  try {
    const now = new Date();

    const [sched] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.userId,    userId),
          eq(schedules.storeId,   storeId),
          eq(schedules.shift,     shift),
          eq(schedules.isHoliday, false),
          gte(schedules.date,     startOfDay(now)),
          lte(schedules.date,     endOfDay(now)),
        ),
      )
      .limit(1);

    if (!sched) return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (!att)             return { success: false, error: 'No check-in record found.' };
    if (att.checkOutTime) return { success: false, error: 'Already checked out.' };
    if (att.onBreak)      return { success: false, error: 'Currently on break. Please return first.' };

    await db
      .update(attendance)
      .set({ checkOutTime: now, updatedAt: new Date() })
      .where(eq(attendance.id, att.id));

    return { success: true };
  } catch (err) {
    return { success: false, error: `Check-out failed: ${err}` };
  }
}

// ─── Break management ─────────────────────────────────────────────────────────

export async function startBreak(
  userId:  string,
  storeId: number,
  shift:   Shift,
): Promise<{ success: boolean; breakSessionId?: number; breakType?: BreakType; error?: string }> {
  try {
    const now = new Date();

    const [sched] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.userId,    userId),
          eq(schedules.storeId,   storeId),
          eq(schedules.shift,     shift),
          eq(schedules.isHoliday, false),
          gte(schedules.date,     startOfDay(now)),
          lte(schedules.date,     endOfDay(now)),
        ),
      )
      .limit(1);

    if (!sched) return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (!att)             return { success: false, error: 'Not checked in.' };
    if (!att.checkInTime) return { success: false, error: 'Not checked in yet.' };
    if (att.checkOutTime) return { success: false, error: 'Already checked out.' };
    if (att.onBreak)      return { success: false, error: 'Already on break.' };

    const breakType   = SHIFT_CONFIG[shift].breakType;
    const priorBreaks = await db
      .select({ id: breakSessions.id })
      .from(breakSessions)
      .where(eq(breakSessions.attendanceId, att.id));

    if (priorBreaks.length > 0)
      return { success: false, error: `Already used ${breakType} break for this shift.` };

    const [session] = await db
      .insert(breakSessions)
      .values({ attendanceId: att.id, userId, storeId, breakType, breakOutTime: now })
      .returning({ id: breakSessions.id });

    await db
      .update(attendance)
      .set({ onBreak: true, updatedAt: new Date() })
      .where(eq(attendance.id, att.id));

    return { success: true, breakSessionId: session.id, breakType };
  } catch (err) {
    return { success: false, error: `startBreak failed: ${err}` };
  }
}

export async function endBreak(
  userId:       string,
  storeId:      number,
  attendanceId: number,
): Promise<{
  success:       boolean;
  action?:       'returned_from_break';
  attendanceId?: number;
  scheduleId?:   number;
  status?:       string;
  error?:        string;
}> {
  try {
    const now = new Date();

    const [openBreak] = await db
      .select()
      .from(breakSessions)
      .where(
        and(
          eq(breakSessions.attendanceId, attendanceId),
          eq(breakSessions.userId,       userId),
          isNull(breakSessions.returnTime),
        ),
      )
      .limit(1);

    if (!openBreak) return { success: false, error: 'No active break session found.' };

    await db
      .update(breakSessions)
      .set({ returnTime: now, updatedAt: new Date() })
      .where(eq(breakSessions.id, openBreak.id));

    const [updatedAtt] = await db
      .update(attendance)
      .set({ onBreak: false, updatedAt: new Date() })
      .where(eq(attendance.id, attendanceId))
      .returning({
        id:         attendance.id,
        scheduleId: attendance.scheduleId,
        status:     attendance.status,
      });

    return {
      success:      true,
      action:       'returned_from_break',
      attendanceId: updatedAtt.id,
      scheduleId:   updatedAtt.scheduleId,
      status:       updatedAtt.status,
    };
  } catch (err) {
    return { success: false, error: `endBreak failed: ${err}` };
  }
}

// ─── Attendance helpers ───────────────────────────────────────────────────────

export async function getTodayAttendance(userId: string, storeId: number) {
  const now  = new Date();
  const rows = await db
    .select({ att: attendance, schedule: schedules })
    .from(attendance)
    .leftJoin(schedules, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(attendance.userId,  userId),
        eq(attendance.storeId, storeId),
        gte(attendance.date,   startOfDay(now)),
        lte(attendance.date,   endOfDay(now)),
      ),
    )
    .limit(1);

  if (!rows[0]) return null;

  const breaks = await db
    .select()
    .from(breakSessions)
    .where(eq(breakSessions.attendanceId, rows[0].att.id))
    .orderBy(breakSessions.breakOutTime);

  return { ...rows[0], breaks };
}

export async function getAttendanceForDate(storeId: number, date: Date) {
  return db
    .select({ schedule: schedules, user: users, attendance: attendance })
    .from(schedules)
    .leftJoin(users, eq(schedules.userId, users.id))
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(schedules.storeId,   storeId),
        eq(schedules.isHoliday, false),
        gte(schedules.date,     startOfDay(date)),
        lte(schedules.date,     endOfDay(date)),
      ),
    )
    .orderBy(schedules.shift, users.name);
}

export async function opsMarkAttendance(
  scheduleId: number,
  status:     'present' | 'absent' | 'late' | 'excused',
  actorId:    string,
  notes?:     string,
): Promise<{ success: boolean; attendanceId?: number; error?: string }> {
  try {
    const [sched] = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);

    if (!sched) return { success: false, error: 'Schedule not found.' };

    const auth = await canManageSchedule(actorId, sched.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [existing] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, scheduleId))
      .limit(1);

    let attendanceId: number;

    if (existing) {
      await db
        .update(attendance)
        .set({ status, notes, recordedBy: actorId, updatedAt: new Date() })
        .where(eq(attendance.id, existing.id));
      attendanceId = existing.id;
    } else {
      const [att] = await db
        .insert(attendance)
        .values({
          scheduleId,
          userId:     sched.userId,
          storeId:    sched.storeId,
          date:       sched.date,
          shift:      sched.shift,
          status,
          onBreak:    false,
          notes,
          recordedBy: actorId,
        })
        .returning({ id: attendance.id });
      attendanceId = att.id;
    }

    return { success: true, attendanceId };
  } catch (err) {
    return { success: false, error: `opsMarkAttendance: ${err}` };
  }
}
// lib/schedule-utils.ts
/**
 * Monthly schedule management.
 */

import { db } from '@/lib/db';
import {
  areas, users, stores,
  monthlySchedules, monthlyScheduleEntries,
  schedules, attendance, breakSessions,
  storeOpeningTasks, groomingTasks,
  type Area, type MonthlySchedule, type MonthlyScheduleEntry, type BreakType,
} from '@/lib/db/schema';
import { eq, and, gte, lte, inArray, isNull, sql } from 'drizzle-orm';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SHIFT_CONFIG = {
  morning: { startHour: 8,  endHour: 17, lateAfterMinutes: 30, breakType: 'lunch'  as BreakType },
  evening: { startHour: 13, endHour: 22, lateAfterMinutes: 30, breakType: 'dinner' as BreakType },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Shift = 'morning' | 'evening';

export interface DayAssignment {
  userId:  string;
  storeId: string;
  date:    Date;
  shift:   Shift | null;
  isOff:   boolean;
  isLeave: boolean;
}

export interface CreateMonthlyScheduleInput {
  storeId:    string;
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

export async function getStoreArea(storeId: string): Promise<Area | null> {
  const [store] = await db
    .select({ areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store?.areaId) return null;
  const [area] = await db.select().from(areas).where(eq(areas.id, store.areaId)).limit(1);
  return area ?? null;
}

export async function getStoresForOps(opsUserId: string): Promise<string[]> {
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
  storeId: string,
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

/**
 * Create (or fully replace) a monthly schedule for a store+month.
 *
 * FIX (Bug 3): Changed onConflictDoNothing → onConflictDoUpdate so that
 * re-imports correctly update entries even when an attended entry already
 * exists for that (monthlyScheduleId, userId, date) unique key. Previously
 * attended entries were silently skipped, leaving employees with no updated
 * task row after a schedule change.
 */
export async function createOrReplaceMonthlySchedule(
  data: CreateMonthlyScheduleInput,
): Promise<{ success: boolean; scheduleId?: string; error?: string }> {
  try {
    const auth = await canManageSchedule(data.importedBy, data.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    if (!data.entries.length) return { success: false, error: 'No entries provided.' };

    // ── Find or create the MonthlySchedule header ─────────────────────────
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

    let monthlyScheduleId: string;

    if (existing) {
      monthlyScheduleId = existing.id;

      // ── Delete entries that are NOT yet attended ─────────────────────────
      const entriesToCheck = await db
        .select({
          id:      monthlyScheduleEntries.id,
          shift:   monthlyScheduleEntries.shift,
          isOff:   monthlyScheduleEntries.isOff,
          isLeave: monthlyScheduleEntries.isLeave,
        })
        .from(monthlyScheduleEntries)
        .where(eq(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleId));

      const deletableIds: string[] = [];
      for (const entry of entriesToCheck) {
        // OFF / leave entries never have a schedule row — always deletable
        if (entry.isOff || entry.isLeave || !entry.shift) {
          deletableIds.push(entry.id);
          continue;
        }
        // Working entry: only deletable if it has no attendance record yet
        const [sched] = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(eq(schedules.monthlyScheduleEntryId, entry.id))
          .limit(1);

        if (!sched) {
          deletableIds.push(entry.id);
          continue;
        }

        const [att] = await db
          .select({ id: attendance.id })
          .from(attendance)
          .where(eq(attendance.scheduleId, sched.id))
          .limit(1);

        if (!att) deletableIds.push(entry.id);
        // If attended — leave it untouched (lockedCount handled in delete flow)
      }

      // Delete pending schedule rows + tasks for deletable entries
      if (deletableIds.length > 0) {
        const entrySchedules = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(inArray(schedules.monthlyScheduleEntryId, deletableIds));

        if (entrySchedules.length > 0) {
          const schedIds = entrySchedules.map(s => s.id);
          await db.delete(storeOpeningTasks).where(
            and(
              inArray(storeOpeningTasks.scheduleId, schedIds),
              eq(storeOpeningTasks.status, 'pending'),
            ),
          );
          await db.delete(groomingTasks).where(
            and(
              inArray(groomingTasks.scheduleId, schedIds),
              eq(groomingTasks.status, 'pending'),
            ),
          );
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
      // Brand new schedule
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

    // ── Insert ALL entries (working, off, and leave) ───────────────────────
    // FIX (Bug 3): Use onConflictDoUpdate instead of onConflictDoNothing so
    // that re-imports correctly update the shift/isOff/isLeave fields on
    // entries that already exist (e.g. attended entries that couldn't be
    // deleted). Previously these were silently skipped.
    if (data.entries.length > 0) {
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
            // unique(monthlyScheduleId, userId, date)
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
    }

    // ── Materialise schedules + tasks for working entries only ─────────────
    await materialiseSchedulesForMonth(data.storeId, data.yearMonth);

    return { success: true, scheduleId: monthlyScheduleId };
  } catch (err) {
    console.error('[createOrReplaceMonthlySchedule]', err);
    return { success: false, error: `createOrReplaceMonthlySchedule: ${err}` };
  }
}

/**
 * Update a single day entry (e.g. change shift, mark leave, etc.)
 */
export async function updateMonthlyScheduleEntry(
  entryId: string,
  patch:   { shift?: Shift | null; isOff?: boolean; isLeave?: boolean },
  actorId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [entry] = await db
      .select({
        id:                monthlyScheduleEntries.id,
        monthlyScheduleId: monthlyScheduleEntries.monthlyScheduleId,
        userId:            monthlyScheduleEntries.userId,
        storeId:           monthlyScheduleEntries.storeId,
        date:              monthlyScheduleEntries.date,
        shift:             monthlyScheduleEntries.shift,
        isOff:             monthlyScheduleEntries.isOff,
        isLeave:           monthlyScheduleEntries.isLeave,
        createdAt:         monthlyScheduleEntries.createdAt,
        updatedAt:         monthlyScheduleEntries.updatedAt,
      })
      .from(monthlyScheduleEntries)
      .where(eq(monthlyScheduleEntries.id, entryId))
      .limit(1);

    if (!entry) return { success: false, error: 'Entry not found.' };

    const auth = await canManageSchedule(actorId, entry.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    // Block edits on attended days
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

      if (att)
        return {
          success: false,
          error:   'Cannot edit a schedule day that already has an attendance record.',
        };

      // Remove unattended schedule + tasks so they can be rebuilt
      await db.delete(storeOpeningTasks).where(
        and(
          eq(storeOpeningTasks.scheduleId, sched.id),
          eq(storeOpeningTasks.status, 'pending'),
        ),
      );
      await db.delete(groomingTasks).where(
        and(
          eq(groomingTasks.scheduleId, sched.id),
          eq(groomingTasks.status, 'pending'),
        ),
      );
      await db.delete(schedules).where(eq(schedules.id, sched.id));
    }

    await db
      .update(monthlyScheduleEntries)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(monthlyScheduleEntries.id, entryId));

    // Rebuild schedule row if the entry is now a working shift
    const updatedIsOff   = patch.isOff   !== undefined ? patch.isOff   : (entry.isOff   ?? false);
    const updatedIsLeave = patch.isLeave !== undefined ? patch.isLeave : (entry.isLeave ?? false);
    const updatedShift   = patch.shift   !== undefined ? patch.shift   : entry.shift;

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

/**
 * Delete a monthly schedule for a store+month.
 * Days with existing attendance are preserved (lockedCount returned).
 */
export async function deleteMonthlySchedule(
  storeId:   string,
  yearMonth: string,
  actorId:   string,
): Promise<{ success: boolean; lockedCount?: number; error?: string }> {
  try {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [ms] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(
        and(
          eq(monthlySchedules.storeId,   storeId),
          eq(monthlySchedules.yearMonth, yearMonth),
        ),
      )
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
    const deletableSchedIds: string[] = [];

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
      await db
        .delete(storeOpeningTasks)
        .where(inArray(storeOpeningTasks.scheduleId, deletableSchedIds));
      await db
        .delete(groomingTasks)
        .where(inArray(groomingTasks.scheduleId, deletableSchedIds));
      await db.delete(schedules).where(inArray(schedules.id, deletableSchedIds));
    }

    if (lockedCount === 0) {
      if (entryIds.length > 0)
        await db
          .delete(monthlyScheduleEntries)
          .where(inArray(monthlyScheduleEntries.id, entryIds));
      await db.delete(monthlySchedules).where(eq(monthlySchedules.id, ms.id));
    } else {
      // Partial delete — remove only unattended entries
      const attendedSchedIds = new Set(
        entrySchedules.filter(s => !deletableSchedIds.includes(s.id)).map(s => s.id),
      );
      const attendedEntryIds = new Set(
        entrySchedules
          .filter(s => attendedSchedIds.has(s.id))
          .map(s => s.entryId)
          .filter(Boolean),
      );
      const toDeleteEntries = entryIds.filter(id => !attendedEntryIds.has(id));
      if (toDeleteEntries.length > 0)
        await db
          .delete(monthlyScheduleEntries)
          .where(inArray(monthlyScheduleEntries.id, toDeleteEntries));
    }

    return { success: true, lockedCount };
  } catch (err) {
    return { success: false, error: `deleteMonthlySchedule: ${err}` };
  }
}

/**
 * Get a monthly schedule with all entries and user info.
 */
export async function getMonthlySchedule(
  storeId:   string,
  yearMonth: string,
): Promise<MonthlyScheduleWithEntries | null> {
  const [ms] = await db
    .select()
    .from(monthlySchedules)
    .where(
      and(
        eq(monthlySchedules.storeId,   storeId),
        eq(monthlySchedules.yearMonth, yearMonth),
      ),
    )
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

export async function listMonthlySchedules(storeId: string): Promise<MonthlySchedule[]> {
  return db
    .select()
    .from(monthlySchedules)
    .where(eq(monthlySchedules.storeId, storeId))
    .orderBy(sql`${monthlySchedules.yearMonth} DESC`);
}

// ─── Materialisation ──────────────────────────────────────────────────────────

/**
 * Convert all working MonthlyScheduleEntries for a store+month into
 * `schedules` rows and their associated task rows.
 * Idempotent — skips days already in `schedules`.
 */
export async function materialiseSchedulesForMonth(
  storeId:   string,
  yearMonth: string,
): Promise<{
  schedulesCreated:     number;
  openingTasksCreated:  number;
  groomingTasksCreated: number;
  errors:               string[];
}> {
  let schedulesCreated     = 0;
  let openingTasksCreated  = 0;
  let groomingTasksCreated = 0;
  const errors: string[]   = [];

  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(
      and(
        eq(monthlySchedules.storeId,   storeId),
        eq(monthlySchedules.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  if (!ms)
    return {
      schedulesCreated,
      openingTasksCreated,
      groomingTasksCreated,
      errors: ['Monthly schedule not found'],
    };

  const entries = await db
    .select()
    .from(monthlyScheduleEntries)
    .where(
      and(
        eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
        eq(monthlyScheduleEntries.isOff,             false),
        eq(monthlyScheduleEntries.isLeave,           false),
      ),
    );

  for (const entry of entries) {
    if (!entry.shift) continue;
    try {
      const result = await createScheduleAndTasks(entry);
      schedulesCreated     += result.scheduleCreated     ? 1 : 0;
      openingTasksCreated  += result.openingTaskCreated  ? 1 : 0;
      groomingTasksCreated += result.groomingTaskCreated ? 1 : 0;
    } catch (err) {
      errors.push(`Entry ${entry.id}: ${err}`);
    }
  }

  return { schedulesCreated, openingTasksCreated, groomingTasksCreated, errors };
}

// ─── Internal: create one schedule + task rows ────────────────────────────────

/**
 * FIX (Bug 1): Idempotency check now uses monthlyScheduleEntryId instead of
 * the composite (userId, storeId, shift, date) lookup. The old approach could
 * find the wrong row after a re-materialise (old entry deleted, new one
 * inserted with a different ID) causing either duplicate rows or incorrect skips.
 *
 * FIX (Bug 2): After inserting task rows, we immediately look for an existing
 * attendance record on this schedule and backfill attendanceId on both task
 * tables. This handles the re-materialise-after-checkin case where the new
 * schedule row gets a new ID but the attendance record still references the
 * original scheduleId — the tasks would otherwise sit permanently unlinked
 * and invisible to both employee and ops views.
 */
async function createScheduleAndTasks(
  entry: MonthlyScheduleEntry,
): Promise<{ scheduleCreated: boolean; openingTaskCreated: boolean; groomingTaskCreated: boolean }> {
  const shift = entry.shift as Shift;
  const date  = startOfDay(entry.date);

  // ── FIX (Bug 1): Key idempotency on the entry ID, not field combo ────────
  const [existing] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.monthlyScheduleEntryId, entry.id))
    .limit(1);

  if (existing)
    return { scheduleCreated: false, openingTaskCreated: false, groomingTaskCreated: false };

  const [newSched] = await db
    .insert(schedules)
    .values({
      userId:                 entry.userId,
      storeId:                entry.storeId,
      shift,
      date,
      monthlyScheduleEntryId: entry.id,
      isHoliday:              false,
    })
    .returning({ id: schedules.id });

  const schedId = newSched.id;

  let openingTaskCreated = false;
  if (shift === 'morning') {
    await db.insert(storeOpeningTasks).values({
      userId:     entry.userId,
      storeId:    entry.storeId,
      scheduleId: schedId,
      date,
      shift,
      status:     'pending',
    });
    openingTaskCreated = true;
  }

  await db.insert(groomingTasks).values({
    userId:     entry.userId,
    storeId:    entry.storeId,
    scheduleId: schedId,
    date,
    shift,
    status:     'pending',
  });

  // ── FIX (Bug 2): Backfill attendanceId if a checkin already exists ───────
  // This handles re-materialise-after-checkin: the new schedule row has a
  // fresh ID, but the attendance record was already created for the previous
  // schedule row's ID. Without this, tasks are permanently unlinked and
  // invisible on both the employee and ops pages.
  const [existingAtt] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(
      and(
        eq(attendance.userId,  entry.userId),
        eq(attendance.storeId, entry.storeId),
        eq(attendance.shift,   shift),
        gte(attendance.date,   startOfDay(date)),
        lte(attendance.date,   endOfDay(date)),
      ),
    )
    .limit(1);

  if (existingAtt) {
    // Also update the scheduleId on the attendance record itself so future
    // check-out and break queries resolve correctly against the new row.
    await db
      .update(attendance)
      .set({ scheduleId: schedId, updatedAt: new Date() })
      .where(eq(attendance.id, existingAtt.id));

    await db
      .update(storeOpeningTasks)
      .set({ attendanceId: existingAtt.id, updatedAt: new Date() })
      .where(eq(storeOpeningTasks.scheduleId, schedId));

    await db
      .update(groomingTasks)
      .set({ attendanceId: existingAtt.id, updatedAt: new Date() })
      .where(eq(groomingTasks.scheduleId, schedId));
  }

  return { scheduleCreated: true, openingTaskCreated, groomingTaskCreated: true };
}

// ─── Check-in / check-out ─────────────────────────────────────────────────────

export async function employeeCheckIn(
  userId:  string,
  storeId: string,
  shift:   Shift,
): Promise<{
  success:       boolean;
  action?:       'checked_in' | 'returned_from_break';
  attendanceId?: string;
  scheduleId?:   string;
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

      await db
        .update(storeOpeningTasks)
        .set({ attendanceId: att.id, updatedAt: new Date() })
        .where(eq(storeOpeningTasks.scheduleId, sched.id));
      await db
        .update(groomingTasks)
        .set({ attendanceId: att.id, updatedAt: new Date() })
        .where(eq(groomingTasks.scheduleId, sched.id));

      return {
        success:      true,
        action:       'checked_in',
        attendanceId: att.id,
        scheduleId:   sched.id,
        status:       attStatus,
      };
    }

    if (!existing.onBreak)
      return {
        success:      true,
        action:       'checked_in',
        attendanceId: existing.id,
        scheduleId:   sched.id,
        status:       existing.status,
      };

    return endBreak(userId, storeId, existing.id);
  } catch (err) {
    return { success: false, error: `Check-in failed: ${err}` };
  }
}

export async function employeeCheckOut(
  userId:  string,
  storeId: string,
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
  storeId: string,
  shift:   Shift,
): Promise<{ success: boolean; breakSessionId?: string; breakType?: BreakType; error?: string }> {
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
  storeId:      string,
  attendanceId: string,
): Promise<{
  success:       boolean;
  action?:       'returned_from_break';
  attendanceId?: string;
  scheduleId?:   string;
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

export async function getTodayAttendance(userId: string, storeId: string) {
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

export async function getAttendanceForDate(storeId: string, date: Date) {
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
  scheduleId: string,
  status:     'present' | 'absent' | 'late' | 'excused',
  actorId:    string,
  notes?:     string,
): Promise<{ success: boolean; attendanceId?: string; error?: string }> {
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

    let attendanceId: string;

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

      await db
        .update(storeOpeningTasks)
        .set({ attendanceId, updatedAt: new Date() })
        .where(eq(storeOpeningTasks.scheduleId, scheduleId));
      await db
        .update(groomingTasks)
        .set({ attendanceId, updatedAt: new Date() })
        .where(eq(groomingTasks.scheduleId, scheduleId));
    }

    return { success: true, attendanceId };
  } catch (err) {
    return { success: false, error: `opsMarkAttendance: ${err}` };
  }
}
// lib/schedule-utils.ts
/**
 * Weekly schedule management.
 *
 * ── AUTHORIZATION MODEL ───────────────────────────────────────────────────────
 *
 * Who can manage schedules:
 *   • PIC 1  (employeeType = 'pic_1') → PRIMARY owner. Creates and maintains all
 *                                       schedule templates for their own store.
 *   • OPS    (role = 'ops')           → OVERSIGHT role. Can review schedules for all
 *                                       stores in their area, and can override/correct
 *                                       mistakes — but does NOT normally create schedules.
 *                                       Normal flow: PIC 1 creates → OPS reviews/fixes.
 *   • PIC 2 / SO                      → read-only; cannot create or modify templates.
 *
 * Area structure:
 *   • An Area groups multiple Stores (stores.areaId → areas.id).
 *   • Each OPS user is assigned to one area (users.areaId → areas.id).
 *   • OPS can call any schedule function by passing a storeId that belongs to their area.
 *   • Authorization is checked with canManageSchedule() before any mutating operation.
 *
 * ── SCHEDULE GENERATION ───────────────────────────────────────────────────────
 *
 * Templates are PERMANENT and self-repeating.
 * PIC 1 (or OPS) sets a template ONCE → it automatically repeats every week.
 *
 * Rolling generation:
 *   • ensureSchedulesUpToDate(storeId) extends schedules ROLLING_WEEKS_AHEAD ahead.
 *   • Safe to call frequently — skips already-existing rows (idempotent).
 *   • Called lazily on page load, on check-in, or via a nightly cron job.
 *   • When a template changes, applyTemplateChange() deletes future unattended
 *     schedules and re-runs generation with the new pattern.
 *   • Past schedules are NEVER touched.
 *
 * SHIFT HOURS
 * ──────────────────────────────────────────────
 *  morning : 08:00 – 17:00  (late if check-in > 08:30)
 *  evening : 13:00 – 22:00  (late if check-in > 13:30)
 */

import { db } from '@/lib/db';
import {
  areas,
  weeklyScheduleTemplates,
  weeklyScheduleEntries,
  schedules,
  attendance,
  breakSessions,
  users,
  stores,
  employeeTasks,
  tasks,
  type Area,
  type WeeklyScheduleTemplate,
  type WeeklyScheduleEntry,
  type Task,
  type BreakType,
  type TaskRecurrence,
} from '@/lib/db/schema';
import { eq, and, gte, lte, inArray, isNull } from 'drizzle-orm';
import { shouldTaskRunOnDate } from '@/lib/daily-task-utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLLING_WEEKS_AHEAD = 4;

export const SHIFT_CONFIG = {
  morning: { startHour: 8,  endHour: 17, lateAfterMinutes: 30, breakType: 'lunch'  as BreakType },
  evening: { startHour: 13, endHour: 22, lateAfterMinutes: 30, breakType: 'dinner' as BreakType },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Shift = 'morning' | 'evening';

export interface TemplateEntry {
  weekday: number;
  shift: Shift;
}

export interface CreateTemplateInput {
  /** The employee whose schedule is being defined. */
  userId: string;
  storeId: string;
  entries: TemplateEntry[];
  note?: string;
  /** The user performing this action (PIC 1 of the store, or OPS for the area). */
  createdBy: string;
}

export interface TemplateWithUser {
  template: WeeklyScheduleTemplate;
  entries: WeeklyScheduleEntry[];
  user: {
    id: string;
    name: string;
    role: string;
    employeeType: string | null;
  } | null;
}

// ─── Authorization helpers ────────────────────────────────────────────────────

/**
 * Resolves the area that a given store belongs to.
 */
export async function getStoreArea(storeId: string): Promise<Area | null> {
  const [store] = await db
    .select({ areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store?.areaId) return null;

  const [area] = await db
    .select()
    .from(areas)
    .where(eq(areas.id, store.areaId))
    .limit(1);

  return area ?? null;
}

/**
 * Returns all stores in the area that an OPS user is assigned to.
 */
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

  return areaStores.map((s) => s.id);
}

/**
 * Central authorization check for any schedule-mutating operation.
 *
 * Returns { allowed: true } when:
 *   - actorId is an OPS user whose area contains storeId, OR
 *   - actorId is a PIC 1 whose own store matches storeId.
 *
 * Everyone else (PIC 2, SO, finance, etc.) is denied.
 */
export async function canManageSchedule(
  actorId: string,
  storeId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const [actor] = await db
    .select({ role: users.role, employeeType: users.employeeType, storeId: users.storeId, areaId: users.areaId })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  if (!actor) return { allowed: false, reason: 'Actor user not found.' };

  // OPS: allowed if the target store is in their area
  if (actor.role === 'ops') {
    if (!actor.areaId) return { allowed: false, reason: 'OPS user has no area assigned.' };

    const [targetStore] = await db
      .select({ areaId: stores.areaId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (!targetStore) return { allowed: false, reason: 'Store not found.' };

    if (targetStore.areaId !== actor.areaId) {
      return { allowed: false, reason: 'This store is not in your area.' };
    }

    return { allowed: true };
  }

  // PIC 1: allowed only for their own store
  if (actor.employeeType === 'pic_1') {
    if (actor.storeId !== storeId) {
      return { allowed: false, reason: 'PIC 1 can only manage schedules for their own store.' };
    }
    return { allowed: true };
  }

  // Everyone else is denied
  return {
    allowed: false,
    reason: 'Only OPS (for their area) or PIC 1 (for their own store) can manage schedules.',
  };
}

// ─── Template CRUD ────────────────────────────────────────────────────────────

/**
 * Upsert: deactivates any previous active template for the same employee+store,
 * then creates a fresh one with the given entries.
 *
 * Authorization is checked against `data.createdBy` — must be OPS (for their area)
 * or PIC 1 (for their own store).
 */
export async function createOrReplaceTemplate(
  data: CreateTemplateInput,
): Promise<{ success: boolean; templateId?: string; error?: string }> {
  try {
    // ── Auth check ─────────────────────────────────────────────────────────────
    const auth = await canManageSchedule(data.createdBy, data.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    if (!data.entries.length) {
      return { success: false, error: 'At least one working-day entry is required.' };
    }
    for (const e of data.entries) {
      if (e.weekday < 0 || e.weekday > 6)
        return { success: false, error: `Invalid weekday ${e.weekday}` };
    }

    // Deactivate old template for this employee+store
    const old = await db
      .select({ id: weeklyScheduleTemplates.id })
      .from(weeklyScheduleTemplates)
      .where(
        and(
          eq(weeklyScheduleTemplates.userId,   data.userId),
          eq(weeklyScheduleTemplates.storeId,  data.storeId),
          eq(weeklyScheduleTemplates.isActive, true),
        ),
      );

    if (old.length > 0) {
      await db
        .update(weeklyScheduleTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(weeklyScheduleTemplates.id, old.map((r) => r.id)));
    }

    // Create new template
    const [tmpl] = await db
      .insert(weeklyScheduleTemplates)
      .values({
        userId:    data.userId,
        storeId:   data.storeId,
        note:      data.note,
        createdBy: data.createdBy,
      })
      .returning({ id: weeklyScheduleTemplates.id });

    await db.insert(weeklyScheduleEntries).values(
      data.entries.map((e) => ({
        templateId: tmpl.id,
        weekday:    String(e.weekday) as '0'|'1'|'2'|'3'|'4'|'5'|'6',
        shift:      e.shift,
      })),
    );

    // Roll schedules forward immediately
    await ensureSchedulesUpToDate(data.storeId);

    return { success: true, templateId: tmpl.id };
  } catch (err) {
    return { success: false, error: `createOrReplaceTemplate: ${err}` };
  }
}

/**
 * Patch entries / note / isActive of an existing template.
 *
 * @param actorId - Must be OPS (for their area) or PIC 1 (for their store).
 */
export async function updateTemplate(
  templateId: string,
  patch: { entries?: TemplateEntry[]; note?: string; isActive?: boolean },
  actorId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Resolve storeId for the template so we can auth-check
    const [tmpl] = await db
      .select({ storeId: weeklyScheduleTemplates.storeId })
      .from(weeklyScheduleTemplates)
      .where(eq(weeklyScheduleTemplates.id, templateId))
      .limit(1);

    if (!tmpl) return { success: false, error: 'Template not found.' };

    const auth = await canManageSchedule(actorId, tmpl.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const headerPatch: Partial<typeof weeklyScheduleTemplates.$inferInsert> = {
      updatedAt: new Date(),
      // Track the last person to touch this template
      createdBy: actorId,
    };
    if (patch.note     !== undefined) headerPatch.note     = patch.note;
    if (patch.isActive !== undefined) headerPatch.isActive = patch.isActive;

    await db
      .update(weeklyScheduleTemplates)
      .set(headerPatch)
      .where(eq(weeklyScheduleTemplates.id, templateId));

    if (patch.entries) {
      await db
        .delete(weeklyScheduleEntries)
        .where(eq(weeklyScheduleEntries.templateId, templateId));

      if (patch.entries.length > 0) {
        await db.insert(weeklyScheduleEntries).values(
          patch.entries.map((e) => ({
            templateId,
            weekday: String(e.weekday) as '0'|'1'|'2'|'3'|'4'|'5'|'6',
            shift:   e.shift,
          })),
        );
      }

      await applyTemplateChange(templateId);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `updateTemplate: ${err}` };
  }
}

/**
 * List all templates for a store, joined with entries + user info.
 *
 * Readable by:
 *   - OPS users whose area includes this store.
 *   - PIC 1 of the store (sees all templates in their store).
 *   - PIC 2 / SO of the store (read-only; can view but not modify).
 *
 * (Filtering by viewer permissions is left to the calling layer if needed.)
 */
export async function getTemplatesForStore(
  storeId: string,
  activeOnly = true,
): Promise<TemplateWithUser[]> {
  const cond = activeOnly
    ? and(eq(weeklyScheduleTemplates.storeId, storeId), eq(weeklyScheduleTemplates.isActive, true))
    : eq(weeklyScheduleTemplates.storeId, storeId);

  const rows = await db
    .select({ template: weeklyScheduleTemplates, user: users })
    .from(weeklyScheduleTemplates)
    .leftJoin(users, eq(weeklyScheduleTemplates.userId, users.id))
    .where(cond)
    .orderBy(users.name);

  return Promise.all(
    rows.map(async ({ template, user }) => {
      const entries = await db
        .select()
        .from(weeklyScheduleEntries)
        .where(eq(weeklyScheduleEntries.templateId, template.id))
        .orderBy(weeklyScheduleEntries.weekday);

      return {
        template,
        entries,
        user: user
          ? { id: user.id, name: user.name, role: user.role, employeeType: user.employeeType }
          : null,
      };
    }),
  );
}

/**
 * List templates for ALL stores in an OPS user's area.
 * Convenience wrapper — used on the OPS multi-store dashboard.
 */
export async function getTemplatesForOpsArea(
  opsUserId: string,
  activeOnly = true,
): Promise<{ storeId: string; templates: TemplateWithUser[] }[]> {
  const storeIds = await getStoresForOps(opsUserId);
  if (!storeIds.length) return [];

  return Promise.all(
    storeIds.map(async (storeId) => ({
      storeId,
      templates: await getTemplatesForStore(storeId, activeOnly),
    })),
  );
}

// ─── Rolling schedule generation ──────────────────────────────────────────────

/**
 * MAIN ENTRY POINT — ensures all active templates for a store have schedules
 * generated at least ROLLING_WEEKS_AHEAD weeks into the future.
 *
 * Safe to call frequently — checks lastScheduledThrough and only creates
 * what's missing (idempotent).
 *
 * Recommended call sites:
 *   • On store dashboard / schedule page load
 *   • Inside employeeCheckIn()
 *   • Via a nightly cron job
 */
export async function ensureSchedulesUpToDate(
  storeId: string,
): Promise<{ schedulesCreated: number; tasksCreated: number; errors: string[] }> {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + ROLLING_WEEKS_AHEAD * 7);

  const templates = await getTemplatesForStore(storeId, true);
  if (!templates.length) return { schedulesCreated: 0, tasksCreated: 0, errors: [] };

  const allActiveTasks: Task[] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.isActive, true));

  let schedulesCreated = 0;
  let tasksCreated = 0;
  const errors: string[] = [];

  for (const { template, entries, user } of templates) {
    if (!user || !entries.length) continue;

    const resumeFrom = template.lastScheduledThrough
      ? new Date(template.lastScheduledThrough.getTime() + 86_400_000)
      : startOfDay(new Date());

    if (resumeFrom > horizon) continue;

    for (const date of eachDay(resumeFrom, horizon)) {
      const weekday = date.getDay();
      const todayEntries = entries.filter((e) => Number(e.weekday) === weekday);

      for (const entry of todayEntries) {
        try {
          const result = await createScheduleAndTasks({
            template,
            entry,
            user,
            date,
            storeId,
            allActiveTasks,
          });
          schedulesCreated += result.scheduleCreated ? 1 : 0;
          tasksCreated     += result.tasksCreated;
        } catch (err) {
          errors.push(`${user.name} ${date.toISOString().slice(0, 10)}: ${err}`);
        }
      }
    }

    await db
      .update(weeklyScheduleTemplates)
      .set({ lastScheduledThrough: horizon, updatedAt: new Date() })
      .where(eq(weeklyScheduleTemplates.id, template.id));
  }

  return { schedulesCreated, tasksCreated, errors };
}

/**
 * Convenience: ensure schedules are up-to-date for ALL stores in an OPS user's area.
 * Useful for the OPS multi-store overview page.
 */
export async function ensureSchedulesUpToDateForOps(
  opsUserId: string,
): Promise<{ storeId: string; schedulesCreated: number; tasksCreated: number; errors: string[] }[]> {
  const storeIds = await getStoresForOps(opsUserId);
  return Promise.all(
    storeIds.map(async (storeId) => ({
      storeId,
      ...(await ensureSchedulesUpToDate(storeId)),
    })),
  );
}

/**
 * Called by updateTemplate() when entries change.
 * Deletes future unattended schedules, resets lastScheduledThrough,
 * then re-runs ensureSchedulesUpToDate().
 */
export async function applyTemplateChange(
  templateId: string,
): Promise<{ schedulesCreated: number; tasksCreated: number; errors: string[] }> {
  const [tmpl] = await db
    .select()
    .from(weeklyScheduleTemplates)
    .where(eq(weeklyScheduleTemplates.id, templateId))
    .limit(1);

  if (!tmpl) return { schedulesCreated: 0, tasksCreated: 0, errors: ['Template not found'] };

  const today = startOfDay(new Date());

  const futureSchedules = await db
    .select({ id: schedules.id })
    .from(schedules)
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(schedules.userId,  tmpl.userId),
        eq(schedules.storeId, tmpl.storeId),
        gte(schedules.date,   today),
        isNull(attendance.id),
      ),
    );

  if (futureSchedules.length > 0) {
    await db
      .delete(employeeTasks)
      .where(
        and(
          inArray(employeeTasks.scheduleId, futureSchedules.map((s) => s.id)),
          eq(employeeTasks.status, 'pending'),
        ),
      );

    await db
      .delete(schedules)
      .where(inArray(schedules.id, futureSchedules.map((s) => s.id)));
  }

  const yesterday = new Date(today.getTime() - 86_400_000);
  await db
    .update(weeklyScheduleTemplates)
    .set({ lastScheduledThrough: yesterday, updatedAt: new Date() })
    .where(eq(weeklyScheduleTemplates.id, templateId));

  return ensureSchedulesUpToDate(tmpl.storeId);
}

// ─── Internal: create one schedule + its tasks ────────────────────────────────

async function createScheduleAndTasks({
  template,
  entry,
  user,
  date,
  storeId,
  allActiveTasks,
}: {
  template: WeeklyScheduleTemplate;
  entry: WeeklyScheduleEntry;
  user: { id: string; role: string; employeeType: string | null };
  date: Date;
  storeId: string;
  allActiveTasks: Task[];
}): Promise<{ scheduleCreated: boolean; tasksCreated: number }> {
  const existing = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(
      and(
        eq(schedules.userId,  template.userId),
        eq(schedules.storeId, storeId),
        eq(schedules.shift,   entry.shift),
        gte(schedules.date,   startOfDay(date)),
        lte(schedules.date,   endOfDay(date)),
      ),
    )
    .limit(1);

  if (existing.length > 0) return { scheduleCreated: false, tasksCreated: 0 };

  const [newSched] = await db
    .insert(schedules)
    .values({
      userId:          template.userId,
      storeId,
      shift:           entry.shift,
      date:            startOfDay(date),
      templateEntryId: entry.id,
      isHoliday:       false,
    })
    .returning({ id: schedules.id });

  let tasksCreated = 0;

  const matching = allActiveTasks.filter(
    (t) =>
      shouldTaskRunOnDate(t.recurrence as TaskRecurrence, t.recurrenceDays, date) &&
      taskMatchesEmployee(t, user, entry.shift),
  );

  for (const task of matching) {
    const dupCheck = await db
      .select({ id: employeeTasks.id })
      .from(employeeTasks)
      .where(
        and(
          eq(employeeTasks.taskId,     task.id),
          eq(employeeTasks.userId,     template.userId),
          eq(employeeTasks.scheduleId, newSched.id),
        ),
      )
      .limit(1);

    if (dupCheck.length > 0) continue;

    await db.insert(employeeTasks).values({
      taskId:     task.id,
      userId:     template.userId,
      storeId,
      scheduleId: newSched.id,
      date:       startOfDay(date),
      shift:      entry.shift,
      status:     'pending',
    });
    tasksCreated++;
  }

  return { scheduleCreated: true, tasksCreated };
}

// ─── Employee self-service ────────────────────────────────────────────────────

/**
 * Employee checks in — or returns from a break if one is currently open.
 * Also calls ensureSchedulesUpToDate() to keep rolling generation current.
 */
export async function employeeCheckIn(
  userId: string,
  storeId: string,
  shift: Shift,
): Promise<{
  success: boolean;
  action?: 'checked_in' | 'returned_from_break';
  attendanceId?: string;
  scheduleId?: string;
  status?: string;
  error?: string;
}> {
  try {
    await ensureSchedulesUpToDate(storeId);

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

    if (!sched) {
      return {
        success: false,
        error: 'You are not scheduled for this shift today. Please contact your PIC 1 or OPS manager.',
      };
    }

    const [existing] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (!existing) {
      const cfg        = SHIFT_CONFIG[shift];
      const shiftStart = new Date(now);
      shiftStart.setHours(cfg.startHour, 0, 0, 0);

      const lateThreshold = new Date(shiftStart);
      lateThreshold.setMinutes(cfg.lateAfterMinutes);

      const attStatus = now > lateThreshold ? 'late' : 'present';

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
        .update(employeeTasks)
        .set({ attendanceId: att.id, updatedAt: new Date() })
        .where(
          and(
            eq(employeeTasks.scheduleId, sched.id),
            eq(employeeTasks.userId,     userId),
          ),
        );

      return {
        success:      true,
        action:       'checked_in',
        attendanceId: att.id,
        scheduleId:   sched.id,
        status:       attStatus,
      };
    }

    if (!existing.onBreak) {
      return {
        success:      true,
        action:       'checked_in',
        attendanceId: existing.id,
        scheduleId:   sched.id,
        status:       existing.status,
      };
    }

    return endBreak(userId, storeId, existing.id);
  } catch (err) {
    return { success: false, error: `Check-in failed: ${err}` };
  }
}

/** Employee checks out at end of shift. */
export async function employeeCheckOut(
  userId: string,
  storeId: string,
  shift: Shift,
): Promise<{ success: boolean; error?: string }> {
  try {
    const now      = new Date();
    const dayStart = startOfDay(now);
    const dayEnd   = endOfDay(now);

    const [sched] = await db
      .select({ id: schedules.id })
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

    if (!sched) return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (!att)             return { success: false, error: 'No check-in record found for today.' };
    if (att.checkOutTime) return { success: false, error: 'Already checked out for this shift.' };
    if (att.onBreak)      return { success: false, error: 'You are currently on a break. Please return from your break before checking out.' };

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

/** Start a break (lunch for morning, dinner for evening). */
export async function startBreak(
  userId: string,
  storeId: string,
  shift: Shift,
): Promise<{ success: boolean; breakSessionId?: string; breakType?: BreakType; error?: string }> {
  try {
    const now      = new Date();
    const dayStart = startOfDay(now);
    const dayEnd   = endOfDay(now);

    const [sched] = await db
      .select({ id: schedules.id })
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

    if (!sched) return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (!att)             return { success: false, error: 'No check-in record found for today.' };
    if (!att.checkInTime) return { success: false, error: 'You have not checked in yet.' };
    if (att.checkOutTime) return { success: false, error: 'You have already checked out for this shift.' };
    if (att.onBreak)      return { success: false, error: 'You are already on a break.' };

    const breakType = SHIFT_CONFIG[shift].breakType;

    const priorBreaks = await db
      .select({ id: breakSessions.id })
      .from(breakSessions)
      .where(eq(breakSessions.attendanceId, att.id));

    if (priorBreaks.length > 0) {
      const label = breakType === 'lunch' ? 'lunch' : 'dinner';
      return { success: false, error: `You have already used your ${label} break for this shift.` };
    }

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

/** End an active break — called directly or via employeeCheckIn() when onBreak=true. */
export async function endBreak(
  userId: string,
  storeId: string,
  attendanceId: string,
): Promise<{
  success: boolean;
  action?: 'returned_from_break';
  attendanceId?: string;
  scheduleId?: string;
  status?: string;
  error?: string;
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
      .returning({ id: attendance.id, scheduleId: attendance.scheduleId, status: attendance.status });

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

/** Get today's attendance record for an employee, including any break sessions. */
export async function getTodayAttendance(userId: string, storeId: string) {
  const now = new Date();

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

/** Get all break sessions for a given attendance record. */
export async function getBreakSessions(attendanceId: string) {
  return db
    .select()
    .from(breakSessions)
    .where(eq(breakSessions.attendanceId, attendanceId))
    .orderBy(breakSessions.breakOutTime);
}

// ─── OPS attendance management ────────────────────────────────────────────────

/**
 * Get all schedules + attendance status for a store on a date.
 * OPS can call this for any store in their area.
 */
export async function getAttendanceForDate(storeId: string, date: Date) {
  await ensureSchedulesUpToDate(storeId);

  return db
    .select({
      schedule:   schedules,
      user:       users,
      attendance: attendance,
    })
    .from(schedules)
    .leftJoin(users,      eq(schedules.userId,      users.id))
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

/**
 * OPS manually sets / overrides attendance status for a schedule.
 * actorId must pass canManageSchedule() for the store.
 */
export async function opsMarkAttendance(
  scheduleId: string,
  status: 'present' | 'absent' | 'late' | 'excused',
  actorId: string,
  notes?: string,
): Promise<{ success: boolean; attendanceId?: string; error?: string }> {
  try {
    const [sched] = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);

    if (!sched) return { success: false, error: 'Schedule not found' };

    // Auth check
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
        .update(employeeTasks)
        .set({ attendanceId, updatedAt: new Date() })
        .where(
          and(
            eq(employeeTasks.scheduleId, scheduleId),
            eq(employeeTasks.userId,     sched.userId),
          ),
        );
    }

    return { success: true, attendanceId };
  } catch (err) {
    return { success: false, error: `opsMarkAttendance: ${err}` };
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}
function* eachDay(start: Date, end: Date): Generator<Date> {
  const cur = startOfDay(start);
  const fin = startOfDay(end);
  while (cur <= fin) {
    yield new Date(cur);
    cur.setDate(cur.getDate() + 1);
  }
}
function taskMatchesEmployee(
  task: { role: string; employeeType: string | null; shift: string | null },
  user: { role: string; employeeType: string | null },
  shift: string,
): boolean {
  // pic_1 and pic_2 are both PIC-role employees; tasks targeting 'pic_1' or 'pic_2'
  // are matched exactly. Tasks with employeeType=null match all types for that role.
  return (
    task.role === user.role &&
    (!task.employeeType || task.employeeType === user.employeeType) &&
    (!task.shift || task.shift === shift)
  );
}
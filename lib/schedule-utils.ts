// lib/schedule-utils.ts
/**
 * Monthly schedule management + attendance utilities.
 *
 * Dynamic-shift version:
 * - Shift codes come from the `shifts` lookup table.
 * - `Shift` is intentionally `string`, not a fixed union.
 * - Schedule create/update validates shift codes against active DB rows.
 * - Attendance check-in/check-out/breaks resolve the selected shift by DB code.
 * - No db.transaction() usage, so this stays compatible with Neon HTTP.
 */

import { db } from "@/lib/db";
import {
  areas,
  users,
  stores,
  monthlySchedules,
  monthlyScheduleEntries,
  schedules,
  attendance,
  breakSessions,
  userRoles,
  employeeTypes,
  shifts,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  cekBinTasks,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  briefingTasks,
  storeClosingTasks,
  groomingTasks,
  type Area,
  type MonthlySchedule,
  type MonthlyScheduleEntry,
} from "@/lib/db/schema";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { createNotification, deleteNotificationsByRelated } from "@/lib/db/utils/notifications";

export type { BreakType } from "@/lib/db/schema";
import type { BreakType } from "@/lib/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────
// Legacy default break rules. These keep existing morning/evening/full_day
// behavior working, while custom shifts remain supported as DB-backed shifts.

export const SHIFT_CONFIG = {
  morning: {
    breakTypes: ["lunch"] as BreakType[],
    maxBreaks: 1,
  },
  evening: {
    breakTypes: ["dinner"] as BreakType[],
    maxBreaks: 1,
  },
  full_day: {
    breakTypes: ["full_day_lunch", "full_day_dinner"] as BreakType[],
    maxBreaks: 2,
  },
} as const;

export const VALID_BREAK_TYPES = [
  "lunch",
  "dinner",
  "full_day_lunch",
  "full_day_dinner",
] as const satisfies readonly BreakType[];

// ─── Types ────────────────────────────────────────────────────────────────────

export type Shift = string;

export interface DayAssignment {
  userId: string;
  storeId: number;
  date: Date;
  shift: Shift | null;
  isOff: boolean;
  isLeave: boolean;
}

export interface CreateMonthlyScheduleInput {
  storeId: number;
  yearMonth: string;
  entries: DayAssignment[];
  note?: string;
  importedBy: string;
}

export interface MonthlyScheduleWithEntries {
  schedule: MonthlySchedule;
  entries: (MonthlyScheduleEntry & {
    userName: string | null;
    userEmployeeType: string | null;
    shiftCode: string | null;
    shiftLabel: string | null;
  })[];
}

export interface NextScheduleResult {
  scheduleId: number;
  userId: string;
  date: Date;
}

interface ShiftLookupRow {
  id: number;
  code: string;
  label: string;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/**
 * "Today" as a naive local Date — matching how schedule/attendance dates are
 * stored (materialiseSchedulesForMonth writes `startOfDay(entry.date)`, built
 * from a plain Y-M-D string with no timezone attached).
 *
 * Deriving "today" from `new Date()` directly is wrong on any server not
 * running in the store's timezone — Vercel serverless functions default to
 * UTC. From Jakarta midnight to 06:59, the server's own clock is still on
 * "yesterday" (Jakarta is UTC+7), so a schedule lookup keyed off a naive
 * `new Date()` misses that day's row entirely — e.g. an employee who checks
 * in for the morning shift at 6am WIB gets recorded fine (check-in and the
 * lookup happen at the same moment, so they agree with each other), but once
 * the server's UTC clock rolls over at 7am WIB, every later read of "today"
 * shifts forward a day and no longer matches that same schedule/attendance
 * row — which is exactly why re-opening a task shortly after checking in can
 * wrongly report "not checked in".
 *
 * Use this wherever "today" is the anchor for querying schedules/attendance/
 * task rows; keep using bare `new Date()` for genuine timestamps (e.g.
 * `checkInTime`) that should record the real instant, not a day bucket.
 */
export function todayInStoreTimezone(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  return new Date(year, month - 1, day);
}

export function yearMonthToDate(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
}

export function dateToYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isValidBreakType(value: unknown): value is BreakType {
  return (
    typeof value === "string" &&
    (VALID_BREAK_TYPES as readonly string[]).includes(value)
  );
}

async function getShiftRows(activeOnly = false): Promise<ShiftLookupRow[]> {
  const query = db
    .select({
      id: shifts.id,
      code: shifts.code,
      label: shifts.label,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      isActive: shifts.isActive,
    })
    .from(shifts);

  const rows = activeOnly
    ? await query.where(eq(shifts.isActive, true))
    : await query;

  return rows;
}

async function getShiftIdMap(
  activeOnly = false,
): Promise<Record<string, number>> {
  const rows = await getShiftRows(activeOnly);
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

async function getShiftByCode(
  code: string,
  activeOnly = true,
): Promise<ShiftLookupRow | null> {
  const filters = activeOnly
    ? and(eq(shifts.code, code), eq(shifts.isActive, true))
    : eq(shifts.code, code);

  const [row] = await db
    .select({
      id: shifts.id,
      code: shifts.code,
      label: shifts.label,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      isActive: shifts.isActive,
    })
    .from(shifts)
    .where(filters)
    .limit(1);

  return row ?? null;
}

async function resolveActiveShiftId(code: string): Promise<number | null> {
  const row = await getShiftByCode(code, true);
  return row?.id ?? null;
}

function getLegacyBreakConfig(shiftCode: string): {
  breakTypes: BreakType[];
  maxBreaks: number;
} {
  if (shiftCode === "morning") return SHIFT_CONFIG.morning;
  if (shiftCode === "evening") return SHIFT_CONFIG.evening;
  if (shiftCode === "full_day") return SHIFT_CONFIG.full_day;

  // Custom shifts are dynamic. The API should send an allowed break type based
  // on shifts.breaks. The util keeps a safe default so direct callers still work.
  return {
    breakTypes: [...VALID_BREAK_TYPES],
    maxBreaks: 1,
  };
}

// Keep schedule/task cleanup compatible with Neon HTTP by avoiding giant IN queries.
// This is also the only task-table cleanup owned by schedule-utils. The actual
// task-generation rules live in lib/db/utils/tasks.ts.
const SCHEDULE_TASK_DELETE_BATCH_SIZE = 150;

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))];
}

function chunkArray<T>(
  items: T[],
  size = SCHEDULE_TASK_DELETE_BATCH_SIZE,
): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Delete all task rows referencing the given schedule IDs.
 *
 * Store Closing replaces the removed evening task tables:
 *   - edc_reconciliation_tasks
 *   - eod_z_report_tasks
 *   - open_statement_tasks
 *
 * Those tables must not be referenced here anymore after the destructive
 * migration, otherwise schedule replace/delete will fail at build/runtime.
 */
async function deleteAllTasksForSchedules(
  scheduleIds: number[],
): Promise<void> {
  const ids = uniqueNumbers(scheduleIds);
  if (ids.length === 0) return;

  for (const batch of chunkArray(ids)) {
    await Promise.all([
      db
        .delete(storeOpeningTasks)
        .where(inArray(storeOpeningTasks.scheduleId, batch)),
      db
        .delete(storeFrontTasks)
        .where(inArray(storeFrontTasks.scheduleId, batch)),
      db.delete(setoranTasks).where(inArray(setoranTasks.scheduleId, batch)),
      db.delete(cekBinTasks).where(inArray(cekBinTasks.scheduleId, batch)),
      db
        .delete(vmChecklistTasks)
        .where(inArray(vmChecklistTasks.scheduleId, batch)),
      db
        .delete(marketingCheckTasks)
        .where(inArray(marketingCheckTasks.scheduleId, batch)),
      db
        .delete(itemDroppingTasks)
        .where(inArray(itemDroppingTasks.scheduleId, batch)),
      db.delete(briefingTasks).where(inArray(briefingTasks.scheduleId, batch)),
      // serah_terima intentionally excluded — entries aren't tied to a
      // schedule's lifecycle anymore (shared rolling board per store).
      db
        .delete(storeClosingTasks)
        .where(inArray(storeClosingTasks.scheduleId, batch)),
      db
        .delete(groomingTasks)
        .where(inArray(groomingTasks.scheduleId, batch as any)),
    ]);
  }
}

// ─── Authorization ────────────────────────────────────────────────────────────

export async function getStoreArea(storeId: number): Promise<Area | null> {
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

export async function getStoresForOps(opsUserId: string): Promise<number[]> {
  const [opsUser] = await db
    .select({
      areaId: users.areaId,
      roleCode: userRoles.code,
      employeeTypeCode: employeeTypes.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .where(eq(users.id, opsUserId))
    .limit(1);

  if (!opsUser) return [];

  /**
   * IT and OPS HO see every store (they're seeded with areaId = null,
   * which is *not* "no access" — it means "all areas").
   */
  const isAllAreas = opsUser.roleCode === "it" || opsUser.employeeTypeCode === "ops_ho";

  if (isAllAreas) {
    const allStores = await db.select({ id: stores.id }).from(stores);
    return allStores.map((s) => s.id);
  }

  if (!opsUser.areaId) return [];

  const areaStores = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.areaId, opsUser.areaId));
  return areaStores.map((s) => s.id);
}

/**
 * Check whether `actorId` may manage schedules for `storeId`.
 *
 * Pass `targetEntryStoreId` when an operation targets an entry whose storeId
 * may differ from the schedule's owning store. OPS HO/Admin may cross-post;
 * area OPS may only cross-post inside their area; PIC 1 may not cross-post.
 */
export async function canManageSchedule(
  actorId: string,
  storeId: number,
  targetEntryStoreId?: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const [actor] = await db
    .select({
      roleId: users.roleId,
      employeeTypeId: users.employeeTypeId,
      homeStoreId: users.homeStoreId,
      areaId: users.areaId,
    })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  if (!actor) return { allowed: false, reason: "Actor not found." };

  let roleCode: string | null = null;
  if (actor.roleId) {
    const [role] = await db
      .select({ code: userRoles.code })
      .from(userRoles)
      .where(eq(userRoles.id, actor.roleId))
      .limit(1);
    roleCode = role?.code ?? null;
  }

  let empTypeCode: string | null = null;
  if (actor.employeeTypeId) {
    const [type] = await db
      .select({ code: employeeTypes.code })
      .from(employeeTypes)
      .where(eq(employeeTypes.id, actor.employeeTypeId))
      .limit(1);
    empTypeCode = type?.code ?? null;
  }

  const isAdmin = roleCode === "it";
  const isOpsHo = roleCode === "ops" || empTypeCode === "ops_ho";
  const isOpsArea = empTypeCode === "ops_area";

  if (isAdmin || empTypeCode === "ops_ho") {
    const [targetStore] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!targetStore) return { allowed: false, reason: "Store not found." };

    if (targetEntryStoreId && targetEntryStoreId !== storeId) {
      const [entryStore] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, targetEntryStoreId))
        .limit(1);
      if (!entryStore)
        return { allowed: false, reason: "Cross-post target store not found." };
    }

    return { allowed: true };
  }

  if (isOpsHo || isOpsArea || roleCode === "ops") {
    if (!actor.areaId)
      return { allowed: false, reason: "OPS user has no area assigned." };

    const [targetStore] = await db
      .select({ areaId: stores.areaId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (!targetStore) return { allowed: false, reason: "Store not found." };
    if (targetStore.areaId !== actor.areaId)
      return { allowed: false, reason: "This store is not in your area." };

    if (targetEntryStoreId && targetEntryStoreId !== storeId) {
      const [entryStore] = await db
        .select({ areaId: stores.areaId })
        .from(stores)
        .where(eq(stores.id, targetEntryStoreId))
        .limit(1);

      if (!entryStore)
        return { allowed: false, reason: "Cross-post target store not found." };
      if (entryStore.areaId !== actor.areaId)
        return {
          allowed: false,
          reason: "Cross-post target store is not in your area.",
        };
    }

    return { allowed: true };
  }

  if (empTypeCode === "pic_1" || empTypeCode === "pic_2") {
    if (Number(actor.homeStoreId) !== Number(storeId)) {
      return {
        allowed: false,
        reason: "PIC can only manage schedules for their home store.",
      };
    }

    if (targetEntryStoreId && targetEntryStoreId !== storeId) {
      return {
        allowed: false,
        reason: "PIC can only assign employees to their home store.",
      };
    }

    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "Only OPS, OPS Area, OPS HO, Admin, or PIC can manage schedules.",
  };
}

// ─── Monthly Schedule CRUD ────────────────────────────────────────────────────

export async function createEmptyMonthlySchedule(
  storeId: number,
  yearMonth: string,
  actorId: string,
  note?: string,
): Promise<{ success: boolean; scheduleId?: number; error?: string }> {
  try {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return { success: false, error: "yearMonth must be in YYYY-MM format." };
    }

    const [existing] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(
        and(
          eq(monthlySchedules.storeId, storeId),
          eq(monthlySchedules.yearMonth, yearMonth),
        ),
      )
      .limit(1);

    if (existing)
      return {
        success: false,
        error: `A schedule for ${yearMonth} already exists.`,
      };

    const [ms] = await db
      .insert(monthlySchedules)
      .values({ storeId, yearMonth, importedBy: actorId, note })
      .returning({ id: monthlySchedules.id });

    return { success: true, scheduleId: ms.id };
  } catch (err) {
    return { success: false, error: `createEmptyMonthlySchedule: ${err}` };
  }
}

export async function createOrReplaceMonthlySchedule(
  data: CreateMonthlyScheduleInput,
): Promise<{
  success: boolean;
  scheduleId?: number;
  error?: string;
  /**
   * Incoming entries that were dropped instead of applied because the day is
   * already in the past or the employee has already checked in for it.
   */
  skippedProtected?: number;
}> {
  try {
    const auth = await canManageSchedule(data.importedBy, data.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };
    if (!data.entries.length)
      return { success: false, error: "No entries provided." };

    // A re-import must never rewrite history: any day earlier than "today"
    // (store timezone) and any day an employee has already checked in for is
    // locked. Keyed by userId + local-midnight timestamp so it can be matched
    // against both the DB rows and the parsed import rows.
    const dayKey = (userId: string, date: Date) =>
      `${userId}|${startOfDay(date).getTime()}`;
    const todayStart = startOfDay(todayInStoreTimezone());
    const protectedDayKeys = new Set<string>();

    const uniqueEntryStoreIds = [
      ...new Set(
        data.entries.map((e) => e.storeId).filter((id) => id !== data.storeId),
      ),
    ];
    for (const entryStoreId of uniqueEntryStoreIds) {
      const crossCheck = await canManageSchedule(
        data.importedBy,
        data.storeId,
        entryStoreId,
      );
      if (!crossCheck.allowed)
        return { success: false, error: crossCheck.reason };
    }

    const activeShiftMap = await getShiftIdMap(true);
    for (const entry of data.entries) {
      const shouldHaveShift = !entry.isOff && !entry.isLeave && entry.shift;
      if (shouldHaveShift && !activeShiftMap[entry.shift!]) {
        return {
          success: false,
          error: `Unknown or inactive shift "${entry.shift}".`,
        };
      }
    }

    const [existing] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(
        and(
          eq(monthlySchedules.storeId, data.storeId),
          eq(monthlySchedules.yearMonth, data.yearMonth),
        ),
      )
      .limit(1);

    let monthlyScheduleId: number;

    if (existing) {
      monthlyScheduleId = existing.id;

      const entriesToCheck = await db
        .select({
          id: monthlyScheduleEntries.id,
          userId: monthlyScheduleEntries.userId,
          date: monthlyScheduleEntries.date,
        })
        .from(monthlyScheduleEntries)
        .where(eq(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleId));

      const entryIds = entriesToCheck.map((e) => e.id);

      // Days already in the past are locked regardless of attendance.
      const pastEntryIds = new Set(
        entriesToCheck
          .filter((e) => startOfDay(e.date) < todayStart)
          .map((e) => e.id),
      );

      if (entryIds.length > 0) {
        const entrySchedules = await db
          .select({
            id: schedules.id,
            entryId: schedules.monthlyScheduleEntryId,
          })
          .from(schedules)
          .where(inArray(schedules.monthlyScheduleEntryId, entryIds));

        const lockedSchedIds = new Set<number>();

        if (entrySchedules.length > 0) {
          const schedIds = entrySchedules.map((s) => s.id);
          const attended = await db
            .select({ scheduleId: attendance.scheduleId })
            .from(attendance)
            .where(inArray(attendance.scheduleId, schedIds));

          for (const a of attended) lockedSchedIds.add(a.scheduleId);
        }

        // Entries the import is not allowed to touch: already checked in, or
        // already in the past.
        const attendedEntryIds = new Set(
          entrySchedules
            .filter((s) => lockedSchedIds.has(s.id))
            .map((s) => s.entryId)
            .filter((id): id is number => id != null),
        );
        const protectedEntryIds = new Set<number>([
          ...attendedEntryIds,
          ...pastEntryIds,
        ]);

        for (const e of entriesToCheck) {
          if (protectedEntryIds.has(e.id)) {
            protectedDayKeys.add(dayKey(e.userId, e.date));
          }
        }

        const deletableSchedIds = entrySchedules
          .filter(
            (s) =>
              !lockedSchedIds.has(s.id) &&
              !(s.entryId != null && pastEntryIds.has(s.entryId)),
          )
          .map((s) => s.id);
        const deletableEntryIds = entryIds.filter(
          (id) => !protectedEntryIds.has(id),
        );

        await deleteAllTasksForSchedules(deletableSchedIds);
        if (deletableSchedIds.length > 0)
          await db
            .delete(schedules)
            .where(inArray(schedules.id, deletableSchedIds));
        if (deletableEntryIds.length > 0)
          await db
            .delete(monthlyScheduleEntries)
            .where(inArray(monthlyScheduleEntries.id, deletableEntryIds));
      }

      await db
        .update(monthlySchedules)
        .set({ note: data.note, updatedAt: new Date() })
        .where(eq(monthlySchedules.id, monthlyScheduleId));
    } else {
      const [ms] = await db
        .insert(monthlySchedules)
        .values({
          storeId: data.storeId,
          yearMonth: data.yearMonth,
          importedBy: data.importedBy,
          note: data.note,
        })
        .returning({ id: monthlySchedules.id });
      monthlyScheduleId = ms.id;
    }

    // Drop any incoming row that targets a locked day (past / already checked
    // in). For a brand-new schedule nothing is locked, so this is a no-op.
    const entriesToApply = data.entries.filter(
      (e) => !protectedDayKeys.has(dayKey(e.userId, e.date)),
    );
    const skippedProtected = data.entries.length - entriesToApply.length;

    const BATCH = 100;

    for (let i = 0; i < entriesToApply.length; i += BATCH) {
      const batch = entriesToApply.slice(i, i + BATCH);

      await db
        .insert(monthlyScheduleEntries)
        .values(
          batch.map((e) => {
            const normalisedShift = e.isOff || e.isLeave ? null : e.shift;
            return {
              monthlyScheduleId,
              userId: e.userId,
              storeId: e.storeId,
              date: startOfDay(e.date),
              shiftId: normalisedShift
                ? (activeShiftMap[normalisedShift] ?? null)
                : null,
              isOff: e.isOff,
              isLeave: e.isLeave,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [
            monthlyScheduleEntries.monthlyScheduleId,
            monthlyScheduleEntries.userId,
            monthlyScheduleEntries.date,
          ],
          set: {
            shiftId: sql`excluded.shift_id`,
            isOff: sql`excluded.is_off`,
            isLeave: sql`excluded.is_leave`,
            updatedAt: new Date(),
          },
        });
    }

    await materialiseSchedulesForMonth(data.storeId, data.yearMonth);
    return { success: true, scheduleId: monthlyScheduleId, skippedProtected };
  } catch (err) {
    return { success: false, error: `createOrReplaceMonthlySchedule: ${err}` };
  }
}

export async function updateMonthlyScheduleEntry(
  entryId: number,
  patch: { shift?: Shift | null; isOff?: boolean; isLeave?: boolean },
  actorId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [entry] = await db
      .select()
      .from(monthlyScheduleEntries)
      .where(eq(monthlyScheduleEntries.id, entryId))
      .limit(1);
    if (!entry) return { success: false, error: "Entry not found." };

    const [ms] = await db
      .select({ storeId: monthlySchedules.storeId })
      .from(monthlySchedules)
      .where(eq(monthlySchedules.id, entry.monthlyScheduleId))
      .limit(1);

    if (!ms) return { success: false, error: "Monthly schedule not found." };

    const auth = await canManageSchedule(actorId, ms.storeId, entry.storeId);
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
      if (att)
        return {
          success: false,
          error: "Cannot edit a day that already has an attendance record.",
        };

      await deleteAllTasksForSchedules([sched.id]);
      await db.delete(schedules).where(eq(schedules.id, sched.id));
    }

    const currentShiftCode = entry.shiftId
      ? (Object.entries(await getShiftIdMap(false)).find(
          ([, id]) => id === entry.shiftId,
        )?.[0] ?? null)
      : null;

    const finalIsOff = patch.isOff !== undefined ? patch.isOff : entry.isOff;
    const finalIsLeave =
      patch.isLeave !== undefined ? patch.isLeave : entry.isLeave;
    const finalShift =
      patch.shift !== undefined ? patch.shift : currentShiftCode;
    const normalisedShift = finalIsOff || finalIsLeave ? null : finalShift;

    let shiftIdToUse: number | null = null;
    if (normalisedShift) {
      shiftIdToUse = await resolveActiveShiftId(normalisedShift);
      if (!shiftIdToUse)
        return {
          success: false,
          error: `Unknown or inactive shift "${normalisedShift}".`,
        };
    }

    await db
      .update(monthlyScheduleEntries)
      .set({
        shiftId: shiftIdToUse,
        isOff: finalIsOff,
        isLeave: finalIsLeave,
        updatedAt: new Date(),
      })
      .where(eq(monthlyScheduleEntries.id, entryId));

    if (!finalIsOff && !finalIsLeave && shiftIdToUse) {
      const [newSched] = await db
        .insert(schedules)
        .values({
          userId: entry.userId,
          storeId: entry.storeId,
          shiftId: shiftIdToUse,
          date: startOfDay(entry.date),
          monthlyScheduleEntryId: entryId,
          isHoliday: false,
        })
        .returning({ id: schedules.id });

      const [existingAtt] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(
          and(
            eq(attendance.userId, entry.userId),
            eq(attendance.storeId, entry.storeId),
            eq(attendance.shiftId, shiftIdToUse),
            gte(attendance.date, startOfDay(entry.date)),
            lte(attendance.date, endOfDay(entry.date)),
          ),
        )
        .limit(1);

      if (existingAtt) {
        await db
          .update(attendance)
          .set({ scheduleId: newSched.id, updatedAt: new Date() })
          .where(eq(attendance.id, existingAtt.id));
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `updateMonthlyScheduleEntry: ${err}` };
  }
}

export async function deleteMonthlySchedule(
  storeId: number,
  yearMonth: string,
  actorId: string,
): Promise<{ success: boolean; lockedCount?: number; error?: string }> {
  try {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [ms] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(
        and(
          eq(monthlySchedules.storeId, storeId),
          eq(monthlySchedules.yearMonth, yearMonth),
        ),
      )
      .limit(1);

    if (!ms) return { success: false, error: "Monthly schedule not found." };

    const allEntries = await db
      .select({ id: monthlyScheduleEntries.id })
      .from(monthlyScheduleEntries)
      .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));

    const entryIds = allEntries.map((e) => e.id);

    const entrySchedules =
      entryIds.length > 0
        ? await db
            .select({
              id: schedules.id,
              entryId: schedules.monthlyScheduleEntryId,
            })
            .from(schedules)
            .where(inArray(schedules.monthlyScheduleEntryId, entryIds))
        : [];

    const lockedSchedIds = new Set<number>();
    if (entrySchedules.length > 0) {
      const schedIds = entrySchedules.map((s) => s.id);
      const attended = await db
        .select({ scheduleId: attendance.scheduleId })
        .from(attendance)
        .where(inArray(attendance.scheduleId, schedIds));

      for (const a of attended) lockedSchedIds.add(a.scheduleId);
    }

    const deletableSchedIds = entrySchedules
      .filter((s) => !lockedSchedIds.has(s.id))
      .map((s) => s.id);
    const lockedCount = lockedSchedIds.size;
    const lockedEntryIds = new Set(
      entrySchedules
        .filter((s) => lockedSchedIds.has(s.id))
        .map((s) => s.entryId)
        .filter((id): id is number => id != null),
    );

    await deleteAllTasksForSchedules(deletableSchedIds);
    if (deletableSchedIds.length > 0)
      await db
        .delete(schedules)
        .where(inArray(schedules.id, deletableSchedIds));

    if (lockedCount === 0) {
      if (entryIds.length > 0)
        await db
          .delete(monthlyScheduleEntries)
          .where(inArray(monthlyScheduleEntries.id, entryIds));
      await db.delete(monthlySchedules).where(eq(monthlySchedules.id, ms.id));
    } else {
      const deletableEntryIds = entryIds.filter(
        (id) => !lockedEntryIds.has(id),
      );
      if (deletableEntryIds.length > 0)
        await db
          .delete(monthlyScheduleEntries)
          .where(inArray(monthlyScheduleEntries.id, deletableEntryIds));
    }

    return { success: true, lockedCount };
  } catch (err) {
    return { success: false, error: `deleteMonthlySchedule: ${err}` };
  }
}

export async function createMonthlyScheduleEntry(
  storeId: number,
  yearMonth: string,
  userId: string,
  date: Date,
  state: {
    shift?: Shift | null;
    isOff?: boolean;
    isLeave?: boolean;
    entryStoreId?: number;
  },
  actorId: string,
): Promise<{ success: boolean; entryId?: number; error?: string }> {
  try {
    const entryStoreId = state.entryStoreId ?? storeId;
    const auth = await canManageSchedule(actorId, storeId, entryStoreId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const [ms] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(
        and(
          eq(monthlySchedules.storeId, storeId),
          eq(monthlySchedules.yearMonth, yearMonth),
        ),
      )
      .limit(1);

    if (!ms)
      return {
        success: false,
        error: `No monthly schedule for ${yearMonth}. Create one first.`,
      };

    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return { success: false, error: "User not found." };

    const dateStart = startOfDay(date);

    const [existingEntry] = await db
      .select({ id: monthlyScheduleEntries.id })
      .from(monthlyScheduleEntries)
      .where(
        and(
          eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
          eq(monthlyScheduleEntries.userId, userId),
          eq(monthlyScheduleEntries.date, dateStart),
        ),
      )
      .limit(1);

    if (existingEntry)
      return {
        success: false,
        error:
          "This employee already has a schedule for this day. Edit it instead.",
      };

    const finalIsOff = !!state.isOff;
    const finalIsLeave = !!state.isLeave;
    const normalisedShift =
      finalIsOff || finalIsLeave ? null : (state.shift ?? null);

    let shiftIdToUse: number | null = null;
    if (normalisedShift) {
      shiftIdToUse = await resolveActiveShiftId(normalisedShift);
      if (!shiftIdToUse)
        return {
          success: false,
          error: `Unknown or inactive shift "${normalisedShift}".`,
        };
    }

    const [newEntry] = await db
      .insert(monthlyScheduleEntries)
      .values({
        monthlyScheduleId: ms.id,
        userId,
        storeId: entryStoreId,
        date: dateStart,
        shiftId: shiftIdToUse,
        isOff: finalIsOff,
        isLeave: finalIsLeave,
      })
      .returning({ id: monthlyScheduleEntries.id });

    if (!finalIsOff && !finalIsLeave && shiftIdToUse) {
      await db.insert(schedules).values({
        userId,
        storeId: entryStoreId,
        shiftId: shiftIdToUse,
        date: dateStart,
        monthlyScheduleEntryId: newEntry.id,
        isHoliday: false,
      });
    }

    return { success: true, entryId: newEntry.id };
  } catch (err) {
    return { success: false, error: `createMonthlyScheduleEntry: ${err}` };
  }
}

export async function getMonthlySchedule(
  storeId: number,
  yearMonth: string,
): Promise<MonthlyScheduleWithEntries | null> {
  const [ms] = await db
    .select()
    .from(monthlySchedules)
    .where(
      and(
        eq(monthlySchedules.storeId, storeId),
        eq(monthlySchedules.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  if (!ms) return null;

  const rawEntries = await db
    .select({
      entry: monthlyScheduleEntries,
      user: users,
      empType: employeeTypes,
      shiftRow: shifts,
    })
    .from(monthlyScheduleEntries)
    .leftJoin(users, eq(monthlyScheduleEntries.userId, users.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .leftJoin(shifts, eq(monthlyScheduleEntries.shiftId, shifts.id))
    .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id))
    .orderBy(monthlyScheduleEntries.date, users.name);

  return {
    schedule: ms,
    entries: rawEntries.map((r) => ({
      ...r.entry,
      userName: r.user?.name ?? null,
      userEmployeeType: r.empType?.label ?? null,
      shiftCode: r.shiftRow?.code ?? null,
      shiftLabel: r.shiftRow?.label ?? null,
    })),
  };
}

export interface PersonalMonthlyScheduleEntry {
  id: number;
  date: Date;
  shiftId: number | null;
  shiftCode: string | null;
  shiftLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  isOff: boolean;
  isLeave: boolean;
  attendance: {
    status: string;
    checkInTime: Date | null;
    checkOutTime: Date | null;
    onBreak: boolean;
  } | null;
}

export interface PersonalMonthlyScheduleWithEntries {
  schedule: MonthlySchedule;
  entries: PersonalMonthlyScheduleEntry[];
}

/**
 * Same data as getMonthlySchedule(), but scoped to a single employee and
 * enriched with their attendance record per day (check-in/out, status) —
 * used by the employee-facing "My Schedule" list, as opposed to the
 * store-wide roster PIC sees.
 */
export async function getMonthlyScheduleForUser(
  storeId: number,
  yearMonth: string,
  userId: string,
): Promise<PersonalMonthlyScheduleWithEntries | null> {
  const [ms] = await db
    .select()
    .from(monthlySchedules)
    .where(
      and(
        eq(monthlySchedules.storeId, storeId),
        eq(monthlySchedules.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  if (!ms) return null;

  const rawEntries = await db
    .select({
      entry: monthlyScheduleEntries,
      shiftCode: shifts.code,
      shiftLabel: shifts.label,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
    })
    .from(monthlyScheduleEntries)
    .leftJoin(shifts, eq(monthlyScheduleEntries.shiftId, shifts.id))
    .where(
      and(
        eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
        eq(monthlyScheduleEntries.userId, userId),
      ),
    )
    .orderBy(monthlyScheduleEntries.date);

  const entryIds = rawEntries.map((r) => r.entry.id);

  const attRows = entryIds.length
    ? await db
        .select({
          entryId: schedules.monthlyScheduleEntryId,
          status: attendance.status,
          checkInTime: attendance.checkInTime,
          checkOutTime: attendance.checkOutTime,
          onBreak: attendance.onBreak,
        })
        .from(schedules)
        .innerJoin(attendance, eq(attendance.scheduleId, schedules.id))
        .where(inArray(schedules.monthlyScheduleEntryId, entryIds))
    : [];

  const attByEntryId = new Map(
    attRows
      .filter((r): r is typeof r & { entryId: number } => r.entryId != null)
      .map((r) => [r.entryId, r]),
  );

  return {
    schedule: ms,
    entries: rawEntries.map((r) => {
      const att = attByEntryId.get(r.entry.id);
      return {
        id: r.entry.id,
        date: r.entry.date,
        shiftId: r.entry.shiftId,
        shiftCode: r.shiftCode ?? null,
        shiftLabel: r.shiftLabel ?? null,
        startTime: r.startTime ?? null,
        endTime: r.endTime ?? null,
        isOff: r.entry.isOff,
        isLeave: r.entry.isLeave,
        attendance: att
          ? {
              status: att.status,
              checkInTime: att.checkInTime,
              checkOutTime: att.checkOutTime,
              onBreak: att.onBreak,
            }
          : null,
      };
    }),
  };
}

export async function listMonthlySchedules(
  storeId: number,
): Promise<MonthlySchedule[]> {
  return db
    .select()
    .from(monthlySchedules)
    .where(eq(monthlySchedules.storeId, storeId))
    .orderBy(sql`${monthlySchedules.yearMonth} DESC`);
}

// ─── Materialisation ──────────────────────────────────────────────────────────

export async function materialiseSchedulesForMonth(
  storeId: number,
  yearMonth: string,
): Promise<{ schedulesCreated: number; errors: string[] }> {
  let schedulesCreated = 0;
  const errors: string[] = [];

  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(
      and(
        eq(monthlySchedules.storeId, storeId),
        eq(monthlySchedules.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  if (!ms) return { schedulesCreated, errors: ["Monthly schedule not found"] };

  const entries = await db
    .select()
    .from(monthlyScheduleEntries)
    .where(
      and(
        eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
        eq(monthlyScheduleEntries.isOff, false),
        eq(monthlyScheduleEntries.isLeave, false),
      ),
    );

  const validShiftIds = new Set((await getShiftRows(false)).map((s) => s.id));

  for (const entry of entries) {
    if (!entry.shiftId) continue;
    if (!validShiftIds.has(entry.shiftId)) {
      errors.push(`Entry ${entry.id}: Shift ID ${entry.shiftId} not found.`);
      continue;
    }

    try {
      const [existing] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(eq(schedules.monthlyScheduleEntryId, entry.id))
        .limit(1);

      if (existing) continue;

      const [newSched] = await db
        .insert(schedules)
        .values({
          userId: entry.userId,
          storeId: entry.storeId,
          shiftId: entry.shiftId,
          date: startOfDay(entry.date),
          monthlyScheduleEntryId: entry.id,
          isHoliday: false,
        })
        .returning({ id: schedules.id });

      schedulesCreated++;

      const [existingAtt] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(
          and(
            eq(attendance.userId, entry.userId),
            eq(attendance.storeId, entry.storeId),
            eq(attendance.shiftId, entry.shiftId),
            gte(attendance.date, startOfDay(entry.date)),
            lte(attendance.date, endOfDay(entry.date)),
          ),
        )
        .limit(1);

      if (existingAtt) {
        await db
          .update(attendance)
          .set({ scheduleId: newSched.id, updatedAt: new Date() })
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
  userId: string,
  storeId: number,
  shift: Shift,
): Promise<{
  success: boolean;
  action?: "checked_in" | "returned_from_break";
  attendanceId?: number;
  scheduleId?: number;
  status?: string;
  error?: string;
}> {
  try {
    const now = new Date();
    const today = todayInStoreTimezone();
    const dayStart = startOfDay(today);
    const dayEnd = endOfDay(today);

    const shiftData = await getShiftByCode(shift, true);
    if (!shiftData)
      return { success: false, error: `Unknown or inactive shift "${shift}".` };
    if (!shiftData.startTime)
      return {
        success: false,
        error: `Shift start time is not configured in the database.`,
      };

    const [sched] = await db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.userId, userId),
          eq(schedules.storeId, storeId),
          eq(schedules.shiftId, shiftData.id),
          eq(schedules.isHoliday, false),
          gte(schedules.date, dayStart),
          lte(schedules.date, dayEnd),
        ),
      )
      .limit(1);

    if (!sched)
      return {
        success: false,
        error: "You are not scheduled for this shift today.",
      };

    const [existing] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (!existing) {
      const [hours, minutes] = shiftData.startTime.split(":").map(Number);
      const shiftStart = new Date(now);
      shiftStart.setHours(hours, minutes, 0, 0);

      const attStatus = now > shiftStart ? "late" : "present";

      // Two rapid check-in requests can both reach here after seeing no
      // `existing` row (no transaction, Neon HTTP driver). Rely on the
      // unique constraint on `scheduleId` + onConflictDoNothing instead of
      // letting the second insert throw a raw unique-violation error.
      const [att] = await db
        .insert(attendance)
        .values({
          scheduleId: sched.id,
          userId,
          storeId,
          date: sched.date,
          shiftId: shiftData.id,
          status: attStatus,
          checkInTime: now,
          onBreak: false,
          recordedBy: userId,
        })
        .onConflictDoNothing({ target: attendance.scheduleId })
        .returning({ id: attendance.id });

      if (att) {
        return {
          success: true,
          action: "checked_in",
          attendanceId: att.id,
          scheduleId: sched.id,
          status: attStatus,
        };
      }

      // Lost the race — another concurrent request already inserted the row.
      // Fall through by re-reading it below instead of erroring out.
      const [raceWinner] = await db
        .select()
        .from(attendance)
        .where(eq(attendance.scheduleId, sched.id))
        .limit(1);

      if (!raceWinner)
        return { success: false, error: "Check-in failed: could not read attendance after conflict." };

      if (raceWinner.onBreak) return endBreak(userId, storeId, raceWinner.id);

      return {
        success: true,
        action: "checked_in",
        attendanceId: raceWinner.id,
        scheduleId: sched.id,
        status: raceWinner.status,
      };
    }

    if (existing.onBreak) return endBreak(userId, storeId, existing.id);

    return {
      success: true,
      action: "checked_in",
      attendanceId: existing.id,
      scheduleId: sched.id,
      status: existing.status,
    };
  } catch (err) {
    return { success: false, error: `Check-in failed: ${err}` };
  }
}

export async function employeeCheckOut(
  userId: string,
  storeId: number,
  shift: Shift,
): Promise<{ success: boolean; error?: string }> {
  try {
    const now = new Date();
    const today = todayInStoreTimezone();

    const shiftData = await getShiftByCode(shift, true);
    if (!shiftData)
      return { success: false, error: `Unknown or inactive shift "${shift}".` };

    const [sched] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.userId, userId),
          eq(schedules.storeId, storeId),
          eq(schedules.shiftId, shiftData.id),
          eq(schedules.isHoliday, false),
          gte(schedules.date, startOfDay(today)),
          lte(schedules.date, endOfDay(today)),
        ),
      )
      .limit(1);

    if (!sched)
      return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);
    if (!att) return { success: false, error: "No check-in record found." };
    if (att.checkOutTime)
      return { success: false, error: "Already checked out." };
    if (att.onBreak)
      return {
        success: false,
        error: "Currently on break. Please return first.",
      };

    await db
      .update(attendance)
      .set({ checkOutTime: now, updatedAt: new Date() })
      .where(eq(attendance.id, att.id));
    return { success: true };
  } catch (err) {
    return { success: false, error: `Check-out failed: ${err}` };
  }
}

// ─── Auto checkout (overdue attendance) ─────────────────────────────────────
//
// Employees who forget to check out get closed out automatically once their
// shift has been over for AUTO_CHECKOUT_GRACE_MINUTES. Runs lazily (called
// from the employee + ops attendance GET routes, scoped to what's being
// viewed) and from a daily cron (app/api/cron/auto-checkout) as a system-wide
// safety net — same pattern as autoRevertExpiredTransfers above.

const AUTO_CHECKOUT_GRACE_MINUTES = 30;
/** Bounds the scan so it never has to walk the whole attendance table. */
const AUTO_CHECKOUT_LOOKBACK_DAYS = 3;

/** Combines a day (from `schedules`/`attendance`.date) with a "HH:MM:SS"
 *  wall-clock time, same local-time convention employeeCheckIn already uses
 *  for its "late" cutoff (`shiftStart.setHours(...)`). */
function dateWithTime(day: Date, time: string): Date {
  const [h, m, s] = time.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, s || 0, 0);
  return d;
}

export interface AutoCheckoutFilter {
  userId?: string;
  storeIds?: number[];
}

/**
 * Finds still-open attendance rows (checked in, never checked out) whose
 * shift ended more than AUTO_CHECKOUT_GRACE_MINUTES ago and closes them out:
 * checkOutTime is set to the shift's scheduled end time (not "now" — that's
 * when the system happened to notice, not when the shift actually ended),
 * any dangling open break is ended at the same moment, and a note is
 * appended so it's clear on the ops side this wasn't a manual check-out.
 */
export async function autoCheckoutOverdueAttendance(
  filter: AutoCheckoutFilter = {},
): Promise<{ checkedOut: number }> {
  const now = new Date();
  const lookbackStart = startOfDay(now);
  lookbackStart.setDate(lookbackStart.getDate() - AUTO_CHECKOUT_LOOKBACK_DAYS);

  const conditions = [
    isNotNull(attendance.checkInTime),
    isNull(attendance.checkOutTime),
    gte(attendance.date, lookbackStart),
  ];
  if (filter.userId) conditions.push(eq(attendance.userId, filter.userId));
  if (filter.storeIds?.length) conditions.push(inArray(attendance.storeId, filter.storeIds));

  const rows = await db
    .select({
      id: attendance.id,
      date: attendance.date,
      onBreak: attendance.onBreak,
      notes: attendance.notes,
      endTime: shifts.endTime,
    })
    .from(attendance)
    .innerJoin(shifts, eq(attendance.shiftId, shifts.id))
    .where(and(...conditions));

  let checkedOut = 0;

  for (const row of rows) {
    if (!row.endTime) continue;

    const shiftEnd = dateWithTime(row.date, row.endTime);
    const deadline = new Date(shiftEnd.getTime() + AUTO_CHECKOUT_GRACE_MINUTES * 60_000);
    if (now < deadline) continue;

    if (row.onBreak) {
      const [openBreak] = await db
        .select({ id: breakSessions.id })
        .from(breakSessions)
        .where(and(eq(breakSessions.attendanceId, row.id), isNull(breakSessions.returnTime)))
        .limit(1);

      if (openBreak) {
        await db
          .update(breakSessions)
          .set({ returnTime: shiftEnd, updatedAt: new Date() })
          .where(eq(breakSessions.id, openBreak.id));
      }
    }

    const note = "Auto checked-out by system (no manual check-out after shift end).";
    await db
      .update(attendance)
      .set({
        checkOutTime: shiftEnd,
        onBreak: false,
        notes: row.notes ? `${row.notes} ${note}` : note,
        updatedAt: new Date(),
      })
      .where(eq(attendance.id, row.id));

    checkedOut++;
  }

  return { checkedOut };
}

// ─── Auto-mark-absent (whole-day no-shows) ──────────────────────────────────
//
// If a schedule's day has fully passed with no attendance record at all —
// the employee never checked in and nobody marked them manually — the
// system marks them absent and notifies that employee directly (not OPS),
// since they're the one who needs to know they missed a check-in. Runs
// lazily (ops attendance GET routes, scoped to what's being viewed) and
// from a daily cron (app/api/cron/auto-absent) as a system-wide safety net
// — same pattern as autoCheckoutOverdueAttendance above. The notification
// created here is cleared automatically once an ops user records the
// employee's real attendance status (see opsMarkAttendance).

const AUTO_ABSENT_LOOKBACK_DAYS = 7;

export interface AutoAbsentFilter {
  storeIds?: number[];
}

export async function autoMarkAbsentPastSchedules(
  filter: AutoAbsentFilter = {},
): Promise<{ marked: number }> {
  const todayStart = startOfDay(todayInStoreTimezone());
  const lookbackStart = new Date(todayStart);
  lookbackStart.setDate(lookbackStart.getDate() - AUTO_ABSENT_LOOKBACK_DAYS);

  const conditions = [
    eq(schedules.isHoliday, false),
    gte(schedules.date, lookbackStart),
    lt(schedules.date, todayStart),
    isNull(attendance.id),
  ];
  if (filter.storeIds?.length) conditions.push(inArray(schedules.storeId, filter.storeIds));

  const rows = await db
    .select({
      scheduleId: schedules.id,
      userId:     schedules.userId,
      storeId:    schedules.storeId,
      shiftId:    schedules.shiftId,
      date:       schedules.date,
    })
    .from(schedules)
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(and(...conditions));

  let marked = 0;

  for (const row of rows) {
    try {
      await db.insert(attendance).values({
        scheduleId: row.scheduleId,
        userId:     row.userId,
        storeId:    row.storeId,
        date:       row.date,
        shiftId:    row.shiftId,
        status:     "absent",
        onBreak:    false,
        notes:      "Auto-marked absent — no attendance recorded for this shift.",
      });
    } catch {
      // Unique constraint on scheduleId — another run already handled this
      // row (lazy view + cron racing). Safe to skip.
      continue;
    }

    marked++;

    const dateLabel = row.date.toLocaleDateString("en-ID", { day: "numeric", month: "short" });
    await createNotification({
      userId: row.userId,
      type:   "attendance_auto_absent",
      title:  "Marked absent — you didn't check in",
      body:   `No attendance was recorded for your shift on ${dateLabel}, so you were marked absent. Contact your OPS/PIC if this is wrong.`,
      link:   "/employee/attendance",
      relatedType: "schedule",
      relatedId:   row.scheduleId,
    });
  }

  return { marked };
}

export async function startBreak(
  userId: string,
  storeId: number,
  shift: Shift,
  breakType: BreakType,
  cashOut: number,
): Promise<{
  success: boolean;
  breakSessionId?: number;
  breakType?: BreakType;
  error?: string;
}> {
  try {
    if (cashOut == null || Number.isNaN(cashOut) || cashOut < 0) {
      return {
        success: false,
        error:
          "Cash amount taken out is required and must be a non-negative number.",
      };
    }

    if (!isValidBreakType(breakType)) {
      return {
        success: false,
        error: `Invalid break type "${String(breakType)}".`,
      };
    }

    const now = new Date();
    const today = todayInStoreTimezone();
    const shiftData = await getShiftByCode(shift, true);
    if (!shiftData)
      return { success: false, error: `Unknown or inactive shift "${shift}".` };

    const cfg = getLegacyBreakConfig(shiftData.code);
    if (!(cfg.breakTypes as readonly string[]).includes(breakType)) {
      return {
        success: false,
        error: `Break type "${breakType}" is not valid for a ${shift} shift. Valid: ${cfg.breakTypes.join(", ")}.`,
      };
    }

    const [sched] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.userId, userId),
          eq(schedules.storeId, storeId),
          eq(schedules.shiftId, shiftData.id),
          eq(schedules.isHoliday, false),
          gte(schedules.date, startOfDay(today)),
          lte(schedules.date, endOfDay(today)),
        ),
      )
      .limit(1);

    if (!sched)
      return { success: false, error: `No ${shift} schedule found for today.` };

    const [att] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);
    if (!att || !att.checkInTime)
      return { success: false, error: "Not checked in yet." };
    if (att.checkOutTime)
      return { success: false, error: "Already checked out." };
    if (att.onBreak) return { success: false, error: "Already on break." };

    const priorBreaks = await db
      .select()
      .from(breakSessions)
      .where(eq(breakSessions.attendanceId, att.id));

    if (priorBreaks.length >= cfg.maxBreaks) {
      return {
        success: false,
        error: `Already used all ${cfg.maxBreaks} break(s) for this ${shift} shift.`,
      };
    }

    if (priorBreaks.some((b) => b.breakType === breakType)) {
      return {
        success: false,
        error: `Already used the "${breakType}" break for this shift.`,
      };
    }

    const [session] = await db
      .insert(breakSessions)
      .values({
        attendanceId: att.id,
        userId,
        storeId,
        breakType,
        breakOutTime: now,
        cashOut: cashOut.toString(),
      })
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
  userId: string,
  storeId: number,
  attendanceId: number,
  cashIn: number = 0,
): Promise<{
  success: boolean;
  action?: "returned_from_break";
  attendanceId?: number;
  scheduleId?: number;
  status?: string;
  error?: string;
}> {
  try {
    if (cashIn == null || Number.isNaN(cashIn) || cashIn < 0) {
      return {
        success: false,
        error:
          "Cash amount brought back is required and must be a non-negative number.",
      };
    }

    const now = new Date();

    const [openBreak] = await db
      .select()
      .from(breakSessions)
      .where(
        and(
          eq(breakSessions.attendanceId, attendanceId),
          eq(breakSessions.userId, userId),
          isNull(breakSessions.returnTime),
        ),
      )
      .limit(1);

    if (!openBreak)
      return { success: false, error: "No active break session found." };

    await db
      .update(breakSessions)
      .set({
        returnTime: now,
        cashIn: cashIn.toString(),
        updatedAt: new Date(),
      })
      .where(eq(breakSessions.id, openBreak.id));

    const [updatedAtt] = await db
      .update(attendance)
      .set({ onBreak: false, updatedAt: new Date() })
      .where(eq(attendance.id, attendanceId))
      .returning({
        id: attendance.id,
        scheduleId: attendance.scheduleId,
        status: attendance.status,
      });

    return {
      success: true,
      action: "returned_from_break",
      attendanceId: updatedAtt.id,
      scheduleId: updatedAtt.scheduleId,
      status: updatedAtt.status,
    };
  } catch (err) {
    return { success: false, error: `endBreak failed: ${err}` };
  }
}

export async function getTodayAttendance(userId: string, storeId: number) {
  const today = todayInStoreTimezone();
  const rows = await db
    .select({ att: attendance, schedule: schedules })
    .from(attendance)
    .leftJoin(schedules, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(attendance.userId, userId),
        eq(attendance.storeId, storeId),
        gte(attendance.date, startOfDay(today)),
        lte(attendance.date, endOfDay(today)),
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
    .select({ schedule: schedules, user: users, attendance })
    .from(schedules)
    .leftJoin(users, eq(schedules.userId, users.id))
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(schedules.storeId, storeId),
        eq(schedules.isHoliday, false),
        gte(schedules.date, startOfDay(date)),
        lte(schedules.date, endOfDay(date)),
      ),
    )
    .orderBy(schedules.shiftId, users.name);
}

export async function opsMarkAttendance(
  scheduleId: number,
  status: "present" | "absent" | "late" | "excused",
  actorId: string,
  notes?: string,
): Promise<{ success: boolean; attendanceId?: number; error?: string }> {
  try {
    const [sched] = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);
    if (!sched) return { success: false, error: "Schedule not found." };

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
          userId: sched.userId,
          storeId: sched.storeId,
          date: sched.date,
          shiftId: sched.shiftId,
          status,
          onBreak: false,
          notes,
          recordedBy: actorId,
        })
        .returning({ id: attendance.id });

      attendanceId = att.id;
    }

    // The employee's real status is now on record — clear any "auto-marked
    // absent" notification this schedule may have generated.
    await deleteNotificationsByRelated("schedule", scheduleId);

    return { success: true, attendanceId };
  } catch (err) {
    return { success: false, error: `opsMarkAttendance: ${err}` };
  }
}

export async function resolveNextScheduleForStore(
  storeId: number,
  afterDate: Date,
): Promise<NextScheduleResult | null> {
  const shiftMap = await getShiftIdMap(false);
  const morningShiftId = shiftMap.morning;
  const fullDayShiftId = shiftMap.full_day;

  const eligibleShiftIds = [morningShiftId, fullDayShiftId].filter(
    (id): id is number => Boolean(id),
  );
  if (eligibleShiftIds.length === 0) return null;

  const dayAfter = startOfDay(new Date(afterDate));
  dayAfter.setDate(dayAfter.getDate() + 1);

  const [next] = await db
    .select({
      id: schedules.id,
      userId: schedules.userId,
      date: schedules.date,
    })
    .from(schedules)
    .where(
      and(
        eq(schedules.storeId, storeId),
        eq(schedules.isHoliday, false),
        gte(schedules.date, dayAfter),
        inArray(schedules.shiftId, eligibleShiftIds),
      ),
    )
    .orderBy(schedules.date)
    .limit(1);

  if (!next) return null;

  return {
    scheduleId: next.id,
    userId: next.userId,
    date: next.date,
  };
}

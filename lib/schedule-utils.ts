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
import { DINAS_SHIFT_CODE, baseShiftCode, isOpeningShift } from "@/lib/shift-tasks";
import {
  STORE_TIME_ZONE,
  jakartaDateKey,
  jakartaDayRange,
  jakartaDayStart,
  jakartaTodayKey,
  jakartaYearMonth,
} from "@/lib/day-bucket";
import {
  isLeaveAttendanceStatus,
  type LeaveAttendanceStatus,
} from "@/lib/attendance-status";
import { isFeatureEnabled } from "@/lib/db/utils/feature-switches";
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
  cekBinTasks,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  itemReturnTasks,
  briefingTasks,
  groomingTasks,
  notifications,
  type Area,
  type MonthlySchedule,
  type MonthlyScheduleEntry,
} from "@/lib/db/schema";
import {
  and,
  eq,
  getTableName,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  sql,
  TransactionRollbackError,
} from "drizzle-orm";
import { createNotification, deleteNotificationsByRelated } from "@/lib/db/utils/notifications";
import { assertStoreOperational } from "@/lib/db/utils/store-status";
import { collectScheduleImageUrls, deleteManagedImages } from "@/lib/db/utils/task-image-cleanup";

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
  /**
   * PIC-initiated imports: reject, instead of replacing, when the month already
   * has an entry without attendance. PIC may only fill a month that is empty or
   * whose remaining entries are all attendance history (e.g. what Ops' "Delete
   * schedule → keep attendance history" leaves) — anything else, Ops deletes first.
   */
  blockIfUnattended?: boolean;
}

export interface MonthlyScheduleWithEntries {
  schedule: MonthlySchedule;
  entries: (MonthlyScheduleEntry & {
    userName: string | null;
    userEmployeeType: string | null;
    shiftCode: string | null;
    shiftLabel: string | null;
    /** Attendance is recorded for this employee-day — import and "keep history" delete leave it alone. */
    hasAttendance: boolean;
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
//
// Day buckets are Jakarta calendar days (see lib/day-bucket.ts for the two
// encodings the DB holds). These used to be the server's local midnight,
// which is the same instant on the Jakarta-time server the app runs on — now
// they say so explicitly, so a UTC host (or a seed/probe script) gets the
// same day instead of drifting seven hours.

/** Start of the Jakarta day `d` falls on (= the app's day-bucket instant). */
export function startOfDay(d: Date): Date {
  return jakartaDayStart(jakartaDateKey(d));
}

/** Last millisecond of the Jakarta day `d` falls on. */
export function endOfDay(d: Date): Date {
  return new Date(jakartaDayRange(jakartaDateKey(d)).end.getTime() - 1);
}

/**
 * Today's day bucket in the store's timezone. Deriving "today" from a bare
 * `new Date()` is wrong on any server not running in Jakarta time: from
 * Jakarta midnight to 06:59 a UTC clock is still on "yesterday".
 *
 * Use this wherever "today" is the anchor for querying schedules/attendance/
 * task rows; keep using bare `new Date()` for genuine timestamps (e.g.
 * `checkInTime`) that should record the real instant, not a day bucket.
 */
export function todayInStoreTimezone(): Date {
  return jakartaDayStart(jakartaTodayKey());
}

export function yearMonthToDate(ym: string): Date {
  return jakartaDayStart(`${ym}-01`);
}

export function dateToYearMonth(d: Date): string {
  return jakartaYearMonth(d);
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

// ─── Dinas shift ──────────────────────────────────────────────────────────────
// A day scheduled as Dinas (working outside any store) is not a normal shift:
// it has no tasks and nobody checks in, so its attendance is recorded as
// "dinas" the moment it is scheduled. That row is bookkeeping, not evidence of
// attendance — it must never lock the day against schedule edits / re-imports,
// and it goes away with the schedule row. Any other attendance row (e.g. Ops
// re-marked it, or someone really checked in) still locks the day as before.

const DINAS_AUTO_NOTE = "Dinas — dijadwalkan di jadwal bulanan (tugas di luar toko).";

/** Id of the Dinas shift row; null if it hasn't been created yet. */
async function getDinasShiftId(): Promise<number | null> {
  return (await getShiftIdMap(false))[DINAS_SHIFT_CODE] ?? null;
}

/** Record "dinas" attendance for freshly scheduled Dinas days (idempotent). */
async function recordDinasAttendance(
  rows: { scheduleId: number; userId: string; storeId: number; shiftId: number; date: Date }[],
): Promise<void> {
  if (!rows.length) return;
  await db
    .insert(attendance)
    .values(
      rows.map((r) => ({
        scheduleId: r.scheduleId,
        userId: r.userId,
        storeId: r.storeId,
        date: r.date,
        shiftId: r.shiftId,
        status: "dinas" as const,
        onBreak: false,
        notes: DINAS_AUTO_NOTE,
      })),
    )
    .onConflictDoNothing({ target: attendance.scheduleId });
}

// The handle a db.transaction() callback gets; `Reader` is satisfied by it and by `db`.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/** Of these schedules, the ones with attendance that locks the day (everything but the automatic Dinas row). */
async function lockedByAttendance(scheduleIds: number[], dbx: Reader = db): Promise<Set<number>> {
  const locked = new Set<number>();
  if (!scheduleIds.length) return locked;
  const dinasShiftId = await getDinasShiftId();
  const rows = await dbx
    .select({
      scheduleId: attendance.scheduleId,
      status: attendance.status,
      shiftId: attendance.shiftId,
    })
    .from(attendance)
    .where(inArray(attendance.scheduleId, scheduleIds));
  for (const r of rows) {
    const isAutoDinas = r.status === "dinas" && dinasShiftId !== null && r.shiftId === dinasShiftId;
    if (!isAutoDinas) locked.add(r.scheduleId);
  }
  return locked;
}

/**
 * The working days (schedules) behind these monthly entries, and which entries
 * attendance locks — the employee-days whose history is recorded. Import, the
 * month delete and the schedule views all draw the line here.
 */
async function entryLocks(entryIds: number[], dbx: Reader = db) {
  const daySchedules = entryIds.length
    ? await dbx
        .select({ id: schedules.id, entryId: schedules.monthlyScheduleEntryId })
        .from(schedules)
        .where(inArray(schedules.monthlyScheduleEntryId, entryIds))
    : [];
  const lockedScheduleIds = await lockedByAttendance(daySchedules.map((s) => s.id), dbx);
  const lockedEntryIds = new Set<number>();
  for (const s of daySchedules) {
    if (s.entryId != null && lockedScheduleIds.has(s.id)) lockedEntryIds.add(s.entryId);
  }
  return { daySchedules, lockedScheduleIds, lockedEntryIds };
}

function getLegacyBreakConfig(shiftCode: string): {
  breakTypes: BreakType[];
  maxBreaks: number;
} {
  const base = baseShiftCode(shiftCode);
  if (base === "morning") return SHIFT_CONFIG.morning;
  if (base === "evening") return SHIFT_CONFIG.evening;
  if (base === "full_day") return SHIFT_CONFIG.full_day;

  // Custom shifts are dynamic. The API should send an allowed break type based
  // on shifts.breaks. The util keeps a safe default so direct callers still work.
  return {
    breakTypes: [...VALID_BREAK_TYPES],
    maxBreaks: 1,
  };
}

// ─── Removing working days ────────────────────────────────────────────────────
// Every path that drops `schedules` rows — a re-import, a day edit, "Delete
// schedule" — goes through removeSchedulesWithin(), so a removed day is treated
// the same way everywhere:
//   • its own task progress goes (opening, store front, cek bin, VM, marketing,
//     item receiving / return, briefing, grooming), photos included;
//   • the money records Finance reviews never go with it — setoran (+ ledger),
//     cek uang modal, store closing and cash counts stay where Finance reads
//     them (by store + date), only unlinked from the day;
//   • every other pointer at the day is unlinked as well (completed-by columns,
//     the serah terima board) — a removed day never takes others' work along;
//   • attendance: only the automatic Dinas row — unless `wipeAttendance` (Ops
//     "delete everything"), then every record of the day, breaks included. Any
//     other attendance row makes the final delete fail, so a checked-in day can
//     never be dropped by accident.

/** A working day's own task rows — deleted with it. */
const DAY_TASK_TABLES = [
  storeOpeningTasks,
  storeFrontTasks,
  cekBinTasks,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  itemReturnTasks,
  briefingTasks,
  groomingTasks,
] as const;

const DAY_TASK_TABLE_NAMES: string[] = DAY_TASK_TABLES.map((t) => getTableName(t));

/** Unlinked, never deleted, when their day goes — Finance reviews these. */
const FINANCE_RECORD_LABELS: Record<string, string> = {
  setoran_tasks: "setoran",
  cek_uang_modal_tasks: "cek uang modal",
  store_closing_tasks: "store closing (Z-report / EDC)",
  store_cash_counts: "cash counts",
};

interface ScheduleRemoval {
  /** Rows deleted, per table. */
  removed: Map<string, number>;
  /** Finance records unlinked from the removed days, per table. */
  keptFinance: Map<string, number>;
  /** Photos of the deleted task rows — remove from storage once committed. */
  photoUrls: string[];
}

function extractRows<T>(result: unknown): T[] {
  const withRows = result as { rows?: unknown[] };
  return Array.isArray(withRows.rows) ? (withRows.rows as T[]) : (result as unknown as T[]);
}

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, '""')}"`);

/** Every nullable single-column FK pointing at schedules.id. */
async function loadNullableScheduleRefs(tx: Tx): Promise<{ table: string; column: string }[]> {
  const result = await tx.execute(sql`
    SELECT src.relname AS "table", col.attname AS "column"
    FROM pg_constraint con
    JOIN pg_class src     ON src.oid = con.conrelid
    JOIN pg_namespace ns  ON ns.oid = src.relnamespace
    JOIN pg_attribute col ON col.attrelid = con.conrelid AND col.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND array_length(con.conkey, 1) = 1
      AND con.confrelid = 'public.schedules'::regclass
      AND NOT col.attnotnull
  `);
  return extractRows<{ table: string; column: string }>(result);
}

async function removeSchedulesWithin(
  tx: Tx,
  scheduleIds: number[],
  opts: { wipeAttendance: boolean },
): Promise<ScheduleRemoval> {
  const ids = [...new Set(scheduleIds)];
  const out: ScheduleRemoval = { removed: new Map(), keptFinance: new Map(), photoUrls: [] };
  if (ids.length === 0) return out;

  const tally = (counts: Map<string, number>, table: string, n: number) => {
    if (n > 0) counts.set(table, (counts.get(table) ?? 0) + n);
  };
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);

  // Photos are read before the rows holding them go.
  out.photoUrls = await collectScheduleImageUrls(tx, ids, DAY_TASK_TABLE_NAMES);

  for (const table of DAY_TASK_TABLES) {
    const rows = await tx
      .delete(table)
      .where(inArray(table.scheduleId, ids))
      .returning({ id: table.id });
    tally(out.removed, getTableName(table), rows.length);
  }

  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of await loadNullableScheduleRefs(tx)) {
    columnsByTable.set(table, [...(columnsByTable.get(table) ?? []), column]);
  }
  for (const [table, columns] of columnsByTable) {
    if (FINANCE_RECORD_LABELS[table]) {
      const linked = sql.join(columns.map((c) => sql`${ident(c)} IN (${idList})`), sql` OR `);
      const [row] = extractRows<{ n: number }>(
        await tx.execute(sql`SELECT count(*)::int AS "n" FROM ${ident(table)} WHERE ${linked}`),
      );
      tally(out.keptFinance, table, Number(row?.n ?? 0));
    }
    for (const column of columns) {
      await tx.execute(
        sql`UPDATE ${ident(table)} SET ${ident(column)} = NULL WHERE ${ident(column)} IN (${idList})`,
      );
    }
  }

  const dinasShiftId = await getDinasShiftId();
  if (opts.wipeAttendance) {
    // Break sessions cascade with their attendance row — counted first.
    const [breaks] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(breakSessions)
      .innerJoin(attendance, eq(attendance.id, breakSessions.attendanceId))
      .where(inArray(attendance.scheduleId, ids));
    tally(out.removed, "break_sessions", Number(breaks?.n ?? 0));
    const att = await tx
      .delete(attendance)
      .where(inArray(attendance.scheduleId, ids))
      .returning({ status: attendance.status, shiftId: attendance.shiftId });
    // The automatic Dinas row is bookkeeping, not history — not counted (the
    // other paths drop it silently too).
    tally(
      out.removed,
      "attendance",
      att.filter((a) => !(a.status === "dinas" && a.shiftId === dinasShiftId)).length,
    );
  } else {
    if (dinasShiftId !== null) {
      await tx
        .delete(attendance)
        .where(
          and(
            inArray(attendance.scheduleId, ids),
            eq(attendance.status, "dinas"),
            eq(attendance.shiftId, dinasShiftId),
          ),
        );
    }
  }

  // e.g. "Marked absent — you didn't check in" for a day that no longer exists.
  const inbox = await tx
    .delete(notifications)
    .where(and(eq(notifications.relatedType, "schedule"), inArray(notifications.relatedId, ids)))
    .returning({ id: notifications.id });
  tally(out.removed, "notifications", inbox.length);

  const days = await tx
    .delete(schedules)
    .where(inArray(schedules.id, ids))
    .returning({ id: schedules.id });
  tally(out.removed, "schedules", days.length);

  return out;
}

/** Best effort, after commit — a storage failure never undoes the delete. */
async function deleteTaskPhotos(urls: string[], context: string): Promise<void> {
  if (urls.length === 0) return;
  try {
    await deleteManagedImages(urls);
  } catch (err) {
    console.error(`[schedule-utils] ${context}: ${urls.length} task photos could not be removed from storage:`, err);
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
      isActive: users.isActive,
      roleCode: userRoles.code,
      employeeTypeCode: employeeTypes.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .where(eq(users.id, opsUserId))
    .limit(1);

  if (!opsUser || !opsUser.isActive) return [];

  // OPS/IT only. Without this an ordinary employee — every employee carries an
  // areaId — fell through to the area branch below and could read the attendance /
  // schedule exports for every store in their area.
  if (opsUser.roleCode !== "it" && opsUser.roleCode !== "ops") return [];

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
   * Incoming entries that were dropped instead of applied because attendance
   * is already recorded for that employee-day.
   */
  skippedProtected?: number;
}> {
  try {
    const auth = await canManageSchedule(data.importedBy, data.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };
    if (!data.entries.length)
      return { success: false, error: "No entries provided." };

    // A re-import never rewrites history: an employee-day that already has
    // attendance (checked in, marked absent, Cuti/Sakit… — anything but the
    // automatic Dinas row) keeps its entry, and the file's cell for it is
    // skipped. Every other day, past or future, is replaced by the file. Keyed
    // by userId + Jakarta day so DB rows (either day-bucket encoding) and
    // parsed rows match.
    const dayKey = (userId: string, date: Date) => `${userId}|${jakartaDateKey(date)}`;
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

      const current = await db
        .select({
          id: monthlyScheduleEntries.id,
          userId: monthlyScheduleEntries.userId,
          date: monthlyScheduleEntries.date,
        })
        .from(monthlyScheduleEntries)
        .where(eq(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleId));

      const { daySchedules, lockedScheduleIds, lockedEntryIds } = await entryLocks(
        current.map((e) => e.id),
      );

      // Checked before anything is touched.
      const open = current.filter((e) => !lockedEntryIds.has(e.id)).length;
      if (data.blockIfUnattended && open > 0) {
        return {
          success: false,
          error:
            `The ${data.yearMonth} schedule still has ${open} day${open !== 1 ? "s" : ""} without attendance. ` +
            "Ask Ops to delete it (keeping attendance history) before re-uploading.",
        };
      }

      for (const e of current) {
        if (lockedEntryIds.has(e.id)) protectedDayKeys.add(dayKey(e.userId, e.date));
      }

      const replacedSchedIds = daySchedules
        .filter((s) => !lockedScheduleIds.has(s.id))
        .map((s) => s.id);
      const replacedEntryIds = current
        .filter((e) => !lockedEntryIds.has(e.id))
        .map((e) => e.id);

      const { photoUrls } = await db.transaction(async (tx) => {
        const removal = await removeSchedulesWithin(tx, replacedSchedIds, { wipeAttendance: false });
        if (replacedEntryIds.length > 0)
          await tx
            .delete(monthlyScheduleEntries)
            .where(inArray(monthlyScheduleEntries.id, replacedEntryIds));
        return removal;
      });
      await deleteTaskPhotos(photoUrls, `re-import ${data.yearMonth} for store ${data.storeId}`);

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

    // Drop any incoming row that targets a day with attendance. For a
    // brand-new schedule nothing is locked, so this is a no-op.
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
      if ((await lockedByAttendance([sched.id])).size > 0)
        return {
          success: false,
          error: "Cannot edit a day that already has an attendance record.",
        };

      const { photoUrls } = await db.transaction((tx) =>
        removeSchedulesWithin(tx, [sched.id], { wipeAttendance: false }),
      );
      await deleteTaskPhotos(photoUrls, `edit schedule entry ${entryId}`);
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

      if (shiftIdToUse === (await getDinasShiftId())) {
        await recordDinasAttendance([{
          scheduleId: newSched.id,
          userId: entry.userId,
          storeId: entry.storeId,
          shiftId: shiftIdToUse,
          date: startOfDay(entry.date),
        }]);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `updateMonthlyScheduleEntry: ${err}` };
  }
}

// ─── Delete a month ───────────────────────────────────────────────────────────
// Ops picks one of two options (components/ops/schedules/ScheduleDeleteDialog):
//   • keep_history — every employee-day without attendance goes; days with
//     attendance stay, with their tasks, so the month stays when any is left.
//     What remains is exactly what a PIC re-import may build on.
//   • all — every employee-day goes, attendance and task progress included
//     (Ops types the store code to confirm). Finance's money records stay,
//     unlinked (see removeSchedulesWithin). Off unless IT turns on the
//     `schedule_delete_all` switch (/it/feature-switches).
// One transaction either way; the preview runs the same steps and rolls back.

export type ScheduleDeleteMode = "keep_history" | "all";

export const SCHEDULE_DELETE_ALL_OFF_ERROR =
  'Deleting everything is turned off. Use "Keep attendance history", or ask IT to turn it on in Feature Switches.';

export interface ScheduleRecordCount {
  table: string;
  label: string;
  count: number;
}

export interface MonthlyScheduleDeletionSummary {
  mode: ScheduleDeleteMode;
  /** Employee-days (shifts, days off, leave) removed. */
  removedDays: number;
  /** Employee-days kept because attendance is recorded on them (keep_history). */
  keptDays: number;
  /** Nothing is left, so the month itself is gone too. */
  monthRemoved: boolean;
  /** History removed with the days, biggest first: attendance, breaks, task progress, notifications. */
  removed: ScheduleRecordCount[];
  /** Money records Finance reviews that stay, unlinked from the removed days. */
  keptFinance: ScheduleRecordCount[];
  /** Task photos removed from storage. */
  photos: number;
}

export interface MonthlyScheduleDeletionPreview {
  keep_history: MonthlyScheduleDeletionSummary;
  /** Null while IT has "Delete everything" switched off. */
  all: MonthlyScheduleDeletionSummary | null;
}

const HISTORY_LABELS: Record<string, string> = {
  attendance: "attendance records",
  break_sessions: "break records",
  notifications: "notifications",
};

function summariseDeletion(
  mode: ScheduleDeleteMode,
  removedDays: number,
  keptDays: number,
  removal: ScheduleRemoval,
): MonthlyScheduleDeletionSummary {
  const removed: ScheduleRecordCount[] = [];
  let taskRows = 0;
  for (const [table, count] of removal.removed) {
    if (DAY_TASK_TABLE_NAMES.includes(table)) taskRows += count;
    else if (HISTORY_LABELS[table]) removed.push({ table, label: HISTORY_LABELS[table], count });
  }
  if (taskRows > 0) removed.push({ table: "tasks", label: "task progress records", count: taskRows });
  removed.sort((a, b) => b.count - a.count);

  return {
    mode,
    removedDays,
    keptDays,
    monthRemoved: keptDays === 0,
    removed,
    keptFinance: [...removal.keptFinance].map(([table, count]) => ({
      table,
      label: FINANCE_RECORD_LABELS[table] ?? table,
      count,
    })),
    photos: removal.photoUrls.length,
  };
}

async function deleteMonthWithin(tx: Tx, monthlyScheduleId: number, mode: ScheduleDeleteMode) {
  const entries = await tx
    .select({ id: monthlyScheduleEntries.id })
    .from(monthlyScheduleEntries)
    .where(eq(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleId));
  const entryIds = entries.map((e) => e.id);

  const { daySchedules, lockedScheduleIds, lockedEntryIds } = await entryLocks(entryIds, tx);
  const keepHistory = mode === "keep_history";
  const removedSchedIds = daySchedules
    .filter((s) => !(keepHistory && lockedScheduleIds.has(s.id)))
    .map((s) => s.id);
  const removedEntryIds = entryIds.filter((id) => !(keepHistory && lockedEntryIds.has(id)));

  const removal = await removeSchedulesWithin(tx, removedSchedIds, { wipeAttendance: !keepHistory });
  if (removedEntryIds.length > 0)
    await tx.delete(monthlyScheduleEntries).where(inArray(monthlyScheduleEntries.id, removedEntryIds));

  const keptDays = entryIds.length - removedEntryIds.length;
  if (keptDays === 0) await tx.delete(monthlySchedules).where(eq(monthlySchedules.id, monthlyScheduleId));

  return {
    summary: summariseDeletion(mode, removedEntryIds.length, keptDays, removal),
    photoUrls: removal.photoUrls,
  };
}

async function findMonthlyScheduleId(storeId: number, yearMonth: string): Promise<number | null> {
  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
    .limit(1);
  return ms?.id ?? null;
}

/** What each delete option would do — the real steps, rolled back. */
export async function previewMonthlyScheduleDeletion(
  storeId: number,
  yearMonth: string,
  actorId: string,
): Promise<{ success: true; data: MonthlyScheduleDeletionPreview } | { success: false; error: string }> {
  try {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) return { success: false, error: auth.reason ?? "Not allowed." };

    const monthlyScheduleId = await findMonthlyScheduleId(storeId, yearMonth);
    if (monthlyScheduleId === null) return { success: false, error: "Monthly schedule not found." };

    const dryRun = async (mode: ScheduleDeleteMode) => {
      const box: { summary?: MonthlyScheduleDeletionSummary } = {};
      try {
        await db.transaction(async (tx) => {
          box.summary = (await deleteMonthWithin(tx, monthlyScheduleId, mode)).summary;
          tx.rollback();
        });
      } catch (err) {
        if (!(err instanceof TransactionRollbackError)) throw err;
      }
      if (!box.summary) throw new Error(`dry run (${mode}) returned nothing`);
      return box.summary;
    };

    const allEnabled = await isFeatureEnabled("schedule_delete_all");
    return {
      success: true,
      data: {
        keep_history: await dryRun("keep_history"),
        all: allEnabled ? await dryRun("all") : null,
      },
    };
  } catch (err) {
    return { success: false, error: `previewMonthlyScheduleDeletion: ${err}` };
  }
}

export async function deleteMonthlySchedule(
  storeId: number,
  yearMonth: string,
  actorId: string,
  options: {
    mode?: ScheduleDeleteMode;
    /** Required for mode "all": the store code, typed by Ops. */
    confirmStoreNo?: string;
  } = {},
): Promise<{
  success: boolean;
  /** Employee-days kept because attendance is recorded on them. */
  lockedCount?: number;
  summary?: MonthlyScheduleDeletionSummary;
  error?: string;
}> {
  const mode = options.mode ?? "keep_history";
  try {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    if (mode === "all") {
      if (!(await isFeatureEnabled("schedule_delete_all"))) {
        return { success: false, error: SCHEDULE_DELETE_ALL_OFF_ERROR };
      }
      const [store] = await db
        .select({ storeNo: stores.storeNo })
        .from(stores)
        .where(eq(stores.id, storeId))
        .limit(1);
      if (!store) return { success: false, error: "Store not found." };
      if ((options.confirmStoreNo ?? "").trim().toUpperCase() !== store.storeNo.toUpperCase()) {
        return { success: false, error: `Type the store code (${store.storeNo}) to delete everything.` };
      }
    }

    const monthlyScheduleId = await findMonthlyScheduleId(storeId, yearMonth);
    if (monthlyScheduleId === null) return { success: false, error: "Monthly schedule not found." };

    const out = await db.transaction((tx) => deleteMonthWithin(tx, monthlyScheduleId, mode));
    await deleteTaskPhotos(out.photoUrls, `delete ${yearMonth} schedule of store ${storeId}`);

    return { success: true, lockedCount: out.summary.keptDays, summary: out.summary };
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

    // A range, not equality: seeded rows sit at UTC midnight, app rows at
    // Jakarta midnight — the same day either way (lib/day-bucket.ts).
    const [existingEntry] = await db
      .select({ id: monthlyScheduleEntries.id })
      .from(monthlyScheduleEntries)
      .where(
        and(
          eq(monthlyScheduleEntries.monthlyScheduleId, ms.id),
          eq(monthlyScheduleEntries.userId, userId),
          gte(monthlyScheduleEntries.date, dateStart),
          lte(monthlyScheduleEntries.date, endOfDay(dateStart)),
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
      const [newSched] = await db
        .insert(schedules)
        .values({
          userId,
          storeId: entryStoreId,
          shiftId: shiftIdToUse,
          date: dateStart,
          monthlyScheduleEntryId: newEntry.id,
          isHoliday: false,
        })
        .returning({ id: schedules.id });

      if (shiftIdToUse === (await getDinasShiftId())) {
        await recordDinasAttendance([{
          scheduleId: newSched.id,
          userId,
          storeId: entryStoreId,
          shiftId: shiftIdToUse,
          date: dateStart,
        }]);
      }
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

  const { lockedEntryIds } = await entryLocks(rawEntries.map((r) => r.entry.id));

  return {
    schedule: ms,
    entries: rawEntries.map((r) => ({
      ...r.entry,
      userName: r.user?.name ?? null,
      userEmployeeType: r.empType?.label ?? null,
      shiftCode: r.shiftRow?.code ?? null,
      shiftLabel: r.shiftRow?.label ?? null,
      hasAttendance: lockedEntryIds.has(r.entry.id),
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
  const dinasShiftId = await getDinasShiftId();

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

      if (existing) {
        // Heals a Dinas day whose attendance row went missing.
        if (entry.shiftId === dinasShiftId) {
          await recordDinasAttendance([{
            scheduleId: existing.id,
            userId: entry.userId,
            storeId: entry.storeId,
            shiftId: entry.shiftId,
            date: startOfDay(entry.date),
          }]);
        }
        continue;
      }

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

      if (entry.shiftId === dinasShiftId) {
        await recordDinasAttendance([{
          scheduleId: newSched.id,
          userId: entry.userId,
          storeId: entry.storeId,
          shiftId: entry.shiftId,
          date: startOfDay(entry.date),
        }]);
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
    // Prep (ready_to_open) and closed stores record no attendance.
    const inactiveMsg = await assertStoreOperational(storeId);
    if (inactiveMsg) return { success: false, error: inactiveMsg };

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

    if (shiftData.code === DINAS_SHIFT_CODE)
      return {
        success: false,
        error: "Dinas dicatat otomatis dari jadwal — tidak perlu check-in.",
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
      const shiftStart = storeWallClock(sched.date, shiftData.startTime);
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
// An open attendance row stays open for the whole calendar day (Asia/Jakarta),
// so an employee who works overtime can still check out at the real time —
// even hours after the shift ended. Only once that day is over is a row that
// never got a check-out closed at the shift's scheduled end time (they forgot).
// Runs lazily (called from the employee + ops attendance GET routes, scoped
// to what's being viewed) and from a daily cron (app/api/cron/auto-checkout)
// as a system-wide safety net — same pattern as autoRevertExpiredTransfers above.

/** Bounds the scan so it never has to walk the whole attendance table. */
const AUTO_CHECKOUT_LOOKBACK_DAYS = 3;
const STORE_UTC_OFFSET_MINUTES = 7 * 60; // Asia/Jakarta, no DST

/**
 * The real instant of a store wall-clock time ("HH:MM[:SS]", Asia/Jakarta) on
 * the calendar day of a day bucket — independent of the server's timezone.
 * Buckets are UTC midnight (prod) but older rows written on a UTC+7 machine
 * sit at 17:00 UTC the day before; rounding to the nearest UTC day handles both.
 */
function storeWallClock(day: Date, time: string): Date {
  const bucket = new Date(day.getTime() + 12 * 3_600_000);
  const [h, m, s] = time.split(":").map(Number);
  return new Date(Date.UTC(
    bucket.getUTCFullYear(), bucket.getUTCMonth(), bucket.getUTCDate(),
    h || 0, (m || 0) - STORE_UTC_OFFSET_MINUTES, s || 0,
  ));
}

/** The first store-timezone midnight strictly after `instant`. */
function storeMidnightAfter(instant: Date): Date {
  const wall = new Date(instant.getTime() + STORE_UTC_OFFSET_MINUTES * 60_000); // UTC fields = Jakarta wall clock
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1, 0, -STORE_UTC_OFFSET_MINUTES));
}

export interface AutoCheckoutFilter {
  userId?: string;
  storeIds?: number[];
}

/**
 * Finds still-open attendance rows (checked in, never checked out) whose
 * calendar day is over and closes them out: checkOutTime is set to the
 * shift's scheduled end time (not "now" — that's when the system happened to
 * notice, not when the shift actually ended), any dangling open break is ended
 * at the same moment, and a note is appended so it's clear on the ops side
 * this wasn't a manual check-out. A manual check-out — however late in the
 * day — is never touched.
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
      checkInTime: attendance.checkInTime,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
    })
    .from(attendance)
    .innerJoin(shifts, eq(attendance.shiftId, shifts.id))
    .where(and(...conditions));

  let checkedOut = 0;

  for (const row of rows) {
    if (!row.endTime) continue;

    let shiftEnd = storeWallClock(row.date, row.endTime);
    // A shift ending past midnight ends on the next calendar day.
    if (row.startTime && row.endTime < row.startTime) shiftEnd = new Date(shiftEnd.getTime() + 86_400_000);

    // Open until the end of the (store-timezone) day the shift ends on.
    const deadline = storeMidnightAfter(shiftEnd);
    if (now < deadline) continue;

    // Never close a row before its own check-in (someone who checked in after the shift ended).
    let closeAt = row.checkInTime && row.checkInTime > shiftEnd ? row.checkInTime : shiftEnd;

    if (row.onBreak) {
      const [openBreak] = await db
        .select({ id: breakSessions.id, breakOutTime: breakSessions.breakOutTime })
        .from(breakSessions)
        .where(and(eq(breakSessions.attendanceId, row.id), isNull(breakSessions.returnTime)))
        .limit(1);

      if (openBreak) {
        if (openBreak.breakOutTime > closeAt) closeAt = openBreak.breakOutTime;
        await db
          .update(breakSessions)
          .set({ returnTime: closeAt, updatedAt: new Date() })
          .where(eq(breakSessions.id, openBreak.id));
      }
    }

    const note = "Auto checked-out by system at shift end (no check-out that day).";
    await db
      .update(attendance)
      .set({
        checkOutTime: closeAt,
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

export const AUTO_ABSENT_LOOKBACK_DAYS = 7;

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
    // Only live stores accrue absences — a prep (ready_to_open) or closed store
    // has a schedule but nobody is expected to check in.
    eq(stores.status, "active"),
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
    .innerJoin(stores, eq(stores.id, schedules.storeId))
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(and(...conditions));

  let marked = 0;
  const dinasShiftId = await getDinasShiftId();

  for (const row of rows) {
    // A Dinas day with no record (e.g. wiped by a store transfer) is Dinas, not a no-show.
    if (row.shiftId === dinasShiftId) {
      await recordDinasAttendance([{ ...row, shiftId: row.shiftId }]);
      continue;
    }

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

    const dateLabel = row.date.toLocaleDateString("en-ID", { day: "numeric", month: "short", timeZone: STORE_TIME_ZONE });
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

/**
 * Ops records a justified absence — Dinas / Cuti / STD / SD — on a scheduled
 * day, from whatever the status was (not recorded yet, auto-marked absent,
 * or even a checked-in present / late). Ops never sets present / late /
 * absent / excused: present & late only come from the employee's own
 * check-in, absent from autoMarkAbsentPastSchedules. With no `status` this
 * only updates the note on an existing record.
 */
export async function opsMarkAttendance(
  scheduleId: number,
  status: LeaveAttendanceStatus | undefined,
  actorId: string,
  notes?: string,
): Promise<{ success: boolean; attendanceId?: number; error?: string }> {
  if (status !== undefined && !isLeaveAttendanceStatus(status)) {
    return { success: false, error: "Ops can only set Dinas, Cuti, STD or SD." };
  }
  // undefined = leave the note alone; an empty string clears it.
  const note = notes === undefined ? undefined : notes.trim() || null;
  try {
    const [sched] = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);
    if (!sched) return { success: false, error: "Schedule not found." };

    const auth = await canManageSchedule(actorId, sched.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason };

    const inactiveMsg = await assertStoreOperational(sched.storeId);
    if (inactiveMsg) return { success: false, error: inactiveMsg };

    const [existing] = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, scheduleId))
      .limit(1);
    let attendanceId: number;

    if (existing) {
      // Re-classify to a leave status from anything (check-in times, if
      // any, are kept as-is), or just update the note.
      await db
        .update(attendance)
        .set({
          ...(status ? { status } : {}),
          notes: note,
          recordedBy: actorId,
          updatedAt: new Date(),
        })
        .where(eq(attendance.id, existing.id));
      attendanceId = existing.id;
    } else {
      if (!status) {
        return { success: false, error: "Choose Dinas, Cuti, STD or SD to record attendance." };
      }
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
          notes: note,
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
  const eligibleShiftIds = Object.entries(shiftMap)
    .filter(([code]) => isOpeningShift(code))
    .map(([, id]) => id)
    .filter(
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

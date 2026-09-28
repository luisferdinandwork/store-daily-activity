// lib/role-preview.ts
// ─────────────────────────────────────────────────────────────────────────────
// IT "switch role" preview helpers (see app/api/it/switch-role/route.ts).
//
// An IT user previewing a role gets a real context on their own users row:
//   • OPS Area → users.areaId = the picked area (ops_area without an area is
//     ineligible and would revoke the session — the old "Login rejected" bug).
//   • Employee (PIC 1 / PIC 2 / SA) → users.homeStoreId = the picked store and a
//     monthly schedule entry + materialised `schedules` row for every day from
//     today to month end, on the picked shift. ensurePreviewSchedule() tops it up
//     lazily (called from the employee/PIC layouts) so a new month keeps working.
//
// The real homeStoreId/areaId are kept in users.switchContext and restored by
// restoreRealRole(), which also runs automatically at login so an account can
// never get stuck half-switched. Returning also removes the preview's
// footprint (schedules, attendance, task ownership) so IT never stays visible
// on store pages.
// ─────────────────────────────────────────────────────────────────────────────

import { and, eq, inArray } from 'drizzle-orm';

import { db, pool } from '@/lib/db';
import {
  employeeTypes,
  monthlyScheduleEntries,
  monthlySchedules,
  schedules,
  userRoles,
  users,
  type SwitchContext,
} from '@/lib/db/schema';
import { todayInStoreTimezone } from '@/lib/schedule-utils';

/** Today's Jakarta calendar date as {y, m (0-based), d}. */
function todayParts() {
  const t = todayInStoreTimezone();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}

function ymKey(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

// Per-process memo: once a user's month is filled for a store/shift, skip the DB.
const ensured = new Set<string>();

/**
 * Makes sure a store/shift schedule exists for `userId` on every day from today
 * to the end of the current month. Idempotent; existing future days are moved
 * onto `shiftId` (so re-picking a shift takes effect). Past days are never
 * created — they'd be auto-marked absent.
 */
export async function fillPreviewSchedule(userId: string, storeId: number, shiftId: number) {
  const { y, m, d } = todayParts();
  const yearMonth = ymKey(y, m);
  const key = `${userId}:${storeId}:${shiftId}:${yearMonth}:${d}`;
  if (ensured.has(key)) return;

  await db
    .insert(monthlySchedules)
    .values({ storeId, yearMonth, importedBy: userId, note: 'IT role preview' })
    .onConflictDoNothing();

  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
    .limit(1);
  if (!ms) return;

  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dates: Date[] = [];
  for (let day = d; day <= lastDay; day++) dates.push(new Date(Date.UTC(y, m, day)));

  const entries = await db
    .insert(monthlyScheduleEntries)
    .values(
      dates.map((date) => ({
        monthlyScheduleId: ms.id,
        userId,
        storeId,
        date,
        shiftId,
        isOff: false,
        isLeave: false,
      })),
    )
    .onConflictDoUpdate({
      target: [monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleEntries.userId, monthlyScheduleEntries.date],
      set: { shiftId, isOff: false, isLeave: false, updatedAt: new Date() },
    })
    .returning({ id: monthlyScheduleEntries.id, date: monthlyScheduleEntries.date });

  const existing = await db
    .select({ id: schedules.id, entryId: schedules.monthlyScheduleEntryId, shiftId: schedules.shiftId })
    .from(schedules)
    .where(inArray(schedules.monthlyScheduleEntryId, entries.map((e) => e.id)));
  const byEntry = new Map(existing.map((s) => [s.entryId, s]));

  const missing = entries.filter((e) => !byEntry.has(e.id));
  if (missing.length) {
    await db.insert(schedules).values(
      missing.map((e) => ({
        userId,
        storeId,
        shiftId,
        date: e.date,
        monthlyScheduleEntryId: e.id,
        isHoliday: false,
      })),
    );
  }

  const wrongShift = existing.filter((s) => s.shiftId !== shiftId).map((s) => s.id);
  if (wrongShift.length) {
    await db
      .update(schedules)
      .set({ shiftId, updatedAt: new Date() })
      .where(inArray(schedules.id, wrongShift));
  }

  if (ensured.size > 2_000) ensured.clear();
  ensured.add(key);
}

// ─── Preview cleanup ─────────────────────────────────────────────────────────
// Fixed lists (not discovered at runtime) of the store-task tables a preview
// can touch. Every statement below is scoped to the IT user's own id or to
// schedules owned by that id — IT never works store tasks as itself, so those
// rows can only come from a preview. Real IT work elsewhere (manuals, BC
// settings, shift_tasks.assigned_by, …) is never referenced here.

/** Shared per store/day (or store/day/shift) task rows: schedule_id + user_id NOT NULL. */
const SHARED_TASK_TABLES = [
  'briefing_tasks',
  'cek_bin_tasks',
  'cek_uang_modal_tasks',
  'item_dropping_tasks',
  'item_return_tasks',
  'marketing_check_tasks',
  'setoran_money_storage',
  'setoran_tasks',
  'store_closing_tasks',
  'store_front_tasks',
  'store_opening_tasks',
  'vm_checklist_tasks',
] as const;

/** Nullable "completed by" columns on those tables. */
const COMPLETED_BY_SCHEDULE_TABLES = [
  'marketing_check_tasks',
  'setoran_money_storage',
  'setoran_tasks',
  'store_closing_tasks',
  'store_front_tasks',
  'store_opening_tasks',
] as const;

const COMPLETED_BY_USER_TABLES = [
  'marketing_check_tasks',
  'serah_terima_tasks',
  'setoran_money_storage',
  'setoran_tasks',
  'store_closing_tasks',
  'store_front_tasks',
  'store_opening_tasks',
] as const;

/**
 * A colleague's schedule at the same store on the same day (same shift
 * preferred) for each of `userId`'s schedules — SQL fragment, $1 = userId.
 */
const REPLACEMENT_SCHEDULE = `
  select distinct on (s1.id) s1.id as old_id, s2.id as new_id, s2.user_id as new_user_id
  from schedules s1
  join schedules s2 on s2.store_id = s1.store_id and s2.date = s1.date and s2.user_id <> $1
  where s1.user_id = $1
  order by s1.id, (s2.shift_id = s1.shift_id) desc, s2.id`;

/**
 * Removes the preview's footprint so the IT account no longer shows on store
 * pages (Cek Uang Modal, Hitung Kas, task progress, schedules, …):
 *
 *   1. Shared task rows owned by one of IT's schedules are handed to a
 *      colleague scheduled at that store that day, keeping their work. With no
 *      colleague that day the row was preview-only and is deleted.
 *   2. "Completed by IT" marks are cleared; grooming (personal), and cash
 *      counts IT counted or witnessed, are deleted.
 *   3. IT's attendance, schedules and monthly entries are deleted; a monthly
 *      schedule the preview itself created is dropped if now empty.
 *
 * Each step is isolated and logged so one failure can't block the return.
 */
export async function purgePreviewFootprint(userId: string) {
  const done: string[] = [];
  const step = async (label: string, text: string) => {
    try {
      const r = await pool.query(text, [userId]);
      if (r.rowCount) done.push(`${label}: ${r.rowCount}`);
    } catch (err) {
      console.error(`[role-preview] cleanup step failed (${label}):`, err);
    }
  };
  const itSchedules = `select id from schedules where user_id = $1`;

  // 1 — shared task rows: re-home to a colleague, else delete.
  for (const t of SHARED_TASK_TABLES) {
    await step(
      `${t} re-homed`,
      `update ${t} t set schedule_id = r.new_id,
         user_id = case when t.user_id = $1 then r.new_user_id else t.user_id end
       from (${REPLACEMENT_SCHEDULE}) r
       where t.schedule_id = r.old_id`,
    );
    await step(`${t} deleted`, `delete from ${t} where schedule_id in (${itSchedules})`);
    // Rows still attributed to IT on a colleague's schedule.
    await step(
      `${t} owner fixed`,
      `update ${t} t set user_id = s.user_id from schedules s where s.id = t.schedule_id and t.user_id = $1`,
    );
  }
  for (const t of COMPLETED_BY_SCHEDULE_TABLES) {
    await step(
      `${t}.completed_by_schedule_id`,
      `update ${t} set completed_by_schedule_id = null where completed_by_schedule_id in (${itSchedules})`,
    );
  }
  for (const t of COMPLETED_BY_USER_TABLES) {
    await step(`${t}.completed_by`, `update ${t} set completed_by = null where completed_by = $1`);
  }
  await step('store_front_tasks.claimed_by', `update store_front_tasks set claimed_by = null where claimed_by = $1`);
  await step(
    'serah_terima_tasks',
    `update serah_terima_tasks t set schedule_id = r.new_id,
       user_id = case when t.user_id = $1 then r.new_user_id else t.user_id end
     from (${REPLACEMENT_SCHEDULE}) r where t.schedule_id = r.old_id`,
  );
  await step(
    'cek_uang_modal_denominations',
    `update cek_uang_modal_denominations d set user_id = t.user_id
     from cek_uang_modal_tasks t where t.id = d.task_id and d.user_id = $1`,
  );

  // 2 — rows that only exist because of IT.
  await step('grooming_tasks', `delete from grooming_tasks where user_id = $1`);
  await step('store_cash_counts', `delete from store_cash_counts where counted_by_user_id = $1 or witness_user_id = $1`);

  // 3 — IT's own schedule footprint (break_sessions cascade from attendance).
  await step('attendance', `delete from attendance where user_id = $1`);
  await step('schedules', `delete from schedules where user_id = $1`);
  await step('monthly_schedule_entries', `delete from monthly_schedule_entries where user_id = $1`);
  await step(
    'monthly_schedules (empty preview)',
    `delete from monthly_schedules ms where ms.imported_by = $1 and ms.note = 'IT role preview'
       and not exists (select 1 from monthly_schedule_entries e where e.monthly_schedule_id = ms.id)`,
  );
  await step(
    'monthly_schedules.imported_by',
    `update monthly_schedules set imported_by = null where imported_by = $1 and note = 'IT role preview'`,
  );

  for (const k of ensured) if (k.startsWith(`${userId}:`)) ensured.delete(k);
  if (done.length) console.log(`[role-preview] cleaned preview footprint for ${userId}:`, done.join(', '));
}

/**
 * Called from the employee / PIC layouts: if this user is an IT account
 * previewing an employee role, keep its daily schedule topped up.
 */
export async function ensurePreviewSchedule(userId: string) {
  try {
    const [row] = await db
      .select({
        switchedFromRoleId: users.switchedFromRoleId,
        homeStoreId: users.homeStoreId,
        switchContext: users.switchContext,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const shiftId = row?.switchContext?.previewShiftId;
    if (!row?.switchedFromRoleId || !row.homeStoreId || !shiftId) return;

    await fillPreviewSchedule(userId, row.homeStoreId, shiftId);
  } catch (err) {
    // Never break the page over the preview helper.
    console.error('[role-preview] ensurePreviewSchedule failed:', err);
  }
}

/**
 * Restores an IT user's real role, employee type, home store and area, and
 * removes the preview's footprint (purgePreviewFootprint). No-op (returns null) when the user
 * isn't switched. Returns the restored role / employee-type codes.
 */
export async function restoreRealRole(
  userId: string,
): Promise<{ roleCode: string; employeeTypeCode: string | null } | null> {
  const [row] = await db
    .select({
      switchedFromRoleId: users.switchedFromRoleId,
      switchedFromEmployeeTypeId: users.switchedFromEmployeeTypeId,
      switchContext: users.switchContext,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row?.switchedFromRoleId) return null;

  const [realRole] = await db
    .select({ code: userRoles.code })
    .from(userRoles)
    .where(eq(userRoles.id, row.switchedFromRoleId))
    .limit(1);
  if (!realRole) throw new Error('Original role no longer exists.');

  let employeeTypeCode: string | null = null;
  if (row.switchedFromEmployeeTypeId) {
    const [et] = await db
      .select({ code: employeeTypes.code })
      .from(employeeTypes)
      .where(eq(employeeTypes.id, row.switchedFromEmployeeTypeId))
      .limit(1);
    employeeTypeCode = et?.code ?? null;
  }

  const ctx: SwitchContext | null = row.switchContext ?? null;

  await db
    .update(users)
    .set({
      roleId: row.switchedFromRoleId,
      employeeTypeId: row.switchedFromEmployeeTypeId,
      // Old switches (before switch_context existed) have no snapshot — IT
      // accounts don't normally carry a store/area, so fall back to null.
      homeStoreId: ctx ? ctx.originalHomeStoreId : null,
      areaId: ctx ? ctx.originalAreaId : null,
      switchedFromRoleId: null,
      switchedFromEmployeeTypeId: null,
      switchContext: null,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, userId), eq(users.switchedFromRoleId, row.switchedFromRoleId)));

  await purgePreviewFootprint(userId).catch((err) =>
    console.error('[role-preview] purgePreviewFootprint failed:', err),
  );

  return { roleCode: realRole.code, employeeTypeCode };
}


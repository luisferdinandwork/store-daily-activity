// lib/db/utils/user-deletion.ts
//
// IT "Delete user". It always goes through (the route only refuses your own
// account); the ~120 foreign keys pointing at users decide what happens:
//
//   • Removed with the account — its own day-to-day records: attendance (except
//     days where a break logged cash), its personal grooming tasks, its schedule
//     (monthly entries + the working days nothing else hangs off), store
//     assignment history, notifications and monthly target shares (the store's
//     roster % is re-split afterwards, like removing someone from the roster).
//   • Kept as history — cash records (petty cash, setoran, cek uang modal, cash
//     counts, break cash, store closing …), which the delete dialog shows as a
//     notice, plus everything shared with or owned by others: the store task
//     rows a whole shift fills in, issues, visits, rows the user verified,
//     approved or assigned.
//
// When nothing points at the account any more its row is removed; otherwise it
// stays as a hidden stub (users.deleted_at set, inactive, NIK released) so the
// kept history still shows the person's name. The preview runs these same steps
// and rolls back, so the dialog shows exactly what the delete will do.
//
// Unlike most utils this uses db.transaction(): it all lands together or not
// at all (lib/db is node-postgres).

import { and, eq, inArray, isNull, sql, TransactionRollbackError, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  attendance,
  employeeMonthlyTargets,
  groomingTasks,
  monthlyScheduleEntries,
  notifications,
  schedules,
  userStoreAssignments,
  users,
} from '@/lib/db/schema';
import { syncRosterPercentages } from '@/lib/performance/target-utils';

/** Tables whose rows are money — always kept, and called out in the delete dialog. */
const CASH_TABLES = new Set([
  'petty_cash_transactions',
  'petty_cash_refills',
  'petty_cash_refill_requests',
  'petty_cash_periods',
  'setoran_tasks',
  'setoran_money_storage',
  'setoran_corrections',
  'cek_uang_modal_tasks',
  'cek_uang_modal_denominations',
  'store_cash_counts',
  'break_sessions',
  'daily_reports',
  'store_closing_tasks', // Z-report + EDC settlement of the till
]);

const REMOVED_LABELS: Record<string, string> = {
  attendance: 'attendance records',
  grooming_tasks: 'grooming tasks',
  schedules: 'scheduled working days',
  monthly_schedule_entries: 'schedule entries',
  user_store_assignments: 'store assignment history',
  notifications: 'notifications',
  employee_monthly_targets: 'monthly target shares',
};

const KEPT_LABELS: Record<string, string> = {
  break_sessions: 'break cash records',
  cek_uang_modal_tasks: 'cek uang modal tasks',
  schedules: 'working days of the kept records',
  user_store_assignments: 'store assignments they made',
};

export interface UserRecordCount {
  table: string;
  label: string;
  count: number;
}

export interface UserDeletionSummary {
  /** Removed together with the account. */
  removed: UserRecordCount[];
  /** Cash records that stay as history — shown to IT as a notice. */
  keptCash: UserRecordCount[];
  /** Other records that stay: shared store tasks, issues, rows they verified … */
  keptOther: UserRecordCount[];
  /** `archived` = the row stays as a hidden stub because history still points at it. */
  outcome: 'removed' | 'archived';
}

export type UserDeletionResult =
  | { success: true; data: UserDeletionSummary }
  | { success: false; error: string; status: 404 };

// The transaction handle drizzle passes to db.transaction() callbacks.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function extractRows<T>(result: unknown): T[] {
  const withRows = result as { rows?: unknown[] };
  return Array.isArray(withRows.rows) ? (withRows.rows as T[]) : (result as unknown as T[]);
}

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, '""')}"`);

/** Every single-column FK in `public` that points at users.id or schedules.id. */
async function loadReferencingColumns(tx: Tx) {
  const result = await tx.execute(sql`
    SELECT target.relname AS "target", src.relname AS "table", col.attname AS "column"
    FROM pg_constraint con
    JOIN pg_class target  ON target.oid = con.confrelid
    JOIN pg_class src     ON src.oid = con.conrelid
    JOIN pg_namespace ns  ON ns.oid = src.relnamespace
    JOIN pg_attribute col ON col.attrelid = con.conrelid AND col.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND con.confrelid IN ('public.users'::regclass, 'public.schedules'::regclass)
  `);
  return extractRows<{ target: 'users' | 'schedules'; table: string; column: string }>(result);
}

/** Rows per table that still name the user in any column (one row counts once). */
async function countRemainingReferences(
  tx: Tx,
  userId: string,
  userColumns: { table: string; column: string }[],
): Promise<{ table: string; count: number }[]> {
  const byTable = new Map<string, SQL[]>();
  for (const { table, column } of userColumns) {
    const cond = sql`${ident(column)} = ${userId}`;
    const list = byTable.get(table);
    if (list) list.push(cond);
    else byTable.set(table, [cond]);
  }
  if (byTable.size === 0) return [];

  const selects = [...byTable].map(([table, conds]) => sql`
    SELECT ${table}::text AS "table", count(*)::int AS "count"
    FROM ${ident(table)} WHERE ${sql.join(conds, sql` OR `)}`);
  const result = await tx.execute(sql.join(selects, sql` UNION ALL `));
  return extractRows<{ table: string; count: number }>(result)
    .map((r) => ({ table: r.table, count: Number(r.count) }))
    .filter((r) => r.count > 0);
}

const byCountDesc = (a: UserRecordCount, b: UserRecordCount) => b.count - a.count;

/** The delete itself. Returns null when there is no (undeleted) account with this id. */
async function deleteWithin(tx: Tx, userId: string) {
  // Row lock: writes that reference the account (check-in, task rows) wait for
  // this transaction instead of racing it.
  const [user] = await tx
    .select({ id: users.id, nik: users.nik })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .for('update');
  if (!user) return null;

  const refs = await loadReferencingColumns(tx);
  const removed: UserRecordCount[] = [];
  const noteRemoved = (table: string, count: number) => {
    if (count > 0) removed.push({ table, label: REMOVED_LABELS[table] ?? table, count });
  };

  const targetMonths = await tx
    .selectDistinct({ storeId: employeeMonthlyTargets.storeId, yearMonth: employeeMonthlyTargets.yearMonth })
    .from(employeeMonthlyTargets)
    .where(eq(employeeMonthlyTargets.userId, userId));

  // Attendance — but a day whose break logged cash keeps its row (break_sessions
  // hang off attendance and would cascade away with it).
  const att = await tx
    .delete(attendance)
    .where(and(
      eq(attendance.userId, userId),
      sql`NOT EXISTS (SELECT 1 FROM break_sessions b WHERE b.attendance_id = ${attendance.id})`,
    ))
    .returning({ id: attendance.id });
  noteRemoved('attendance', att.length);

  // Grooming is the one personal task (one row per schedule); every other task
  // row is shared by the shift/store and stays.
  const grooming = await tx.delete(groomingTasks).where(eq(groomingTasks.userId, userId)).returning({ id: groomingTasks.id });
  noteRemoved('grooming_tasks', grooming.length);

  // Working days nothing else hangs off. Anything still pointing at one — a
  // shared task row, setoran, a kept attendance day — keeps it, whatever the
  // FK's delete rule (marketing_check_tasks would even cascade).
  const notReferenced = refs
    .filter((r) => r.target === 'schedules')
    .map((r) => sql`NOT EXISTS (SELECT 1 FROM ${ident(r.table)} x WHERE x.${ident(r.column)} = s.id)`);
  const deletedSchedules = await tx.execute(sql`
    DELETE FROM schedules s
    WHERE s.user_id = ${userId}${notReferenced.length > 0 ? sql` AND ${sql.join(notReferenced, sql` AND `)}` : sql``}
    RETURNING s.id`);
  noteRemoved('schedules', extractRows(deletedSchedules).length);

  // Kept working days drop their link to the monthly plan, which goes next.
  const userEntryIds = tx
    .select({ id: monthlyScheduleEntries.id })
    .from(monthlyScheduleEntries)
    .where(eq(monthlyScheduleEntries.userId, userId));
  await tx.update(schedules).set({ monthlyScheduleEntryId: null }).where(inArray(schedules.monthlyScheduleEntryId, userEntryIds));
  const entries = await tx
    .delete(monthlyScheduleEntries)
    .where(eq(monthlyScheduleEntries.userId, userId))
    .returning({ id: monthlyScheduleEntries.id });
  noteRemoved('monthly_schedule_entries', entries.length);

  const assignments = await tx
    .delete(userStoreAssignments)
    .where(eq(userStoreAssignments.userId, userId))
    .returning({ id: userStoreAssignments.id });
  noteRemoved('user_store_assignments', assignments.length);

  const inbox = await tx.delete(notifications).where(eq(notifications.userId, userId)).returning({ id: notifications.id });
  noteRemoved('notifications', inbox.length);

  const shares = await tx
    .delete(employeeMonthlyTargets)
    .where(eq(employeeMonthlyTargets.userId, userId))
    .returning({ id: employeeMonthlyTargets.id });
  noteRemoved('employee_monthly_targets', shares.length);

  // Whatever still names the user is history that stays.
  const remaining = await countRemainingReferences(tx, userId, refs.filter((r) => r.target === 'users'));
  const kept = remaining.map((r) => ({
    table: r.table,
    label: KEPT_LABELS[r.table] ?? r.table.replace(/_/g, ' '),
    count: r.count,
  }));

  let outcome: UserDeletionSummary['outcome'];
  if (kept.length === 0) {
    await tx.delete(users).where(eq(users.id, userId));
    outcome = 'removed';
  } else {
    // A hidden stub: can't sign in, drops out of every list, and the NIK is
    // free for a new account. The name stays for the history above.
    await tx
      .update(users)
      .set({
        nik: `${user.nik}~deleted~${user.id.slice(0, 8)}`,
        isActive: false,
        deletedAt: new Date(),
        homeStoreId: null,
        areaId: null,
        switchedFromRoleId: null,
        switchedFromEmployeeTypeId: null,
        switchContext: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    outcome = 'archived';
  }

  const summary: UserDeletionSummary = {
    removed: removed.sort(byCountDesc),
    keptCash: kept.filter((k) => CASH_TABLES.has(k.table)).sort(byCountDesc),
    keptOther: kept.filter((k) => !CASH_TABLES.has(k.table)).sort(byCountDesc),
    outcome,
  };
  return { summary, targetMonths };
}

const NOT_FOUND = { success: false, status: 404, error: 'User not found.' } as const;

/** What deleting this account would do — the real steps, rolled back. */
export async function previewUserDeletion(userId: string): Promise<UserDeletionResult> {
  const box: { summary?: UserDeletionSummary | null } = {};
  try {
    await db.transaction(async (tx) => {
      box.summary = (await deleteWithin(tx, userId))?.summary ?? null;
      tx.rollback();
    });
  } catch (err) {
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
  return box.summary ? { success: true, data: box.summary } : NOT_FOUND;
}

export async function deleteUserAccount(params: {
  userId: string;
  /** Recorded as updatedBy on the re-split roster percentages. */
  actorId: string;
}): Promise<UserDeletionResult> {
  const result = await db.transaction((tx) => deleteWithin(tx, params.userId));
  if (!result) return NOT_FOUND;

  // Re-split the remaining roster's % for every month the account was on —
  // the same follow-up as removing someone from a store's target roster.
  for (const month of result.targetMonths) {
    try {
      await syncRosterPercentages({ storeId: month.storeId, yearMonth: month.yearMonth, updatedBy: params.actorId });
    } catch (err) {
      console.error(`[user-deletion] roster re-sync failed for store ${month.storeId} ${month.yearMonth}:`, err);
    }
  }

  return { success: true, data: result.summary };
}

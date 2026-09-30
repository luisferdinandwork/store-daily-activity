// lib/db/utils/store-closing-review.ts
//
// Data behind Finance's Store Closing page: for a day, every store that was
// scheduled to close (plus any that has a closing row), with its Z-Report &
// EDC Settlement photo and whether the Open Statement was posted or put on
// hold — and, separately, every hold that is STILL open whatever its date.
// Also the "fixed" action that flips a held statement to posted.
//
// Day buckets are midnight of the calendar day in the server's zone (UTC on
// prod), matched as a [start, end) range — see dayBounds in lib/finance/dates.ts.

import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  areas,
  issues,
  schedules,
  storeClosingTasks,
  stores,
  users,
  type StoreClosingTask,
} from '@/lib/db/schema';
import { shifts } from '@/lib/db/schema/lookups';
import { CLOSING_SHIFT_CODES } from '@/lib/shift-tasks';
import { createNotificationsForUsers } from '@/lib/db/utils/notifications';
import { markIssueCompleted } from '@/lib/db/utils/issues';
import {
  dayBounds,
  dayKey,
  storeCodeOf,
  type StoreClosingRow,
} from '@/lib/store-closing-review';

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

const byStoreNo = (a: { storeNo: string }, b: { storeNo: string }) =>
  a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true });

/** Turns task rows (+ names / stores / issues) into page rows. */
async function toRows(
  tasks: StoreClosingTask[],
  extraStoreIds: number[],
  staffByStore: Map<number, { userId: string; name: string }[]>,
  dateStr: string | null,
): Promise<StoreClosingRow[]> {
  const storeIds = [...new Set([...tasks.map((t) => t.storeId), ...extraStoreIds])];
  if (storeIds.length === 0) return [];

  const userIds = new Set<string>();
  for (const t of tasks) {
    for (const id of [t.userId, t.completedBy, t.heldBy, t.verifiedBy]) if (id) userIds.add(id);
  }
  const issueIds = tasks.map((t) => t.holdIssueId).filter((id): id is number => id != null);

  const [storeRows, userRows, issueRows] = await Promise.all([
    db
      .select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, areaName: areas.name })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .where(inArray(stores.id, storeIds)),
    userIds.size
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds]))
      : Promise.resolve([]),
    issueIds.length
      ? db.select({ id: issues.id, status: issues.status }).from(issues).where(inArray(issues.id, issueIds))
      : Promise.resolve([]),
  ]);

  const storeMap = new Map(storeRows.map((s) => [s.id, s]));
  const nameOf = new Map(userRows.map((u) => [u.id, u.name]));
  const name = (id: string | null | undefined) => (id ? nameOf.get(id) ?? id : null);
  const issueMap = new Map(issueRows.map((i) => [i.id, i.status]));
  const taskStores = new Set(tasks.map((t) => t.storeId));

  const build = (storeId: number, task: StoreClosingTask | undefined): StoreClosingRow | null => {
    const store = storeMap.get(storeId);
    if (!store) return null;

    const isOnHold = Boolean(task?.isOnHold) && task?.status === 'pending';
    const resolved = task?.holdResolvedAt ?? null;

    return {
      storeId,
      storeNo: store.storeNo,
      storeName: store.name,
      areaName: store.areaName,
      code: storeCodeOf(store.storeNo),

      taskId: task?.id ?? null,
      date: task ? dayKey(task.date) : dateStr ?? '',
      status: !task ? 'no_data' : task.status === 'on_hold' ? 'pending' : task.status,

      zReportPhoto: task?.eodEdcSettlementPhoto ?? null,

      decision: task?.openStatementDecision ?? null,
      isOnHold,
      holdReason: task?.openStatementHoldReason ?? null,
      heldAt: iso(task?.heldAt),
      holdResolvedAt: iso(resolved),
      holdIssue: task?.holdIssueId != null
        ? { id: task.holdIssueId, status: issueMap.get(task.holdIssueId) ?? 'unknown' }
        : null,
      reopened: Boolean(task) && !isOnHold && task!.status !== 'completed' && task!.reopenedAt != null,
      fixedBy: resolved && task?.verifiedBy ? name(task.verifiedBy) : null,
      fixedAt: resolved && task?.verifiedAt ? iso(task.verifiedAt) : null,

      eodZReportDone: task?.eodZReportDone ?? false,
      edcSettlementDone: task?.edcSettlementDone ?? false,
      edcSummaryDone: task?.edcSummaryDone ?? false,
      notes: task?.notes ?? null,

      submittedBy: name(task?.completedBy ?? task?.heldBy ?? (task?.status === 'completed' ? task.userId : null)),
      completedAt: iso(task?.completedAt),
      photoAt: iso(task?.eodEdcSettlementPhotoAt),

      scheduledStaff: staffByStore.get(storeId) ?? [],

      canFix: isOnHold,
    };
  };

  const rows: StoreClosingRow[] = [];
  // A held task can pile up per store across days — one row per task.
  for (const t of tasks) {
    const row = build(t.storeId, t);
    if (row) rows.push(row);
  }
  // Scheduled to close but no task row at all.
  for (const id of extraStoreIds) {
    if (taskStores.has(id)) continue;
    const row = build(id, undefined);
    if (row) rows.push(row);
  }
  return rows.sort(byStoreNo);
}

// ─── Daily view ──────────────────────────────────────────────────────────────

export async function getStoreClosingDay(dateStr: string): Promise<StoreClosingRow[]> {
  const bounds = dayBounds(dateStr);
  if (!bounds) throw new Error(`Invalid date "${dateStr}".`);
  const { start, end } = bounds;

  const [scheduleRows, taskRows] = await Promise.all([
    db
      .select({ userId: schedules.userId, storeId: schedules.storeId })
      .from(schedules)
      .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
      // Prep (ready_to_open) / closed stores aren't expected to report.
      .innerJoin(stores, eq(stores.id, schedules.storeId))
      .where(and(
        eq(stores.status, 'active'),
        gte(schedules.date, start),
        lt(schedules.date, end),
        eq(schedules.isHoliday, false),
        inArray(shifts.code, [...CLOSING_SHIFT_CODES]),
      )),
    db.select().from(storeClosingTasks).where(and(gte(storeClosingTasks.date, start), lt(storeClosingTasks.date, end))),
  ]);

  const staffIds = [...new Set(scheduleRows.map((r) => r.userId))];
  const staffRows = staffIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, staffIds))
    : [];
  const staffName = new Map(staffRows.map((u) => [u.id, u.name]));

  const staffByStore = new Map<number, { userId: string; name: string }[]>();
  for (const r of scheduleRows) {
    const list = staffByStore.get(r.storeId) ?? [];
    if (!list.some((s) => s.userId === r.userId)) list.push({ userId: r.userId, name: staffName.get(r.userId) ?? r.userId });
    staffByStore.set(r.storeId, list);
  }

  return toRows(taskRows, [...new Set(scheduleRows.map((r) => r.storeId))], staffByStore, dateStr);
}

/** Every closing whose statement is on hold right now, whatever its date (newest first). */
export async function getStoreClosingHolds(): Promise<StoreClosingRow[]> {
  const tasks = await db
    .select()
    .from(storeClosingTasks)
    .where(and(eq(storeClosingTasks.isOnHold, true), eq(storeClosingTasks.status, 'pending')));

  const rows = await toRows(tasks, [], new Map(), null);
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }));
}

// ─── "Fixed" — flip a held statement to posted ───────────────────────────────

export type FixResult =
  | { success: true; taskId: number }
  | { success: false; error: string; status: number };

/**
 * Finance marks a held Open Statement as fixed: the closing becomes completed
 * with the statement POSTED, the linked hold issue is closed, and the store's
 * employee is told. The guard on isOnHold lives in the UPDATE itself, so two
 * reviewers (or Finance and a store re-post) can't both apply it.
 */
export async function markStatementFixed(taskId: number, financeUserId: string): Promise<FixResult> {
  const [task] = await db.select().from(storeClosingTasks).where(eq(storeClosingTasks.id, taskId)).limit(1);
  if (!task) return { success: false, error: 'Store Closing tidak ditemukan.', status: 404 };
  if (!task.isOnHold || task.status !== 'pending') {
    return { success: false, error: 'Statement ini tidak sedang On Hold.', status: 409 };
  }

  const now = new Date();
  const [updated] = await db
    .update(storeClosingTasks)
    .set({
      openStatementDecision: 'post_statement',
      isOnHold: false,
      status: 'completed',
      // Whoever held it did the closing; Finance only flips the statement.
      completedBy: task.heldBy ?? task.userId,
      completedByScheduleId: task.scheduleId,
      completedAt: now,
      holdResolvedAt: now,
      verifiedBy: financeUserId,
      verifiedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(storeClosingTasks.id, taskId),
      eq(storeClosingTasks.isOnHold, true),
      eq(storeClosingTasks.status, 'pending'),
    ))
    .returning({ id: storeClosingTasks.id });

  if (!updated) {
    return { success: false, error: 'Statement sudah diubah oleh orang lain. Refresh halaman.', status: 409 };
  }

  // The hold issue has done its job — close it so it stops showing as open.
  if (task.holdIssueId != null) {
    const [issue] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, task.holdIssueId)).limit(1);
    if (issue && issue.status !== 'completed') {
      await markIssueCompleted({ issueId: task.holdIssueId, userId: financeUserId });
    }
  }

  await createNotificationsForUsers([task.heldBy ?? task.userId], {
    type: 'store_closing_statement_fixed',
    title: 'Open Statement sudah Posted',
    body: 'Finance menandai Open Statement toko kamu yang tadinya On Hold sebagai sudah diperbaiki dan Posted. Tidak ada yang perlu kamu kerjakan lagi.',
    link: '/employee/tasks',
    relatedType: 'store_closing_task',
    relatedId: taskId,
  });

  return { success: true, taskId };
}

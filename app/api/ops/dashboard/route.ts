// app/api/ops/dashboard/route.ts
//
// GET /api/ops/dashboard?date=YYYY-MM-DD
//
// Single aggregate feed for the OPS dashboard (app/ops/page.tsx):
//   - task completion rate for today, split by shift, plus month-to-date
//   - attendance for today across every store in the actor's scope
//   - recent petty cash requests this month
//   - unreviewed (status = 'reported') issues routed to OPS
//
// Scope is resolved server-side via resolveOpsScope() — OPS HO / IT sees every
// store, OPS Area is limited to stores in their assigned area.

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import { jakartaDateKey, jakartaDayRange } from '@/lib/day-bucket';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { todayInStoreTimezone } from '@/lib/schedule-utils';
import {
  attendance,
  issueRoleAssignments,
  issues,
  monthlyScheduleEntries,
  schedules,
  stores,
  userRoles,
  users,
} from '@/lib/db/schema';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';
import {
  getAllTaskOverview,
  getAreaTaskOverview,
  getShiftTaskSummary,
  getStoreSummariesForRange,
} from '@/lib/db/utils/tasks';
import { parseDate } from '../tasks/_helpers';
import { EMPTY_COUNTS, addCounts, tallyPeople, type AttendanceCounts } from '@/lib/attendance-health';

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function completionRate(completed: number, total: number) {
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();

  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const rawDate = req.nextUrl.searchParams.get('date');
  const dateParsed = rawDate ? parseDate(rawDate) : { ok: true as const, date: todayInStoreTimezone() };

  if (!dateParsed.ok) {
    return NextResponse.json({ success: false, error: dateParsed.error }, { status: 400 });
  }

  const date = dateParsed.date;

  const storeRows = await db
    .select({ id: stores.id, name: stores.name, areaId: stores.areaId })
    .from(stores)
    .where(
      scope.scope === 'area'
        ? and(eq(stores.areaId, scope.areaId), eq(stores.status, 'active'))
        : eq(stores.status, 'active'),
    );

  const storeIds = storeRows.map((s) => s.id);

  // ── Tasks: today (+ shift split) and month-to-date ──────────────────────────
  const overview =
    scope.scope === 'all_areas'
      ? await getAllTaskOverview(date)
      : await getAreaTaskOverview(scope.userId, date);

  const today = overview.stores.reduce(
    (acc, s) => {
      acc.notStarted += s.summary.notStarted;
      acc.inProgress += s.summary.inProgress;
      acc.completed += s.summary.completed;
      acc.pending += s.summary.pending;
      acc.total += s.summary.total;
      return acc;
    },
    { notStarted: 0, inProgress: 0, completed: 0, pending: 0, total: 0 },
  );

  const todayByStore = overview.stores
    .filter((s) => s.summary.total > 0)
    .map((s) => ({
      storeId: s.id,
      storeName: s.name,
      completed: s.summary.completed,
      total: s.summary.total,
      completionRate: completionRate(s.summary.completed, s.summary.total),
    }))
    .sort((a, b) => a.completionRate - b.completionRate);

  const shiftRows = storeIds.length ? await getShiftTaskSummary(storeIds, date) : [];

  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthSummaries = storeIds.length
    ? await getStoreSummariesForRange(storeIds, monthStart, date)
    : [];
  const month = monthSummaries.reduce(
    (acc, s) => {
      acc.completed += s.completed;
      acc.total += s.total;
      return acc;
    },
    { completed: 0, total: 0 },
  );

  // ── Attendance: today, every store in scope ──────────────────────────────────
  // The Jakarta calendar day, matched on both stored encodings (lib/day-bucket.ts).
  const { start: dayStart, end: dayEnd } = jakartaDayRange(jakartaDateKey(date));

  // `noSchedule` sits beside the counts, not in them: it's roster people with no
  // shift today, so it isn't one of the day's scheduled shifts (`total`).
  type StoreAttendance = { storeId: string; storeName: string; noSchedule: number } & AttendanceCounts;
  const attendanceStoreMap = new Map<number, StoreAttendance>();
  for (const s of storeRows) {
    attendanceStoreMap.set(s.id, { storeId: String(s.id), storeName: s.name, noSchedule: 0, ...EMPTY_COUNTS });
  }

  let attendanceTotal: AttendanceCounts = { ...EMPTY_COUNTS };
  let noScheduleTotal = 0;

  if (storeIds.length) {
    const scheduleRows = await db
      .select({ storeId: schedules.storeId, userId: schedules.userId, status: attendance.status })
      .from(schedules)
      .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
      .where(
        and(
          inArray(schedules.storeId, storeIds),
          eq(schedules.isHoliday, false),
          gte(schedules.date, dayStart),
          lt(schedules.date, dayEnd),
        ),
      );

    // One status per person per store: an employee with two schedule rows today
    // (say one late, one present) is a single late — see tallyPeople().
    const rowsByStore = new Map<number, { userId: string; status: string | null }[]>();
    for (const row of scheduleRows) {
      let list = rowsByStore.get(row.storeId);
      if (!list) rowsByStore.set(row.storeId, (list = []));
      list.push({ userId: row.userId, status: row.status });
    }
    for (const [storeId, list] of rowsByStore) {
      const bucket = attendanceStoreMap.get(storeId);
      if (!bucket) continue;

      tallyPeople(bucket, list);
      attendanceTotal = addCounts(attendanceTotal, bucket);
    }

    // No schedule: an active store employee (home store = this store) with no
    // shift anywhere today AND no planned entry for today. A monthly-schedule
    // entry — including OFF and leave — means someone planned the day, so only
    // people the schedule doesn't mention at all land here.
    const roster = await db
      .select({ id: users.id, storeId: users.homeStoreId })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.id, users.roleId))
      .where(
        and(
          inArray(users.homeStoreId, storeIds),
          eq(users.isActive, true),
          isNull(users.deletedAt),
          eq(userRoles.code, 'employee'),
        ),
      );

    if (roster.length) {
      const rosterIds = roster.map((r) => r.id);
      const [shiftRows, plannedRows] = await Promise.all([
        db
          .selectDistinct({ userId: schedules.userId })
          .from(schedules)
          .where(
            and(
              inArray(schedules.userId, rosterIds),
              gte(schedules.date, dayStart),
              lt(schedules.date, dayEnd),
            ),
          ),
        db
          .selectDistinct({ userId: monthlyScheduleEntries.userId })
          .from(monthlyScheduleEntries)
          .where(
            and(
              inArray(monthlyScheduleEntries.userId, rosterIds),
              gte(monthlyScheduleEntries.date, dayStart),
              lt(monthlyScheduleEntries.date, dayEnd),
            ),
          ),
      ]);

      const onSchedule = new Set([...shiftRows, ...plannedRows].map((r) => r.userId));
      for (const person of roster) {
        if (onSchedule.has(person.id)) continue;
        const bucket = person.storeId != null ? attendanceStoreMap.get(person.storeId) : undefined;
        if (!bucket) continue;
        bucket.noSchedule++;
        noScheduleTotal++;
      }
    }
  }

  // ── Petty cash: recent requests this month ────────────────────────────────────
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  const pettyCashRows = storeIds.length
    ? await db
        .select({
          id: pettyCashTransactions.id,
          amount: pettyCashTransactions.amount,
          description: pettyCashTransactions.description,
          status: pettyCashTransactions.status,
          createdAt: pettyCashTransactions.createdAt,
          storeName: stores.name,
          submittedByName: users.name,
        })
        .from(pettyCashTransactions)
        .innerJoin(stores, eq(stores.id, pettyCashTransactions.storeId))
        .innerJoin(users, eq(users.id, pettyCashTransactions.userId))
        .where(
          and(
            eq(pettyCashTransactions.yearMonth, yearMonth),
            inArray(pettyCashTransactions.storeId, storeIds),
          ),
        )
        .orderBy(desc(pettyCashTransactions.createdAt))
    : [];

  const pettyCashPendingCount = pettyCashRows.filter((r) => r.status === 'pending_ops').length;

  // ── Issues: unreviewed (status = 'reported') routed to OPS ────────────────────
  const [opsRole] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.code, 'ops'))
    .limit(1);

  let unreviewedIssues: Array<{
    id: string;
    title: string;
    storeName: string;
    reporterName: string;
    createdAt: string;
  }> = [];

  if (opsRole) {
    const assignedRows = await db
      .select({ issueId: issueRoleAssignments.issueId })
      .from(issueRoleAssignments)
      .where(eq(issueRoleAssignments.roleId, opsRole.id));

    const assignedIssueIds = [
      ...new Set(assignedRows.map((r) => r.issueId).filter((id): id is number => Number.isFinite(id))),
    ];

    const routingConditions = [eq(issues.assignedToRoleId, opsRole.id)];
    if (assignedIssueIds.length) {
      routingConditions.push(inArray(issues.id, assignedIssueIds));
    }

    const conditions = [eq(issues.status, 'reported'), or(...routingConditions)!];
    if (scope.scope === 'area') {
      conditions.push(eq(stores.areaId, scope.areaId));
    }

    const rows = await db
      .select({
        id: issues.id,
        title: issues.title,
        createdAt: issues.createdAt,
        storeName: stores.name,
        reporterName: users.name,
      })
      .from(issues)
      .innerJoin(stores, eq(issues.storeId, stores.id))
      .innerJoin(users, eq(issues.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(issues.createdAt));

    unreviewedIssues = rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      storeName: r.storeName,
      reporterName: r.reporterName,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  return NextResponse.json({
    success: true,
    date: toDateKey(date),
    scope: scope.scope,
    storeCount: storeIds.length,
    tasks: {
      today: { ...today, completionRate: completionRate(today.completed, today.total) },
      todayByStore,
      shiftToday: shiftRows.map((s) => ({ ...s, completionRate: completionRate(s.completed, s.total) })),
      month: { ...month, completionRate: completionRate(month.completed, month.total) },
    },
    attendance: {
      ...attendanceTotal,
      noSchedule: noScheduleTotal,
      rate: completionRate(attendanceTotal.present + attendanceTotal.late, attendanceTotal.total),
      // A store with staff but no shifts today has no rate (null) — it still
      // shows, after the rated stores, so a missing schedule is visible.
      stores: [...attendanceStoreMap.values()]
        .filter((s) => s.total > 0 || s.noSchedule > 0)
        .map((s) => ({ ...s, rate: s.total > 0 ? completionRate(s.present + s.late, s.total) : null }))
        .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.noSchedule - a.noSchedule),
    },
    pettyCash: {
      pendingCount: pettyCashPendingCount,
      recent: pettyCashRows.slice(0, 8).map((r) => ({
        id: r.id,
        amount: r.amount,
        description: r.description,
        status: r.status,
        storeName: r.storeName,
        submittedByName: r.submittedByName,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    issues: {
      unreviewedCount: unreviewedIssues.length,
      recent: unreviewedIssues.slice(0, 8),
    },
  });
}

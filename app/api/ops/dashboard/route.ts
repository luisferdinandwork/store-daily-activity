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
import { and, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  attendance,
  issueRoleAssignments,
  issues,
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

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
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
  const date = rawDate ? new Date(rawDate) : new Date();

  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }

  const storeRows = await db
    .select({ id: stores.id, name: stores.name, areaId: stores.areaId })
    .from(stores)
    .where(scope.scope === 'area' ? eq(stores.areaId, scope.areaId) : undefined);

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
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const attendanceStoreMap = new Map<
    number,
    { storeId: string; storeName: string; total: number; present: number; late: number; absent: number; excused: number; unset: number }
  >();
  for (const s of storeRows) {
    attendanceStoreMap.set(s.id, {
      storeId: String(s.id),
      storeName: s.name,
      total: 0,
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      unset: 0,
    });
  }

  const attendanceTotal = { total: 0, present: 0, late: 0, absent: 0, excused: 0, unset: 0 };

  if (storeIds.length) {
    const scheduleRows = await db
      .select({ storeId: schedules.storeId, status: attendance.status })
      .from(schedules)
      .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
      .where(
        and(
          inArray(schedules.storeId, storeIds),
          eq(schedules.isHoliday, false),
          gte(schedules.date, dayStart),
          lte(schedules.date, dayEnd),
        ),
      );

    for (const row of scheduleRows) {
      const bucket = attendanceStoreMap.get(row.storeId);
      if (!bucket) continue;

      bucket.total++;
      attendanceTotal.total++;

      if (!row.status) {
        bucket.unset++;
        attendanceTotal.unset++;
        continue;
      }

      switch (row.status) {
        case 'present':
          bucket.present++;
          attendanceTotal.present++;
          break;
        case 'late':
          bucket.late++;
          attendanceTotal.late++;
          break;
        case 'absent':
          bucket.absent++;
          attendanceTotal.absent++;
          break;
        case 'excused':
          bucket.excused++;
          attendanceTotal.excused++;
          break;
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
      shiftToday: shiftRows.map((s) => ({ ...s, completionRate: completionRate(s.completed, s.total) })),
      month: { ...month, completionRate: completionRate(month.completed, month.total) },
    },
    attendance: {
      ...attendanceTotal,
      rate: completionRate(attendanceTotal.present + attendanceTotal.late, attendanceTotal.total),
      stores: [...attendanceStoreMap.values()].filter((s) => s.total > 0),
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

// app/api/ops/dashboard/trend/route.ts
//
// GET /api/ops/dashboard/trend?period=7d|30d|month|90d
//
// Task completion % and attendance % per Jakarta day, for the Ops Dashboard's
// trend chart. Same scope as the dashboard (OPS HO / IT every active store, OPS
// Area their own), same rules as the rest of Ops:
//   - tasks: getStoreSummariesForRange (scheduled-but-unopened slots count as
//     not done, see task-expectations.ts)
//   - attendance: one status per person per store-day (tallyPeople); a settled
//     past shift with no record counts as absent, exactly like the Attendance
//     month overview. Read-only.

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { attendance, schedules, stores } from '@/lib/db/schema';
import { addDaysKey, jakartaDateKey, jakartaDayStart, jakartaDaysRange, jakartaTodayKey } from '@/lib/day-bucket';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { AUTO_ABSENT_LOOKBACK_DAYS } from '@/lib/schedule-utils';
import { getStoreSummariesForRange } from '@/lib/db/utils/tasks';
import { EMPTY_COUNTS, showedUp, tallyPeople, type AttendanceCounts } from '@/lib/attendance-health';
import { isTrendPeriod, makePoint, trendRange, type TrendPoint } from '@/lib/ops-trend';

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const raw = req.nextUrl.searchParams.get('period') ?? '30d';
  if (!isTrendPeriod(raw)) {
    return NextResponse.json({ success: false, error: 'Unknown period.' }, { status: 400 });
  }

  try {
    const today = jakartaTodayKey();
    const { from, to } = trendRange(raw, today);

    const storeRows = await db
      .select({ id: stores.id })
      .from(stores)
      .where(scope.scope === 'area'
        ? and(eq(stores.areaId, scope.areaId), eq(stores.status, 'active'))
        : eq(stores.status, 'active'));
    const storeIds = storeRows.map((s) => s.id);

    const tasksByDay = new Map<string, { completed: number; total: number }>();
    const attendanceByDay = new Map<string, { showed: number; counted: number }>();

    if (storeIds.length) {
      const { start, end } = jakartaDaysRange(from, to);
      const [summaries, scheduleRows] = await Promise.all([
        getStoreSummariesForRange(storeIds, jakartaDayStart(from), jakartaDayStart(to)),
        db
          .select({ date: schedules.date, storeId: schedules.storeId, userId: schedules.userId, status: attendance.status })
          .from(schedules)
          .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
          .where(and(
            inArray(schedules.storeId, storeIds),
            eq(schedules.isHoliday, false),
            gte(schedules.date, start),
            lt(schedules.date, end),
          )),
      ]);

      for (const s of summaries) {
        const bucket = tasksByDay.get(s.date) ?? { completed: 0, total: 0 };
        bucket.completed += s.completed;
        bucket.total += s.total;
        tasksByDay.set(s.date, bucket);
      }

      // Day → store → people, then one status per person (tallyPeople).
      const settledFrom = addDaysKey(today, -AUTO_ABSENT_LOOKBACK_DAYS);
      const byDay = new Map<string, Map<number, { userId: string; status: string | null }[]>>();
      for (const row of scheduleRows) {
        const day = jakartaDateKey(row.date);
        if (day > today) continue;
        let perStore = byDay.get(day);
        if (!perStore) byDay.set(day, (perStore = new Map()));
        let list = perStore.get(row.storeId);
        if (!list) perStore.set(row.storeId, (list = []));
        const noShow = !row.status && day < today && day >= settledFrom;
        list.push({ userId: row.userId, status: noShow ? 'absent' : row.status });
      }
      for (const [day, perStore] of byDay) {
        let showed = 0;
        let counted = 0;
        for (const list of perStore.values()) {
          const c: AttendanceCounts = { ...EMPTY_COUNTS };
          tallyPeople(c, list);
          showed += showedUp(c);
          counted += showedUp(c) + c.absent;
        }
        attendanceByDay.set(day, { showed, counted });
      }
    }

    const points: TrendPoint[] = [];
    for (let day = from; day <= to; day = addDaysKey(day, 1)) {
      points.push(makePoint(
        day,
        day,
        tasksByDay.get(day) ?? { completed: 0, total: 0 },
        attendanceByDay.get(day) ?? { showed: 0, counted: 0 },
      ));
    }

    return NextResponse.json({ success: true, period: raw, from, to, points });
  } catch (error) {
    console.error('[GET /api/ops/dashboard/trend]', error);
    return NextResponse.json({ success: false, error: 'Failed to load trend.' }, { status: 500 });
  }
}

// lib/db/utils/area-calendar.ts
//
// Data for the Area Management calendar (GET /api/ops/areas/calendar): for each
// day of a month, each active store's attendance counts and task slots. Read-only,
// and the same rules as the rest of Ops so the numbers agree with those pages:
//   - tasks: getStoreSummariesForRange (scheduled-but-unopened slots count as
//     not done), like Ops Task Progress and the dashboard trend;
//   - attendance: one status per person per store-day (tallyPeople); a settled
//     past shift with no record counts as absent, like the Attendance overview.
// Days after today carry no figures — nothing has happened yet.

import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { attendance, schedules, stores } from '@/lib/db/schema';
import {
  addDaysKey,
  daysInMonthKey,
  jakartaDateKey,
  jakartaDayStart,
  jakartaDaysRange,
  jakartaTodayKey,
} from '@/lib/day-bucket';
import { AUTO_ABSENT_LOOKBACK_DAYS } from '@/lib/schedule-utils';
import { getStoreSummariesForRange } from '@/lib/db/utils/tasks';
import { EMPTY_COUNTS, tallyPeople, type AttendanceCounts } from '@/lib/attendance-health';
import type { AreaCalendarData, CalendarStore, StoreDayFigures } from '@/lib/area-calendar';

export async function getAreaCalendar(month: string): Promise<AreaCalendarData> {
  const today = jakartaTodayKey();

  const storeRows = await db
    .select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.status, 'active'))
    .orderBy(asc(stores.name));
  const storeList: CalendarStore[] = storeRows.filter((s): s is CalendarStore => s.areaId != null);

  const from = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonthKey(month)).padStart(2, '0')}`;
  const to = monthEnd < today ? monthEnd : today;

  const days: AreaCalendarData['days'] = {};
  if (!storeList.length || from > to) return { month, today, stores: storeList, days };

  const storeIds = storeList.map((s) => s.id);
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

  const figuresFor = (day: string, storeId: number): StoreDayFigures => {
    const perStore = (days[day] ??= {});
    return (perStore[storeId] ??= { att: { ...EMPTY_COUNTS }, done: 0, total: 0 });
  };

  for (const s of summaries) {
    if (s.date > to || s.date < from) continue;
    const f = figuresFor(s.date, s.storeId);
    f.done += s.completed;
    f.total += s.total;
  }

  // Day → store → people, then one status per person.
  const settledFrom = addDaysKey(today, -AUTO_ABSENT_LOOKBACK_DAYS);
  const byDayStore = new Map<string, Map<number, { userId: string; status: string | null }[]>>();
  for (const row of scheduleRows) {
    const day = jakartaDateKey(row.date);
    if (day > to || day < from) continue;
    let perStore = byDayStore.get(day);
    if (!perStore) byDayStore.set(day, (perStore = new Map()));
    let list = perStore.get(row.storeId);
    if (!list) perStore.set(row.storeId, (list = []));
    const noShow = !row.status && day < today && day >= settledFrom;
    list.push({ userId: row.userId, status: noShow ? 'absent' : row.status });
  }
  for (const [day, perStore] of byDayStore) {
    for (const [storeId, list] of perStore) {
      const c: AttendanceCounts = { ...EMPTY_COUNTS };
      tallyPeople(c, list);
      figuresFor(day, storeId).att = c;
    }
  }

  return { month, today, stores: storeList, days };
}

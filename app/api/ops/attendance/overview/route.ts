// app/api/ops/attendance/overview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { getStoresForOps, AUTO_ABSENT_LOOKBACK_DAYS } from '@/lib/schedule-utils';
import { filterActiveStoreIds } from '@/lib/db/utils/store-status';
import { db }                        from '@/lib/db';
import { schedules, attendance, stores } from '@/lib/db/schema';
import { eq, and, gte, lt, inArray, asc } from 'drizzle-orm';
import { getOpsActor } from '../../tasks/_helpers';
import { addDaysKey, jakartaDateKey, jakartaMonthRange, jakartaTodayKey } from '@/lib/day-bucket';
import { EMPTY_COUNTS, tallyPeople, type AttendanceMonthData, type StoreDayCounts } from '@/lib/attendance-health';

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/ops/attendance/overview?month=YYYY-MM[&storeId=N]
//
// One request for the whole calendar month: per day, per store, how many
// scheduled people are present / late / absent / on leave / not recorded yet.
// `storeId` narrows it to a single store (the single-store calendar).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    const actor = await getOpsActor(userId);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
    }

    const month = req.nextUrl.searchParams.get('month') ?? '';
    if (!MONTH_KEY.test(month)) {
      return NextResponse.json({ success: false, error: 'month must be YYYY-MM' }, { status: 400 });
    }

    // Prep (ready_to_open) and closed stores are left out of attendance progress.
    const allowedIds = await filterActiveStoreIds(await getStoresForOps(userId));
    const empty: AttendanceMonthData = { stores: [], days: {} };
    if (!allowedIds.length) {
      return NextResponse.json({ success: true, data: empty });
    }

    // Store list for the picker — always the full scope, even when one store is picked.
    const storeRows = await db
      .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
      .from(stores)
      .where(inArray(stores.id, allowedIds))
      .orderBy(asc(stores.storeNo));

    const storeIdRaw = req.nextUrl.searchParams.get('storeId');
    let scopeIds = allowedIds;
    if (storeIdRaw) {
      const storeId = Number(storeIdRaw);
      if (!Number.isInteger(storeId) || !allowedIds.includes(storeId)) {
        return NextResponse.json(
          { success: false, error: 'Store not found, not active, or outside your area.' },
          { status: 403 },
        );
      }
      scopeIds = [storeId];
    }

    // A past shift with no record at all is a no-show: autoMarkAbsentPastSchedules
    // (the daily cron, or opening the store's day) will record it as absent. This
    // overview is read-only, so it counts those the same way up front — otherwise
    // a day nobody checked in on would read as "pending" and drop out of the rate.
    // Today and older-than-lookback days stay pending, as nothing will mark them.
    const today       = jakartaTodayKey();
    const settledFrom = addDaysKey(today, -AUTO_ABSENT_LOOKBACK_DAYS);

    // The Jakarta month's range matches both stored encodings of a day bucket
    // (lib/day-bucket.ts), whatever zone this server runs in.
    const { start, end } = jakartaMonthRange(month);

    const rows = await db
      .select({
        date:    schedules.date,
        storeId: schedules.storeId,
        userId:  schedules.userId,
        status:  attendance.status,
      })
      .from(schedules)
      .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
      .where(
        and(
          inArray(schedules.storeId, scopeIds),
          eq(schedules.isHoliday, false),
          gte(schedules.date, start),
          lt(schedules.date, end),
        ),
      );

    // Group the rows by day → store, then count one status per person: an
    // employee with two rows on a day (say one late, one present) is a single
    // late, never one of each — see tallyPeople().
    const byDay = new Map<string, Map<number, { userId: string; status: string | null }[]>>();
    for (const row of rows) {
      const dayKey = jakartaDateKey(row.date);
      let perStore = byDay.get(dayKey);
      if (!perStore) byDay.set(dayKey, (perStore = new Map()));
      let list = perStore.get(row.storeId);
      if (!list) perStore.set(row.storeId, (list = []));

      // A settled past day with no record is a no-show; anything else with no
      // record stays pending.
      const noShow = !row.status && dayKey < today && dayKey >= settledFrom;
      list.push({ userId: row.userId, status: noShow ? 'absent' : row.status });
    }

    const days: AttendanceMonthData['days'] = {};
    for (const [dayKey, perStore] of byDay) {
      days[dayKey] = [...perStore].map(([storeId, list]): StoreDayCounts => {
        const c: StoreDayCounts = { storeId, ...EMPTY_COUNTS };
        tallyPeople(c, list);
        return c;
      });
    }

    return NextResponse.json({ success: true, data: { stores: storeRows, days } satisfies AttendanceMonthData });
  } catch (err) {
    console.error('[GET /api/ops/attendance/overview]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

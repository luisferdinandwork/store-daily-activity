// app/api/ops/attendance/overview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { getStoresForOps }           from '@/lib/schedule-utils';
import { filterActiveStoreIds } from '@/lib/db/utils/store-status';
import { db }                        from '@/lib/db';
import { schedules, attendance, stores } from '@/lib/db/schema';
import { eq, and, gte, lt, inArray } from 'drizzle-orm';
import { getOpsActor } from '../../tasks/_helpers';
import { isDayKey, jakartaDateKey, jakartaDayRange } from '@/lib/day-bucket';

interface StoreSummary {
  storeId:   number;
  storeName: string;
  total:     number;
  present:   number;
  absent:    number;
  late:      number;
  excused:   number;
  onBreak:   number;
  unset:     number;
}

// GET /api/ops/attendance/overview?date=YYYY-MM-DD | ISO instant (→ its Jakarta day)
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId  = (session.user as any).id as string;

    const actor = await getOpsActor(userId);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
    }

    const dateStr = req.nextUrl.searchParams.get('date');
    if (!dateStr) {
      return NextResponse.json({ success: false, error: 'date is required' }, { status: 400 });
    }

    // The Jakarta calendar day — its range matches both stored encodings of a
    // day bucket (lib/day-bucket.ts), whatever zone this server runs in.
    const dayKey = isDayKey(dateStr) ? dateStr : jakartaDateKey(new Date(dateStr));
    if (!isDayKey(dayKey)) {
      return NextResponse.json({ success: false, error: 'invalid date' }, { status: 400 });
    }

    const { start: dayStart, end: dayEnd } = jakartaDayRange(dayKey);

    // getStoresForOps now returns number[] (serial PKs)
    // Prep (ready_to_open) and closed stores are left out of attendance progress.
    const storeIds = await filterActiveStoreIds(await getStoresForOps(userId));
    if (!storeIds.length) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Fetch store names — single query, always inArray (works for one or many)
    const storeRows = await db
      .select({ id: stores.id, name: stores.name })
      .from(stores)
      .where(inArray(stores.id, storeIds));

    const storeNameById = new Map<number, string>(storeRows.map(s => [s.id, s.name]));

    // Pre-seed summary so stores with zero schedules still appear
    const summaryMap = new Map<number, StoreSummary>();
    for (const sid of storeIds) {
      summaryMap.set(sid, {
        storeId:   sid,
        storeName: storeNameById.get(sid) ?? String(sid),
        total: 0, present: 0, absent: 0, late: 0, excused: 0, onBreak: 0, unset: 0,
      });
    }

    // Pull every schedule for the day across all OPS stores, with optional attendance
    const scheduleRows = await db
      .select({
        sched: schedules,
        att:   attendance,
      })
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

    for (const { sched, att } of scheduleRows) {
      const s = summaryMap.get(sched.storeId);
      if (!s) continue;
      s.total++;

      if (!att) { s.unset++; continue; }

      switch (att.status) {
        case 'present': s.present++; break;
        case 'absent':  s.absent++;  break;
        case 'late':    s.late++;    break;
        // Dinas / Cuti / Sakit are justified absences — count as excused.
        case 'excused':
        case 'dinas':
        case 'cuti':
        case 'sakit_tanpa_surat':
        case 'sakit_dengan_surat':
          s.excused++; break;
      }
      if (att.onBreak) s.onBreak++;
    }

    return NextResponse.json({ success: true, data: [...summaryMap.values()] });
  } catch (err) {
    console.error('[GET /api/ops/attendance/overview]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
// app/api/ops/attendance/overview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { getStoresForOps }           from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { schedules, attendance, stores } from '@/lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0);     return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

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

// GET /api/ops/attendance/overview?date=ISO
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId  = (session.user as any).id as string;
    const dateStr = req.nextUrl.searchParams.get('date');
    if (!dateStr) {
      return NextResponse.json({ success: false, error: 'date is required' }, { status: 400 });
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ success: false, error: 'invalid date' }, { status: 400 });
    }

    const dayStart = startOfDay(date);
    const dayEnd   = endOfDay(date);

    // getStoresForOps now returns number[] (serial PKs)
    const storeIds = await getStoresForOps(userId);
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
          lte(schedules.date, dayEnd),
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
        case 'excused': s.excused++; break;
      }
      if (att.onBreak) s.onBreak++;
    }

    return NextResponse.json({ success: true, data: [...summaryMap.values()] });
  } catch (err) {
    console.error('[GET /api/ops/attendance/overview]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
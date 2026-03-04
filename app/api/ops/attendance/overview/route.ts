// app/api/ops/attendance/overview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStoresForOps } from '@/lib/schedule-utils';
import { db } from '@/lib/db';
import { schedules, attendance, stores } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

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

    const date     = new Date(dateStr);
    const dayStart = startOfDay(date);
    const dayEnd   = endOfDay(date);

    // Get all stores in this OPS user's area
    const storeIds = await getStoresForOps(userId);
    if (!storeIds.length) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Fetch store names
    const storeRows = await db
      .select({ id: stores.id, name: stores.name })
      .from(stores)
      .where(
        storeIds.length === 1
          ? eq(stores.id, storeIds[0])
          : // drizzle inArray
            (() => { const { inArray } = require('drizzle-orm'); return inArray(stores.id, storeIds); })(),
      );

    const storeMap = Object.fromEntries(storeRows.map((s) => [s.id, s.name]));

    // For each store, aggregate attendance
    const { inArray } = await import('drizzle-orm');

    const scheduleRows = await db
      .select({ schedule: schedules, attendance })
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

    // Aggregate per store
    const summaryMap: Record<string, {
      storeId: string; storeName: string;
      total: number; present: number; absent: number;
      late: number; excused: number; onBreak: number; unset: number;
    }> = {};

    for (const sid of storeIds) {
      summaryMap[sid] = {
        storeId: sid, storeName: storeMap[sid] ?? sid,
        total: 0, present: 0, absent: 0, late: 0, excused: 0, onBreak: 0, unset: 0,
      };
    }

    for (const { schedule, attendance: att } of scheduleRows) {
      const s = summaryMap[schedule.storeId];
      if (!s) continue;
      s.total++;
      if (!att) { s.unset++; continue; }
      if (att.status === 'present') s.present++;
      else if (att.status === 'absent')  s.absent++;
      else if (att.status === 'late')    s.late++;
      else if (att.status === 'excused') s.excused++;
      if (att.onBreak) s.onBreak++;
    }

    return NextResponse.json({ success: true, data: Object.values(summaryMap) });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
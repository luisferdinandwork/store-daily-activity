// app/api/employee/schedule/monthly/route.ts
//
// Personal, read-only view of the logged-in employee's own monthly shifts,
// enriched with their attendance record per day. Unlike
// /api/pic/schedule/monthly (store-wide roster, PIC-managed), this is
// scoped server-side to the caller's own userId.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { getMonthlyScheduleForUser } from '@/lib/schedule-utils';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const user = session.user as any;
  const userId = user.id as string;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');

  if (!rawHomeStoreId) {
    return NextResponse.json(
      { success: false, error: 'No home store.' },
      { status: 400 },
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { success: false, error: 'yearMonth required.' },
      { status: 400 },
    );
  }

  const storeId = Number(rawHomeStoreId);

  if (Number.isNaN(storeId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid homeStoreId.' },
      { status: 400 },
    );
  }

  const raw = await getMonthlyScheduleForUser(storeId, yearMonth, userId);

  if (!raw) {
    return NextResponse.json({ success: true, schedule: null });
  }

  const entries = raw.entries.map((entry) => ({
    id: String(entry.id),
    date: entry.date.toISOString(),

    shiftId: entry.shiftId,
    shift: entry.shiftCode,
    shiftCode: entry.shiftCode,
    shiftLabel: entry.shiftLabel,
    startTime: entry.startTime,
    endTime: entry.endTime,

    isOff: entry.isOff,
    isLeave: entry.isLeave,

    attendance: entry.attendance
      ? {
          status: entry.attendance.status,
          checkInTime: entry.attendance.checkInTime?.toISOString() ?? null,
          checkOutTime: entry.attendance.checkOutTime?.toISOString() ?? null,
          onBreak: entry.attendance.onBreak,
        }
      : null,
  }));

  return NextResponse.json({
    success: true,
    schedule: {
      id: String(raw.schedule.id),
      storeId: String(raw.schedule.storeId),
      yearMonth: raw.schedule.yearMonth,
      note: raw.schedule.note,
      entries,
    },
  });
}

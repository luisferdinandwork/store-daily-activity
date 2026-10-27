// app/api/employee/schedule/week/route.ts
//
// The signed-in employee's own shifts for the current Monday–Sunday (Jakarta),
// for the "Jadwal Minggu Ini" card on the employee Home. Read-only and scoped to
// the caller's own userId, like /api/employee/schedule/monthly — it just reads the
// one or two months the week touches (a week can straddle two) and keeps 7 days.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import { dayKind, type WeekDay, type WeekScheduleResponse } from '@/lib/employee-week';
import { getMonthlyScheduleForUser } from '@/lib/schedule-utils';
import { periodDays } from '@/lib/task-progress';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as { id: string; homeStoreId?: string | number | null };
  const storeId = Number(user.homeStoreId);
  if (!user.homeStoreId || Number.isNaN(storeId)) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const today = jakartaTodayKey();
  const week = periodDays('weekly', today);
  const months = [...new Set(week.map((d) => d.slice(0, 7)))];

  const monthly = await Promise.all(months.map((ym) => getMonthlyScheduleForUser(storeId, ym, user.id)));

  // Entry dates are day buckets (two stored encodings of the same Jakarta day), so
  // read each one with jakartaDateKey().
  const byDay = new Map<string, NonNullable<(typeof monthly)[number]>['entries'][number]>();
  for (const m of monthly) {
    for (const entry of m?.entries ?? []) byDay.set(jakartaDateKey(entry.date), entry);
  }

  const days: WeekDay[] = week.map((date) => {
    const entry = byDay.get(date);
    const kind = dayKind(entry);
    return {
      date,
      kind,
      shift: kind === 'shift' ? (entry?.shiftCode ?? null) : null,
      shiftLabel: kind === 'shift' ? (entry?.shiftLabel ?? null) : null,
      startTime: kind === 'shift' ? (entry?.startTime ?? null) : null,
      endTime: kind === 'shift' ? (entry?.endTime ?? null) : null,
    };
  });

  const body: WeekScheduleResponse = { success: true, from: week[0], to: week[week.length - 1], today, days };
  return NextResponse.json(body);
}

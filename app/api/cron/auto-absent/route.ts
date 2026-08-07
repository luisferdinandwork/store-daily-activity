// app/api/cron/auto-absent/route.ts
//
// Daily safety net for autoMarkAbsentPastSchedules() — marks anyone who had
// a schedule but no attendance record at all (never checked in, never got
// marked manually) as absent, system-wide, once their day has fully passed.
// The ops attendance GET route already runs the same scoped check on every
// load; this cron just guarantees it eventually runs even for stores nobody
// happens to view that day.

import { NextResponse } from 'next/server';
import { autoMarkAbsentPastSchedules } from '@/lib/schedule-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await autoMarkAbsentPastSchedules();
  return NextResponse.json(result); // { marked }
}

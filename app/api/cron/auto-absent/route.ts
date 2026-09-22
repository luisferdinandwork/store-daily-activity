// app/api/cron/auto-absent/route.ts
//
// Daily safety net for autoMarkAbsentPastSchedules() — marks anyone who had
// a schedule but no attendance record at all (never checked in, never got
// marked manually) as absent, system-wide, once their day has fully passed.
// The ops attendance GET route already runs the same scoped check on every
// load; this cron just guarantees it eventually runs even for stores nobody
// happens to view that day.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { autoMarkAbsentPastSchedules } from '@/lib/schedule-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Fails closed when CRON_SECRET is unset in production (lib/auth/cron.ts).
  const denied = verifyCronRequest(req);
  if (denied) return denied;

  const result = await autoMarkAbsentPastSchedules();
  return NextResponse.json(result); // { marked }
}

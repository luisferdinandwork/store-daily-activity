// app/api/cron/auto-checkout/route.ts
//
// Daily safety net for autoCheckoutOverdueAttendance() — closes out attendance
// left checked-in more than 30 minutes past shift end, system-wide. The
// employee and ops attendance GET routes already run the same scoped check
// on every load; this cron just guarantees it eventually runs even for
// stores/employees nobody happens to view that day.

import { NextResponse } from 'next/server';
import { autoCheckoutOverdueAttendance } from '@/lib/schedule-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await autoCheckoutOverdueAttendance();
  return NextResponse.json(result); // { checkedOut }
}

// app/api/cron/auto-checkout/route.ts
//
// Daily safety net for autoCheckoutOverdueAttendance() — closes out attendance
// left checked-in more than 30 minutes past shift end, system-wide. The
// employee and ops attendance GET routes already run the same scoped check
// on every load; this cron just guarantees it eventually runs even for
// stores/employees nobody happens to view that day.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { autoCheckoutOverdueAttendance } from '@/lib/schedule-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Fails closed when CRON_SECRET is unset in production (lib/auth/cron.ts).
  const denied = verifyCronRequest(req);
  if (denied) return denied;

  const result = await autoCheckoutOverdueAttendance();
  return NextResponse.json(result); // { checkedOut }
}

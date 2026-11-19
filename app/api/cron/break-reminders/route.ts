// app/api/cron/break-reminders/route.ts
//
// Every 5 minutes: sends the "istirahat sudah 30 menit — kembali & absen
// masuk" bell notification for every open break that is due and has none yet
// (lib/db/utils/break-reminders.ts). The employee's own bell poll and the
// attendance read already do this for their own breaks while the app is open;
// this covers employees whose app is closed.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { sendDueBreakReminders } from '@/lib/db/utils/break-reminders';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Fails closed when CRON_SECRET is unset in production (lib/auth/cron.ts).
  const denied = verifyCronRequest(req);
  if (denied) return denied;

  const result = await sendDueBreakReminders();
  return NextResponse.json({ success: true, ...result }); // { sent }
}

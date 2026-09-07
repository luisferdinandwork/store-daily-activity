// app/api/cron/password-expiry-check/route.ts
//
// Daily sweep for the 90-day password policy: every active non-IT user whose
// password is past its max age gets one inbox reminder (deduped against an
// existing unread one) linking to their change-password screen. Nothing is
// blocked — this is a nudge only. See lib/db/utils/password-policy.ts.

import { NextResponse } from 'next/server';
import { notifyUsersWithExpiredPasswords } from '@/lib/db/utils/password-policy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Vercel Cron / the self-hosted crontab send `Authorization: Bearer <CRON_SECRET>`.
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await notifyUsersWithExpiredPasswords();
  return NextResponse.json(result); // { notified, overdue }
}

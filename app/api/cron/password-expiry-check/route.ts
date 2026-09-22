// app/api/cron/password-expiry-check/route.ts
//
// Daily sweep for the 90-day password policy: every active non-IT user whose
// password is past its max age gets one inbox reminder (deduped against an
// existing unread one) linking to their change-password screen. Nothing is
// blocked — this is a nudge only. See lib/db/utils/password-policy.ts.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { notifyUsersWithExpiredPasswords } from '@/lib/db/utils/password-policy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Fails closed when CRON_SECRET is unset in production (lib/auth/cron.ts).
  const denied = verifyCronRequest(req);
  if (denied) return denied;

  const result = await notifyUsersWithExpiredPasswords();
  return NextResponse.json(result); // { notified, overdue }
}

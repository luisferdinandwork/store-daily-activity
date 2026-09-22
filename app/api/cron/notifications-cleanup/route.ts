// app/api/cron/notifications-cleanup/route.ts
//
// Daily purge of read notifications older than a week, so the inbox doesn't
// grow forever. Unread notifications are never touched here.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { deleteReadNotificationsOlderThan } from '@/lib/db/utils/notifications';

export const dynamic = 'force-dynamic';

const READ_RETENTION_DAYS = 7;

export async function GET(req: Request) {
  // Fails closed when CRON_SECRET is unset in production (lib/auth/cron.ts).
  const denied = verifyCronRequest(req);
  if (denied) return denied;

  const result = await deleteReadNotificationsOlderThan(READ_RETENTION_DAYS);
  return NextResponse.json(result); // { deleted }
}

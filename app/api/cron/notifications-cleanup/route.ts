// app/api/cron/notifications-cleanup/route.ts
//
// Daily purge of read notifications older than a week, so the inbox doesn't
// grow forever. Unread notifications are never touched here.

import { NextResponse } from 'next/server';
import { deleteReadNotificationsOlderThan } from '@/lib/db/utils/notifications';

export const dynamic = 'force-dynamic';

const READ_RETENTION_DAYS = 7;

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await deleteReadNotificationsOlderThan(READ_RETENTION_DAYS);
  return NextResponse.json(result); // { deleted }
}

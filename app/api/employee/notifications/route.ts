// app/api/employee/notifications/route.ts
//
// GET   — recent notifications + unread count for the current employee.
// PATCH — mark all as read. Body: { markAllRead: true }
// Mirrors app/api/ops/notifications/route.ts for the employee-side bell.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUnreadCount, listNotifications, markAllNotificationsRead } from '@/lib/db/utils/notifications';
import { sendDueBreakReminders } from '@/lib/db/utils/break-reminders';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as any).id as string;

  // A break that has run 30 minutes gets its "come back" reminder here, so it
  // reaches the bell on the next 60 s poll (the cron covers closed apps).
  await sendDueBreakReminders({ userId });

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(userId),
    getUnreadCount(userId),
  ]);

  return NextResponse.json({ success: true, notifications, unreadCount });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as any).id as string;

  const body = await req.json().catch(() => ({}));
  if (body?.markAllRead) {
    await markAllNotificationsRead(userId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Nothing to do.' }, { status: 400 });
}

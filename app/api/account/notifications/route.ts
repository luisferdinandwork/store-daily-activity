// app/api/account/notifications/route.ts
//
// GET   — recent notifications + unread count for the current user.
// PATCH — mark all as read. Body: { markAllRead: true }
//
// Role-agnostic version of the employee/ops notification endpoints, used by
// the Finance and Audit panels (which have no role-specific bell of their
// own).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { getUnreadCount, listNotifications, markAllNotificationsRead } from '@/lib/db/utils/notifications';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

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
  const userId = (session.user as { id: string }).id;

  const body = await req.json().catch(() => ({}));
  if (body?.markAllRead) {
    await markAllNotificationsRead(userId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Nothing to do.' }, { status: 400 });
}

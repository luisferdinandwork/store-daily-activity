// app/api/ops/notifications/route.ts
//
// GET   — recent notifications + unread count for the current OPS user.
// PATCH — mark all as read. Body: { markAllRead: true }

import { NextRequest, NextResponse } from 'next/server';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { getUnreadCount, listNotifications, markAllNotificationsRead } from '@/lib/db/utils/notifications';

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(scope.userId),
    getUnreadCount(scope.userId),
  ]);

  return NextResponse.json({ success: true, notifications, unreadCount });
}

export async function PATCH(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.markAllRead) {
    await markAllNotificationsRead(scope.userId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Nothing to do.' }, { status: 400 });
}

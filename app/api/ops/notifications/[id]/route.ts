// app/api/ops/notifications/[id]/route.ts
//
// PATCH — mark a single notification as read (fires when it's clicked).

import { NextResponse } from 'next/server';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { markNotificationRead } from '@/lib/db/utils/notifications';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(_req: Request, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  await markNotificationRead(scope.userId, id);
  return NextResponse.json({ success: true });
}

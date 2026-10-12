// app/api/it/stores/[id]/reset-tasks/route.ts
//
// POST — IT resets a store's task data for TODAY (Jakarta): every task row of
// the day and its photos go; attendance, schedules and other days stay. See
// lib/db/utils/store-task-reset.ts. IT-only.

import { NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { resetStoreTodayTasks } from '@/lib/db/utils/store-task-reset';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const storeId = Number((await params).id);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const result = await resetStoreTodayTasks(storeId);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  console.warn(`[store-task-reset] ${scope.userId} reset today's tasks of ${result.data.storeNo} (${result.data.totalRemoved} rows)`);
  return NextResponse.json({ success: true, ...result.data });
}

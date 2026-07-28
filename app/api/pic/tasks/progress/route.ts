// app/api/pic/tasks/progress/route.ts
//
// GET /api/pic/tasks/progress?date=YYYY-MM-DD
//
// Single-store task review for PIC 1 / PIC 2 — always scoped to the actor's
// own home store, mirroring app/api/ops/tasks/progress's "detail mode" but
// without any cross-store/area access.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { getFlatTasksForStoreDate, summariseTasks } from '@/lib/db/utils/tasks';
import { serializeTask } from '@/lib/db/utils/task-serialize';
import { resolveActorCodes, parseLocalDate } from '../../schedule/_utils';

function isPicType(empType: string | null) {
  return empType === 'pic_1' || empType === 'pic_2';
}

function completionRate(summary: { total: number; completed: number }) {
  if (summary.total <= 0) return 0;
  return Math.round((summary.completed / summary.total) * 100);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
  const { role, empType } = await resolveActorCodes(user.id as string);

  if (role !== 'employee' || !isPicType(empType)) {
    return NextResponse.json({ success: false, error: 'PIC only.' }, { status: 403 });
  }

  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  if (!rawHomeStoreId) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const storeId = Number(rawHomeStoreId);
  if (Number.isNaN(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });
  }

  const rawDate = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const date = parseLocalDate(rawDate);
  if (!date) {
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }

  const [storeRow] = await db
    .select({ id: stores.id, name: stores.name, address: stores.address })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!storeRow) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  const tasks = await getFlatTasksForStoreDate(storeId, date);
  const summary = summariseTasks(tasks);

  return NextResponse.json({
    success: true,
    date: rawDate,
    store: { id: String(storeRow.id), name: storeRow.name, address: storeRow.address },
    summary: { ...summary, completionRate: completionRate(summary) },
    tasks: tasks.map(serializeTask),
  });
}

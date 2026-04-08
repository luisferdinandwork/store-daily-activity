// app/api/ops/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import { stores }                    from '@/lib/db/schema';
import { eq }                        from 'drizzle-orm';
import {
  getFlatTasksForStoreDate,
  summariseTasks,
  verifyTaskByType,
} from '@/lib/db/utils/tasks';
import {
  getOpsActor, assertStoreInActorArea, parseStoreId, parseDate,
} from './_helpers';

// GET /api/ops/tasks?storeId=&date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const storeParsed = parseStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeParsed.ok) return NextResponse.json({ success: false, error: storeParsed.error }, { status: 400 });

  const dateParsed = parseDate(req.nextUrl.searchParams.get('date'));
  if (!dateParsed.ok) return NextResponse.json({ success: false, error: dateParsed.error }, { status: 400 });

  const areaErr = await assertStoreInActorArea(actor, storeParsed.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  const [storeRow] = await db
    .select({ name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeParsed.id))
    .limit(1);

  const tasks   = await getFlatTasksForStoreDate(storeParsed.id, dateParsed.date);
  const summary = summariseTasks(tasks);

  return NextResponse.json({
    success:    true,
    storeName:  storeRow?.name ?? null,
    tasks:      tasks.map(t => ({
      ...t,
      id:         String(t.id),
      scheduleId: String(t.scheduleId),
      storeId:    String(t.storeId),
    })),
    summary,
  });
}

// PATCH /api/ops/tasks
// body: { taskId, taskType, storeId, action: 'verify'|'reject', notes? }
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const taskId   = Number(body.taskId);
  const taskType = body.taskType as string;
  const action   = body.action as 'verify' | 'reject';
  const notes    = typeof body.notes === 'string' ? body.notes : undefined;

  const storeParsed = parseStoreId(String(body.storeId ?? ''));
  if (!storeParsed.ok) return NextResponse.json({ success: false, error: storeParsed.error }, { status: 400 });

  if (isNaN(taskId) || !taskType || (action !== 'verify' && action !== 'reject')) {
    return NextResponse.json(
      { success: false, error: 'taskId, taskType, and action (verify|reject) are required.' },
      { status: 400 },
    );
  }

  const areaErr = await assertStoreInActorArea(actor, storeParsed.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  const result = await verifyTaskByType(taskType, {
    taskId,
    actorId: actor.id,
    storeId: storeParsed.id,
    approve: action === 'verify',
    notes,
  });

  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ success: true });
}
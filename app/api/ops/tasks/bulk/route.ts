// app/api/ops/tasks/bulk/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { verifyTaskByType }          from '@/lib/db/utils/tasks';
import {
  getOpsActor, assertStoreInActorArea, parseStoreId,
} from '../_helpers';

// POST /api/ops/tasks/bulk
// body: {
//   storeId:  number,
//   action:   'verify' | 'reject',
//   tasks:    { taskId: number, taskType: string }[],
//   notes?:   string,
// }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const storeParsed = parseStoreId(String(body.storeId ?? ''));
  if (!storeParsed.ok) return NextResponse.json({ success: false, error: storeParsed.error }, { status: 400 });

  const action = body.action as 'verify' | 'reject';
  const taskList = body.tasks as { taskId: number | string; taskType: string }[] | undefined;
  const notes    = typeof body.notes === 'string' ? body.notes : undefined;

  if (action !== 'verify' && action !== 'reject') {
    return NextResponse.json({ success: false, error: 'action must be verify or reject.' }, { status: 400 });
  }
  if (!Array.isArray(taskList) || taskList.length === 0) {
    return NextResponse.json({ success: false, error: 'tasks[] is required.' }, { status: 400 });
  }
  if (taskList.length > 100) {
    return NextResponse.json({ success: false, error: 'Too many tasks in one batch (max 100).' }, { status: 400 });
  }

  const areaErr = await assertStoreInActorArea(actor, storeParsed.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  let succeeded = 0;
  const failed: { taskId: number | string; taskType: string; error: string }[] = [];

  // Run sequentially to keep error messages predictable and avoid hammering the DB
  for (const t of taskList) {
    const numId = Number(t.taskId);
    if (isNaN(numId)) {
      failed.push({ taskId: t.taskId, taskType: t.taskType, error: 'Invalid taskId' });
      continue;
    }
    const result = await verifyTaskByType(t.taskType, {
      taskId:  numId,
      actorId: actor.id,
      storeId: storeParsed.id,
      approve: action === 'verify',
      notes,
    });
    if (result.success) succeeded++;
    else failed.push({ taskId: t.taskId, taskType: t.taskType, error: result.error });
  }

  return NextResponse.json({
    success:  failed.length === 0,
    succeeded,
    failed,
    total:    taskList.length,
  });
}
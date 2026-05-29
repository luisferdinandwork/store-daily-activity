// app/api/employee/tasks/open-statement/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  autoSaveOpenStatement,
  submitOpenStatement,
  getOpenStatementById,
} from '@/lib/db/utils/open-statement';

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const { searchParams } = new URL(request.url);
  const taskId = Number(searchParams.get('taskId'));
  if (!taskId) {
    return NextResponse.json({ success: false, error: 'taskId required' }, { status: 400 });
  }

  const task = await getOpenStatementById(taskId);
  if (!task) {
    return NextResponse.json({ success: false, error: 'Task not found.' }, { status: 404 });
  }

  const parent = task.parentTaskId ? await getOpenStatementById(task.parentTaskId) : null;

  return NextResponse.json({ success: true, task, parent });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const body = await request.json();
  const result = await submitOpenStatement({
    taskId: body.taskId != null ? Number(body.taskId) : undefined,
    scheduleId: Number(body.scheduleId),
    userId,
    storeId: Number(body.storeId),
    geo: body.geo ?? { lat: 0, lng: 0 },
    skipGeo: Boolean(body.skipGeo),
    decision: body.decision,
    holdReason: body.holdReason,
    notes: body.notes,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const body = await request.json();

  if (body.taskId == null) {
    return NextResponse.json(
      { success: false, error: 'taskId is required.' },
      { status: 400 },
    );
  }

  const result = await autoSaveOpenStatement(Number(body.taskId), {
    decision: body.decision ?? null,
    holdReason: body.holdReason ?? null,
    notes: body.notes,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export const PUT = PATCH;
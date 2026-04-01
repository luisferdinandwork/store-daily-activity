// app/api/ops/tasks/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { storeOpeningTasks, groomingTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { canManageSchedule } from '@/lib/schedule-utils';

// ─── POST /api/ops/tasks/verify ───────────────────────────────────────────────
// Body: { taskType: 'store_opening' | 'grooming', taskId: string }
//
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { taskType, taskId } = body ?? {};

  if (!taskType || !taskId) {
    return NextResponse.json(
      { error: 'taskType and taskId are required' },
      { status: 400 },
    );
  }

  const verifiedBy = session.user.id;
  const now        = new Date();

  if (taskType === 'store_opening') {
    const [row] = await db
      .select({ storeId: storeOpeningTasks.storeId, status: storeOpeningTasks.status })
      .from(storeOpeningTasks)
      .where(eq(storeOpeningTasks.id, taskId))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    if (row.status !== 'completed') {
      return NextResponse.json(
        { error: 'Only completed tasks can be verified' },
        { status: 400 },
      );
    }

    const auth = await canManageSchedule(verifiedBy, row.storeId);
    if (!auth.allowed) return NextResponse.json({ error: auth.reason }, { status: 403 });

    await db
      .update(storeOpeningTasks)
      .set({ verifiedBy, verifiedAt: now, updatedAt: now })
      .where(eq(storeOpeningTasks.id, taskId));

  } else if (taskType === 'grooming') {
    const [row] = await db
      .select({ storeId: groomingTasks.storeId, status: groomingTasks.status })
      .from(groomingTasks)
      .where(eq(groomingTasks.id, taskId))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    if (row.status !== 'completed') {
      return NextResponse.json(
        { error: 'Only completed tasks can be verified' },
        { status: 400 },
      );
    }

    const auth = await canManageSchedule(verifiedBy, row.storeId);
    if (!auth.allowed) return NextResponse.json({ error: auth.reason }, { status: 403 });

    await db
      .update(groomingTasks)
      .set({ verifiedBy, verifiedAt: now, updatedAt: now })
      .where(eq(groomingTasks.id, taskId));

  } else {
    return NextResponse.json(
      { error: `Unknown taskType: ${taskType}` },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
// app/api/finance/setoran/[taskId]/verify/route.ts
//
// POST /api/finance/setoran/:taskId/verify
//
// Finance staff verifies a completed setoran task.
// Requires the task to be in 'completed' status and not already verified.

import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { setoranTasks } from '@/lib/db/schema';
import { resolveFinanceScope } from '@/lib/finance/scope';

export async function POST(
  request: Request,
  // Next.js 15: params is a Promise — must be awaited before accessing properties
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    // Finance/IT only. This used to accept ANY signed-in user, so a store employee
    // could mark their own store's deposit as verified by Finance.
    const scope = await resolveFinanceScope();
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: scope.error },
        { status: scope.status },
      );
    }

    const { taskId: taskIdStr } = await params;
    const taskId = parseInt(taskIdStr, 10);
    if (isNaN(taskId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid taskId.' },
        { status: 400 },
      );
    }

    const [task] = await db
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.id, taskId))
      .limit(1);

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found.' },
        { status: 404 },
      );
    }

    if (task.status !== 'completed') {
      return NextResponse.json({
        success: false,
        error: 'Hanya setoran dengan status completed yang bisa diverifikasi.',
      });
    }

    if (task.verifiedAt) {
      return NextResponse.json({
        success: false,
        error: 'Setoran ini sudah diverifikasi sebelumnya.',
      });
    }

    const now = new Date();

    // Conditional update: two reviewers clicking at once can't both "win".
    const [updated] = await db
      .update(setoranTasks)
      .set({
        verifiedBy: scope.userId,
        verifiedAt: now,
        updatedAt:  now,
      })
      .where(
        and(
          eq(setoranTasks.id, taskId),
          eq(setoranTasks.status, 'completed'),
          isNull(setoranTasks.verifiedAt),
        ),
      )
      .returning();

    if (!updated) {
      return NextResponse.json({
        success: false,
        error: 'Setoran ini sudah diverifikasi sebelumnya.',
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[POST /api/finance/setoran/[taskId]/verify]', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
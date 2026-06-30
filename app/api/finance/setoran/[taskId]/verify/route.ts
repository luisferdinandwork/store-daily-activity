// app/api/finance/setoran/[taskId]/verify/route.ts
//
// POST /api/finance/setoran/:taskId/verify
//
// Finance staff verifies a completed setoran task.
// Requires the task to be in 'completed' status and not already verified.

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { setoranTasks } from '@/lib/db/schema';
import { auth } from '@/lib/auth';

export async function POST(
  request: Request,
  // Next.js 15: params is a Promise — must be awaited before accessing properties
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized.' },
        { status: 401 },
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

    const [updated] = await db
      .update(setoranTasks)
      .set({
        verifiedBy: session.user.id,
        verifiedAt: now,
        updatedAt:  now,
      })
      .where(eq(setoranTasks.id, taskId))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[POST /api/finance/setoran/[taskId]/verify]', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
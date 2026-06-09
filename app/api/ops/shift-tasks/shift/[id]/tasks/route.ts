// app/api/ops/shift-tasks/shift/[id]/tasks/route.ts
import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { shifts, shiftTasks, taskDefinitions } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

function isOps(session: Awaited<ReturnType<typeof auth>>): boolean {
  const user = session?.user as any;
  const role = user?.role as string | undefined;
  const employeeType = (user?.employeeType ?? user?.employeeTypeCode) as string | undefined;

  return (
    role === 'ops' ||
    role === 'admin' ||
    employeeType === 'ops_area' ||
    employeeType === 'ops_ho'
  );
}

async function resolveId(ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const p = await ctx.params;
  return Number(p.id);
}

interface PutBody {
  tasks?: Array<{
    taskDefinitionId: number;
    isRequired?: boolean;
    sortOrder?: number;
  }>;
}

export async function PUT(
  req: Request,
  ctx: { params: { id: string } | Promise<{ id: string }> },
) {
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  if (!isOps(session)) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 },
    );
  }

  const shiftId = await resolveId(ctx);

  if (!Number.isInteger(shiftId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid shift id' },
      { status: 400 },
    );
  }

  let body: PutBody;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const incoming = (body.tasks ?? []).filter(
    (task) => task && Number.isInteger(task.taskDefinitionId),
  );

  // De-dupe by taskDefinitionId. Last value wins.
  const deduped = new Map<
    number,
    { taskDefinitionId: number; isRequired?: boolean; sortOrder?: number }
  >();

  for (const task of incoming) {
    deduped.set(task.taskDefinitionId, task);
  }

  const desired = [...deduped.values()];
  const userId = (session.user as any)?.id as string | undefined;

  try {
    const [shift] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(eq(shifts.id, shiftId))
      .limit(1);

    if (!shift) {
      return NextResponse.json(
        { success: false, error: 'Shift not found' },
        { status: 404 },
      );
    }

    if (desired.length) {
      const ids = desired.map((task) => task.taskDefinitionId);

      const found = await db
        .select({ id: taskDefinitions.id })
        .from(taskDefinitions)
        .where(inArray(taskDefinitions.id, ids));

      const foundIds = new Set(found.map((row) => row.id));
      const missing = ids.filter((id) => !foundIds.has(id));

      if (missing.length) {
        return NextResponse.json(
          {
            success: false,
            error: `Unknown task definition id(s): ${missing.join(', ')}`,
          },
          { status: 400 },
        );
      }
    }

    /**
     * Neon HTTP driver does not support db.transaction().
     *
     * This route replaces all task assignments for one shift.
     * We do it with normal sequential queries:
     * 1. delete existing shift task assignments
     * 2. insert the new desired assignments
     */
    await db.delete(shiftTasks).where(eq(shiftTasks.shiftId, shiftId));

    if (desired.length) {
      await db.insert(shiftTasks).values(
        desired.map((task, index) => ({
          shiftId,
          taskDefinitionId: task.taskDefinitionId,
          isRequired: task.isRequired ?? true,
          isActive: true,
          sortOrder: Number.isInteger(task.sortOrder)
            ? task.sortOrder!
            : (index + 1) * 10,
          assignedBy: userId ?? null,
        })),
      );
    }

    return NextResponse.json({
      success: true,
      count: desired.length,
    });
  } catch (err) {
    console.error('PUT /api/ops/shift-tasks/shift/[id]/tasks failed:', err);

    return NextResponse.json(
      { success: false, error: 'Failed to update shift tasks' },
      { status: 500 },
    );
  }
}
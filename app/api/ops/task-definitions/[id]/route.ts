// app/api/ops/task-definitions/[id]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/task-definitions/[id]
// Updates a single task definition's OPS-configurable fields. Today that's just
// `requiresLocation` — the toggle behind the "Task Management" settings page.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { taskDefinitions } from '@/lib/db/schema';
import type { TaskDefinitionDTO } from '@/lib/shift-tasks';

export const dynamic = 'force-dynamic';

/** Task catalog config is IT-only. */
function isIt(session: Awaited<ReturnType<typeof auth>>): boolean {
  const role = (session?.user as any)?.role as string | undefined;
  return role === 'it';
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isIt(session)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid task id' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.requiresLocation !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'requiresLocation (boolean) is required' },
      { status: 400 },
    );
  }

  try {
    const [updated] = await db
      .update(taskDefinitions)
      .set({ requiresLocation: body.requiresLocation, updatedAt: new Date() })
      .where(eq(taskDefinitions.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
    }

    const task: TaskDefinitionDTO = {
      id:          updated.id,
      code:        updated.code,
      label:       updated.label,
      description: updated.description,
      icon:        updated.icon,
      accent:      updated.accent,
      isPersonal:  updated.isPersonal,
      isActive:    updated.isActive,
      sortOrder:   updated.sortOrder,
      requiresLocation: updated.requiresLocation,
    };

    return NextResponse.json({ success: true, task });
  } catch (err) {
    console.error('PATCH /api/ops/task-definitions/[id] failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to update task' }, { status: 500 });
  }
}

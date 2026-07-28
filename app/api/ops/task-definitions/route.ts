// app/api/ops/task-definitions/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/task-definitions
// Full task-type catalog for the OPS "Task Management" settings page —
// distinct from /api/ops/shift-tasks, which is scoped to shift assignment.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';

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

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isIt(session)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const rows = await db
      .select()
      .from(taskDefinitions)
      .orderBy(asc(taskDefinitions.sortOrder), asc(taskDefinitions.id));

    const tasks: TaskDefinitionDTO[] = rows.map((r) => ({
      id:          r.id,
      code:        r.code,
      label:       r.label,
      description: r.description,
      icon:        r.icon,
      accent:      r.accent,
      isPersonal:  r.isPersonal,
      isActive:    r.isActive,
      sortOrder:   r.sortOrder,
      requiresLocation: r.requiresLocation,
    }));

    return NextResponse.json({ success: true, tasks });
  } catch (err) {
    console.error('GET /api/ops/task-definitions failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to load task definitions' }, { status: 500 });
  }
}

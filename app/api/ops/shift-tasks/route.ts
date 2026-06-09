// app/api/ops/shift-tasks/route.ts
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { shifts, shiftTasks, taskDefinitions } from '@/lib/db/schema';
import {
  normalizeShiftBreaks,
  type ShiftTasksPayload,
  type ShiftWithTasks,
  type ShiftTaskAssignment,
  type TaskDefinitionDTO,
} from '@/lib/shift-tasks';

export const dynamic = 'force-dynamic';

/** Shift & Task config is global → OPS Area, OPS HO, ops role, or admin. */
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

function safeBreaks(input: unknown) {
  const parsed = normalizeShiftBreaks(input);
  return parsed.ok ? parsed.breaks : [];
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isOps(session)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const [shiftRows, assignmentRows, catalogRows] = await Promise.all([
      db
        .select()
        .from(shifts)
        .orderBy(asc(shifts.sortOrder), asc(shifts.id)),

      db
        .select({
          id:               shiftTasks.id,
          shiftId:          shiftTasks.shiftId,
          taskDefinitionId: shiftTasks.taskDefinitionId,
          isRequired:       shiftTasks.isRequired,
          isActive:         shiftTasks.isActive,
          sortOrder:        shiftTasks.sortOrder,
          code:             taskDefinitions.code,
          label:            taskDefinitions.label,
          icon:             taskDefinitions.icon,
          accent:           taskDefinitions.accent,
          isPersonal:       taskDefinitions.isPersonal,
        })
        .from(shiftTasks)
        .innerJoin(taskDefinitions, eq(taskDefinitions.id, shiftTasks.taskDefinitionId))
        .where(and(eq(shiftTasks.isActive, true), eq(taskDefinitions.isActive, true)))
        .orderBy(asc(shiftTasks.sortOrder), asc(shiftTasks.id)),

      db
        .select()
        .from(taskDefinitions)
        .where(eq(taskDefinitions.isActive, true))
        .orderBy(asc(taskDefinitions.sortOrder), asc(taskDefinitions.id)),
    ]);

    const byShift = new Map<number, ShiftTaskAssignment[]>();
    for (const r of assignmentRows) {
      const list = byShift.get(r.shiftId) ?? [];
      list.push({
        id:               r.id,
        taskDefinitionId: r.taskDefinitionId,
        code:             r.code,
        label:            r.label,
        icon:             r.icon,
        accent:           r.accent,
        isPersonal:       r.isPersonal,
        isRequired:       r.isRequired,
        isActive:         r.isActive,
        sortOrder:        r.sortOrder,
      });
      byShift.set(r.shiftId, list);
    }

    const shiftsOut: ShiftWithTasks[] = shiftRows.map((s) => ({
      id:          s.id,
      code:        s.code,
      label:       s.label,
      description: s.description,
      startTime:   s.startTime,
      endTime:     s.endTime,
      accent:      (s as any).accent ?? null,
      icon:        (s as any).icon ?? null,
      breaks:      safeBreaks((s as any).breaks),
      isActive:    s.isActive,
      sortOrder:   s.sortOrder,
      tasks:       byShift.get(s.id) ?? [],
    }));

    const catalog: TaskDefinitionDTO[] = catalogRows.map((c) => ({
      id:          c.id,
      code:        c.code,
      label:       c.label,
      description: c.description,
      icon:        c.icon,
      accent:      c.accent,
      isPersonal:  c.isPersonal,
      isActive:    c.isActive,
      sortOrder:   c.sortOrder,
    }));

    const payload: ShiftTasksPayload = { success: true, shifts: shiftsOut, catalog };
    return NextResponse.json(payload);
  } catch (err) {
    console.error('GET /api/ops/shift-tasks failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to load shift tasks' }, { status: 500 });
  }
}

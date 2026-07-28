// app/api/ops/shift-tasks/shift/route.ts
import { NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { shifts, shiftTasks, taskDefinitions } from '@/lib/db/schema';
import {
  isPaletteKey,
  isValidShiftCode,
  normalizeShiftCode,
  normalizeShiftBreaks,
} from '@/lib/shift-tasks';

export const dynamic = 'force-dynamic';

function isIt(session: Awaited<ReturnType<typeof auth>>): boolean {
  const role = (session?.user as any)?.role as string | undefined;
  return role === 'it';
}

interface CreateBody {
  code?: string;
  label?: string;
  description?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  accent?: string | null;
  icon?: string | null;
  breaks?: unknown;
  sortOrder?: number;
  taskDefinitionIds?: number[];
}

export async function POST(req: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  if (!isIt(session)) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 },
    );
  }

  let body: CreateBody;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const label = body.label?.trim();

  if (!label) {
    return NextResponse.json(
      { success: false, error: 'Label is required' },
      { status: 400 },
    );
  }

  const code = normalizeShiftCode(body.code?.trim() || label);

  if (!isValidShiftCode(code)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Code must be lowercase letters, numbers and underscores',
      },
      { status: 400 },
    );
  }

  if (body.accent && !isPaletteKey(body.accent)) {
    return NextResponse.json(
      { success: false, error: `Unknown accent "${body.accent}"` },
      { status: 400 },
    );
  }

  const breaksResult = normalizeShiftBreaks(body.breaks);

  if (!breaksResult.ok) {
    return NextResponse.json(
      { success: false, error: breaksResult.error },
      { status: 400 },
    );
  }

  const userId = (session.user as any)?.id as string | undefined;

  const requestedTaskDefinitionIds = Array.from(
    new Set(body.taskDefinitionIds ?? []),
  ).filter((id) => Number.isInteger(id));

  try {
    /**
     * Neon HTTP driver does not support db.transaction().
     *
     * So we do this in normal sequential queries:
     * 1. create shift
     * 2. validate selected task definitions
     * 3. insert shift task assignments
     *
     * If assignment insert fails, the shift may still be created.
     * That is acceptable for this admin config screen because the user can edit
     * task assignments again from the UI.
     */
    const [createdShift] = await db
      .insert(shifts)
      .values({
        code,
        label,
        description: body.description ?? null,
        startTime: body.startTime ?? null,
        endTime: body.endTime ?? null,
        accent: body.accent ?? null,
        icon: body.icon ?? null,
        breaks: breaksResult.breaks.length ? breaksResult.breaks : null,
        sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder! : 0,
      })
      .returning();

    if (requestedTaskDefinitionIds.length) {
      const validTaskRows = await db
        .select({ id: taskDefinitions.id })
        .from(taskDefinitions)
        .where(inArray(taskDefinitions.id, requestedTaskDefinitionIds));

      const validTaskDefinitionIds = new Set(validTaskRows.map((row) => row.id));

      const assignmentRows = requestedTaskDefinitionIds
        .filter((id) => validTaskDefinitionIds.has(id))
        .map((taskDefinitionId, index) => ({
          shiftId: createdShift.id,
          taskDefinitionId,
          sortOrder: (index + 1) * 10,
          isRequired: true,
          isActive: true,
          assignedBy: userId ?? null,
        }));

      if (assignmentRows.length) {
        await db.insert(shiftTasks).values(assignmentRows);
      }
    }

    return NextResponse.json(
      {
        success: true,
        shift: createdShift,
      },
      { status: 201 },
    );
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        {
          success: false,
          error: `A shift with code "${code}" already exists`,
        },
        { status: 409 },
      );
    }

    console.error('POST /api/ops/shift-tasks/shift failed:', err);

    return NextResponse.json(
      { success: false, error: 'Failed to create shift' },
      { status: 500 },
    );
  }
}
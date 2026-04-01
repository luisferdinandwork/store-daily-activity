// app/api/employee/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { storeOpeningTasks, groomingTasks } from '@/lib/db/schema';
import { eq, and, gte, lte, desc, or } from 'drizzle-orm';
import { startOfDay, endOfDay } from '@/lib/schedule-utils';

// ─── GET /api/employee/tasks ──────────────────────────────────────────────────
//
// FIX (Bug 4): The previous implementation filtered tasks by storeId from the
// session (homeStoreId). This broke cross-store deployments where an employee's
// schedule is at a different store than their homeStoreId — the tasks existed
// in the DB but were never returned.
//
// Fix: filter by userId (the session user's own ID). Tasks are always owned by
// the user who needs to complete them, regardless of which store they're at
// this month. We still accept an optional ?date= param for date-scoped views,
// but fall back to today's tasks when omitted.
//
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');

  // When a date is provided, return tasks only for that day.
  // When omitted, return today's tasks (the common case for the employee app).
  const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
  const dayStart   = startOfDay(targetDate);
  const dayEnd     = endOfDay(targetDate);

  // ── Fetch both task types in parallel ─────────────────────────────────────
  const [openingRows, groomingRows] = await Promise.all([
    db
      .select()
      .from(storeOpeningTasks)
      .where(
        and(
          eq(storeOpeningTasks.userId, userId),
          gte(storeOpeningTasks.date, dayStart),
          lte(storeOpeningTasks.date, dayEnd),
        ),
      )
      .orderBy(desc(storeOpeningTasks.date)),

    db
      .select()
      .from(groomingTasks)
      .where(
        and(
          eq(groomingTasks.userId, userId),
          gte(groomingTasks.date, dayStart),
          lte(groomingTasks.date, dayEnd),
        ),
      )
      .orderBy(desc(groomingTasks.date)),
  ]);

  // ── Deserialise JSON photo columns ────────────────────────────────────────
  function parsePhotos(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; }
    catch { return []; }
  }

  // ── Shape into the discriminated union the frontend expects ───────────────
  const tasks = [
    ...openingRows.map(t => ({
      type: 'store_opening' as const,
      data: {
        id:               t.id,
        userId:           t.userId,
        storeId:          t.storeId,
        scheduleId:       t.scheduleId,
        attendanceId:     t.attendanceId,
        date:             t.date.toISOString(),
        shift:            t.shift,
        cashDrawerAmount: t.cashDrawerAmount,
        allLightsOn:      t.allLightsOn,
        cleanlinessCheck: t.cleanlinessCheck,
        equipmentCheck:   t.equipmentCheck,
        stockCheck:       t.stockCheck,
        safetyCheck:      t.safetyCheck,
        openingNotes:     t.openingNotes,
        storeFrontPhotos: parsePhotos(t.storeFrontPhotos),
        cashDrawerPhotos: parsePhotos(t.cashDrawerPhotos),
        status:           t.status,
        completedAt:      t.completedAt?.toISOString()  ?? null,
        verifiedBy:       t.verifiedBy,
        verifiedAt:       t.verifiedAt?.toISOString()   ?? null,
      },
    })),
    ...groomingRows.map(t => ({
      type: 'grooming' as const,
      data: {
        id:                   t.id,
        userId:               t.userId,
        storeId:              t.storeId,
        scheduleId:           t.scheduleId,
        attendanceId:         t.attendanceId,
        date:                 t.date.toISOString(),
        shift:                t.shift,
        uniformComplete:      t.uniformComplete,
        hairGroomed:          t.hairGroomed,
        nailsClean:           t.nailsClean,
        accessoriesCompliant: t.accessoriesCompliant,
        shoeCompliant:        t.shoeCompliant,
        groomingNotes:        t.groomingNotes,
        selfiePhotos:         parsePhotos(t.selfiePhotos),
        status:               t.status,
        completedAt:          t.completedAt?.toISOString()  ?? null,
        verifiedBy:           t.verifiedBy,
        verifiedAt:           t.verifiedAt?.toISOString()   ?? null,
      },
    })),
  ];

  // Sort: pending/in_progress first, then completed; within each group by shift
  const ORDER: Record<string, number> = { pending: 0, in_progress: 1, completed: 2 };
  tasks.sort((a, b) => (ORDER[a.data.status] ?? 9) - (ORDER[b.data.status] ?? 9));

  return NextResponse.json({ success: true, tasks });
}

// ─── PATCH /api/employee/tasks ────────────────────────────────────────────────
// Advance a task to in_progress (called when the employee opens it).
// The submit endpoints handle the completed transition.
//
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const { taskId, taskType, status } = await request.json();

  if (!taskId || !taskType || status !== 'in_progress') {
    return NextResponse.json(
      { error: 'taskId, taskType, and status=in_progress are required' },
      { status: 400 },
    );
  }

  if (taskType === 'store_opening') {
    // Verify ownership before updating
    const [row] = await db
      .select({ userId: storeOpeningTasks.userId, status: storeOpeningTasks.status })
      .from(storeOpeningTasks)
      .where(eq(storeOpeningTasks.id, taskId))
      .limit(1);

    if (!row)              return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (row.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (row.status !== 'pending') return NextResponse.json({ success: true }); // already advanced

    await db
      .update(storeOpeningTasks)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(eq(storeOpeningTasks.id, taskId));

  } else if (taskType === 'grooming') {
    const [row] = await db
      .select({ userId: groomingTasks.userId, status: groomingTasks.status })
      .from(groomingTasks)
      .where(eq(groomingTasks.id, taskId))
      .limit(1);

    if (!row)              return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (row.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (row.status !== 'pending') return NextResponse.json({ success: true });

    await db
      .update(groomingTasks)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(eq(groomingTasks.id, taskId));

  } else {
    return NextResponse.json({ error: `Unknown taskType: ${taskType}` }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
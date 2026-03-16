// app/api/employee/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  storeOpeningTasks,
  groomingTasks,
  schedules,
  attendance,
} from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employee/tasks?storeId=&date=
// Returns today's storeOpeningTask (morning only) + groomingTask for the
// authenticated employee's scheduled shift.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const storeId   = searchParams.get('storeId') ?? (session.user as any).storeId;
    const dateParam = searchParams.get('date');

    if (!storeId) {
      return NextResponse.json({ error: 'storeId is required' }, { status: 400 });
    }

    const userId     = session.user.id;
    const targetDate = dateParam ? new Date(dateParam) : new Date();
    const dayStart   = startOfDay(targetDate);
    const dayEnd     = endOfDay(targetDate);

    // ── Fetch storeOpeningTasks (morning shift only) ────────────────────────
    const openingRows = await db
      .select()
      .from(storeOpeningTasks)
      .where(
        and(
          eq(storeOpeningTasks.userId,  userId),
          eq(storeOpeningTasks.storeId, storeId),
          gte(storeOpeningTasks.date,   dayStart),
          lte(storeOpeningTasks.date,   dayEnd),
          eq(storeOpeningTasks.shift,   'morning'),
        ),
      );

    // ── Fetch groomingTasks (all shifts) ───────────────────────────────────
    const groomingRows = await db
      .select()
      .from(groomingTasks)
      .where(
        and(
          eq(groomingTasks.userId,  userId),
          eq(groomingTasks.storeId, storeId),
          gte(groomingTasks.date,   dayStart),
          lte(groomingTasks.date,   dayEnd),
        ),
      );

    // ── Normalise into a unified task list ────────────────────────────────
    const tasks = [
      ...openingRows.map((row) => ({
        type: 'store_opening' as const,
        data: {
          ...row,
          date:             row.date.toISOString(),
          completedAt:      row.completedAt?.toISOString()  ?? null,
          verifiedAt:       row.verifiedAt?.toISOString()   ?? null,
          storeFrontPhotos: parsePhotos(row.storeFrontPhotos),
          cashDrawerPhotos: parsePhotos(row.cashDrawerPhotos),
        },
      })),
      ...groomingRows.map((row) => ({
        type: 'grooming' as const,
        data: {
          ...row,
          date:        row.date.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          verifiedAt:  row.verifiedAt?.toISOString()  ?? null,
          selfiePhotos: parsePhotos(row.selfiePhotos),
        },
      })),
    ];

    // Sort: pending/in_progress first, completed last; then by shift
    tasks.sort((a, b) => {
      const order: Record<string, number> = { pending: 0, in_progress: 1, completed: 2 };
      return (order[a.data.status] ?? 0) - (order[b.data.status] ?? 0);
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('[GET /api/employee/tasks]', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/employee/tasks
// Transition status: pending → in_progress
// Body: { taskId, taskType: 'store_opening' | 'grooming', status: 'in_progress' }
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId, taskType, status } = await request.json();

    if (!taskId || !taskType || !status) {
      return NextResponse.json(
        { error: 'taskId, taskType, and status are required' },
        { status: 400 },
      );
    }

    if (status !== 'in_progress') {
      return NextResponse.json(
        { error: 'PATCH only supports transitioning to in_progress. Use POST to complete.' },
        { status: 400 },
      );
    }

    const userId = session.user.id;

    if (taskType === 'store_opening') {
      const [existing] = await db
        .select({ id: storeOpeningTasks.id })
        .from(storeOpeningTasks)
        .where(and(eq(storeOpeningTasks.id, taskId), eq(storeOpeningTasks.userId, userId)))
        .limit(1);

      if (!existing) {
        return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
      }

      await db
        .update(storeOpeningTasks)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(storeOpeningTasks.id, taskId));

    } else if (taskType === 'grooming') {
      const [existing] = await db
        .select({ id: groomingTasks.id })
        .from(groomingTasks)
        .where(and(eq(groomingTasks.id, taskId), eq(groomingTasks.userId, userId)))
        .limit(1);

      if (!existing) {
        return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
      }

      await db
        .update(groomingTasks)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(groomingTasks.id, taskId));

    } else {
      return NextResponse.json({ error: `Unknown taskType: ${taskType}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/employee/tasks]', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/employee/tasks
// Submit (complete) a task with form data + photo URLs.
//
// Body for store_opening:
// {
//   taskType: 'store_opening',
//   taskId: string,
//   cashDrawerAmount: number,
//   allLightsOn: boolean,
//   cleanlinessCheck: boolean,
//   equipmentCheck: boolean,
//   stockCheck: boolean,
//   safetyCheck: boolean,
//   openingNotes?: string,
//   storeFrontPhotos: string[],   ← URLs from /api/employee/tasks/upload
//   cashDrawerPhotos: string[],
// }
//
// Body for grooming:
// {
//   taskType: 'grooming',
//   taskId: string,
//   uniformComplete: boolean,
//   hairGroomed: boolean,
//   nailsClean: boolean,
//   accessoriesCompliant: boolean,
//   shoeCompliant: boolean,
//   groomingNotes?: string,
//   selfiePhotos: string[],       ← URLs from /api/employee/tasks/upload
// }
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body     = await request.json();
    const { taskType, taskId } = body;
    const userId   = session.user.id;

    if (!taskType || !taskId) {
      return NextResponse.json({ error: 'taskType and taskId are required' }, { status: 400 });
    }

    // ── Store Opening ─────────────────────────────────────────────────────
    if (taskType === 'store_opening') {
      const [row] = await db
        .select({ id: storeOpeningTasks.id, status: storeOpeningTasks.status })
        .from(storeOpeningTasks)
        .where(and(eq(storeOpeningTasks.id, taskId), eq(storeOpeningTasks.userId, userId)))
        .limit(1);

      if (!row)                    return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
      if (row.status === 'completed') return NextResponse.json({ error: 'Task already completed' }, { status: 400 });

      const {
        cashDrawerAmount, allLightsOn, cleanlinessCheck,
        equipmentCheck, stockCheck, safetyCheck,
        openingNotes, storeFrontPhotos, cashDrawerPhotos,
      } = body;

      // Basic validation
      if (
        cashDrawerAmount === undefined || cashDrawerAmount === null ||
        allLightsOn      === undefined ||
        cleanlinessCheck === undefined ||
        equipmentCheck   === undefined ||
        stockCheck       === undefined ||
        safetyCheck      === undefined
      ) {
        return NextResponse.json({ error: 'All checklist fields are required' }, { status: 400 });
      }
      if (!Array.isArray(storeFrontPhotos) || storeFrontPhotos.length < 1) {
        return NextResponse.json({ error: 'At least 1 store-front photo is required' }, { status: 400 });
      }
      if (!Array.isArray(cashDrawerPhotos) || cashDrawerPhotos.length < 1) {
        return NextResponse.json({ error: 'At least 1 cash drawer photo is required' }, { status: 400 });
      }

      await db
        .update(storeOpeningTasks)
        .set({
          cashDrawerAmount,
          allLightsOn,
          cleanlinessCheck,
          equipmentCheck,
          stockCheck,
          safetyCheck,
          openingNotes:     openingNotes ?? null,
          storeFrontPhotos: JSON.stringify(storeFrontPhotos),
          cashDrawerPhotos: JSON.stringify(cashDrawerPhotos),
          status:           'completed',
          completedAt:      new Date(),
          updatedAt:        new Date(),
        })
        .where(eq(storeOpeningTasks.id, taskId));

      return NextResponse.json({ success: true, message: 'Store opening task completed' });
    }

    // ── Grooming ──────────────────────────────────────────────────────────
    if (taskType === 'grooming') {
      const [row] = await db
        .select({ id: groomingTasks.id, status: groomingTasks.status })
        .from(groomingTasks)
        .where(and(eq(groomingTasks.id, taskId), eq(groomingTasks.userId, userId)))
        .limit(1);

      if (!row)                    return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
      if (row.status === 'completed') return NextResponse.json({ error: 'Task already completed' }, { status: 400 });

      const {
        uniformComplete, hairGroomed, nailsClean,
        accessoriesCompliant, shoeCompliant,
        groomingNotes, selfiePhotos,
      } = body;

      if (
        uniformComplete      === undefined ||
        hairGroomed          === undefined ||
        nailsClean           === undefined ||
        accessoriesCompliant === undefined ||
        shoeCompliant        === undefined
      ) {
        return NextResponse.json({ error: 'All grooming checklist fields are required' }, { status: 400 });
      }
      if (!Array.isArray(selfiePhotos) || selfiePhotos.length < 1) {
        return NextResponse.json({ error: 'At least 1 selfie photo is required' }, { status: 400 });
      }

      await db
        .update(groomingTasks)
        .set({
          uniformComplete,
          hairGroomed,
          nailsClean,
          accessoriesCompliant,
          shoeCompliant,
          groomingNotes: groomingNotes ?? null,
          selfiePhotos:  JSON.stringify(selfiePhotos),
          status:        'completed',
          completedAt:   new Date(),
          updatedAt:     new Date(),
        })
        .where(eq(groomingTasks.id, taskId));

      return NextResponse.json({ success: true, message: 'Grooming task completed' });
    }

    return NextResponse.json({ error: `Unknown taskType: ${taskType}` }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/employee/tasks]', error);
    return NextResponse.json({ error: 'Failed to complete task' }, { status: 500 });
  }
}
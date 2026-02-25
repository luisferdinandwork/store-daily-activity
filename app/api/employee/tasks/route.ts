// app/api/employee/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeTask, getEmployeeTasksForDate } from '@/lib/daily-task-utils';
import { db } from '@/lib/db';
import { employeeTasks, tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────
// GET /api/employee/tasks?storeId=&date=
// Returns today's assigned tasks for the authenticated employee
// ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId') ?? session.user.storeId;
    const dateParam = searchParams.get('date');

    if (!storeId) {
      return NextResponse.json({ error: 'Store ID is required' }, { status: 400 });
    }

    const targetDate = dateParam ? new Date(dateParam) : new Date();

    const rows = await getEmployeeTasksForDate(session.user.id, storeId, targetDate);

    // Normalise and parse JSON columns
    const assignedTasks = (rows as any[]).map((row) => ({
      task: {
        ...row.task,
        // parse JSON fields the client doesn't need raw
        recurrenceDays: row.task?.recurrenceDays
          ? JSON.parse(row.task.recurrenceDays)
          : null,
        formSchema: row.task?.formSchema
          ? JSON.parse(row.task.formSchema)
          : null,
      },
      employeeTask: {
        ...row.employeeTask,
        attachmentUrls: row.employeeTask?.attachmentUrls
          ? JSON.parse(row.employeeTask.attachmentUrls)
          : [],
        formData: row.employeeTask?.formData
          ? JSON.parse(row.employeeTask.formData)
          : null,
      },
      attendance: row.attendance ?? null,
      schedule: row.schedule ?? null,
    }));

    return NextResponse.json({ assignedTasks });
  } catch (error) {
    console.error('[GET /api/employee/tasks]', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// PATCH /api/employee/tasks
// Update task status (pending → in_progress)
// ─────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { taskId, status } = body;

    if (!taskId || !status) {
      return NextResponse.json(
        { error: 'taskId and status are required' },
        { status: 400 },
      );
    }

    // Verify the task belongs to this employee
    const [existing] = await db
      .select({ id: employeeTasks.id, userId: employeeTasks.userId })
      .from(employeeTasks)
      .where(
        and(
          eq(employeeTasks.id, taskId),
          eq(employeeTasks.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found or access denied' },
        { status: 404 },
      );
    }

    await db
      .update(employeeTasks)
      .set({
        status,
        updatedAt: new Date(),
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
      })
      .where(eq(employeeTasks.id, taskId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/employee/tasks]', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/employee/tasks
// Complete a task – supports form data AND attachments
// Body: { employeeTaskId, formData?, attachmentUrls?, notes? }
// ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { employeeTaskId, formData, attachmentUrls, notes } = body;

    if (!employeeTaskId) {
      return NextResponse.json(
        { error: 'employeeTaskId is required' },
        { status: 400 },
      );
    }

    // Verify ownership
    const [row] = await db
      .select({ et: employeeTasks, t: tasks })
      .from(employeeTasks)
      .innerJoin(tasks, eq(employeeTasks.taskId, tasks.id))
      .where(
        and(
          eq(employeeTasks.id, employeeTaskId),
          eq(employeeTasks.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: 'Task not found or access denied' },
        { status: 404 },
      );
    }

    if (row.et.status === 'completed') {
      return NextResponse.json(
        { error: 'Task is already completed' },
        { status: 400 },
      );
    }

    const result = await completeTask({
      employeeTaskId,
      formData,
      attachmentUrls,
      notes,
      completedBy: session.user.id,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Task completed successfully' });
  } catch (error) {
    console.error('[POST /api/employee/tasks]', error);
    return NextResponse.json({ error: 'Failed to complete task' }, { status: 500 });
  }
}
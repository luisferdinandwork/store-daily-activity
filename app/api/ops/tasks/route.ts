// app/api/ops/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, users } from '@/lib/db/schema';
import {
  createTaskTemplate,
  updateTaskTemplate,
  toggleTaskActive,
  type CreateTaskTemplateInput,
} from '@/lib/daily-task-utils';
import { eq, desc } from 'drizzle-orm';

// ──────────────────────────────────────────
// GET /api/ops/tasks
// Returns all task templates for the store's OPS user
// Query params: ?storeId=&recurrence=&role=&shift=&isActive=
// ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const recurrence = searchParams.get('recurrence');
    const role = searchParams.get('role');
    const shift = searchParams.get('shift');
    const isActiveParam = searchParams.get('isActive');

    const allTasks = await db
      .select({
        task: tasks,
        createdByUser: {
          id: users.id,
          name: users.name,
        },
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.createdBy, users.id))
      .orderBy(desc(tasks.createdAt));

    const filtered = allTasks.filter(({ task }) => {
      if (recurrence && task.recurrence !== recurrence) return false;
      if (role && task.role !== role) return false;
      if (shift && task.shift !== shift && task.shift !== null) return false;
      if (isActiveParam !== null && String(task.isActive) !== isActiveParam) return false;
      return true;
    });

    // Parse JSON fields before sending
    const result = filtered.map(({ task, createdByUser }) => ({
      ...task,
      recurrenceDays: task.recurrenceDays ? JSON.parse(task.recurrenceDays) : null,
      formSchema: task.formSchema ? JSON.parse(task.formSchema) : null,
      createdBy: createdByUser,
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[GET /api/ops/tasks]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch tasks' },
      { status: 500 },
    );
  }
}

// ──────────────────────────────────────────
// POST /api/ops/tasks
// Create a new task template
// ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateTaskTemplateInput;

    // Basic validation
    if (!body.title?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Title is required' },
        { status: 400 },
      );
    }
    if (!body.role) {
      return NextResponse.json(
        { success: false, error: 'Role is required' },
        { status: 400 },
      );
    }
    if (!body.recurrence) {
      return NextResponse.json(
        { success: false, error: 'Recurrence is required' },
        { status: 400 },
      );
    }
    if (!body.createdBy) {
      return NextResponse.json(
        { success: false, error: 'createdBy (OPS user ID) is required' },
        { status: 400 },
      );
    }

    const result = await createTaskTemplate(body);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json(
      { success: true, taskId: result.taskId },
      { status: 201 },
    );
  } catch (error) {
    console.error('[POST /api/ops/tasks]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create task' },
      { status: 500 },
    );
  }
}
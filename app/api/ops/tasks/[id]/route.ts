// app/api/ops/tasks/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, users } from '@/lib/db/schema';
import {
  updateTaskTemplate,
  toggleTaskActive,
  type CreateTaskTemplateInput,
} from '@/lib/daily-task-utils';
import { eq } from 'drizzle-orm';

type Params = { params: { id: string } };

// ──────────────────────────────────────────
// GET /api/ops/tasks/[id]
// ──────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const [row] = await db
      .select({
        task: tasks,
        createdByUser: { id: users.id, name: users.name },
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.createdBy, users.id))
      .where(eq(tasks.id, params.id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...row.task,
        recurrenceDays: row.task.recurrenceDays ? JSON.parse(row.task.recurrenceDays) : null,
        formSchema: row.task.formSchema ? JSON.parse(row.task.formSchema) : null,
        createdBy: row.createdByUser,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// PATCH /api/ops/tasks/[id]
// Update task fields OR toggle isActive
// ──────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const body = await request.json();

    // Special case: toggle active
    if (typeof body.isActive === 'boolean' && Object.keys(body).length === 1) {
      const result = await toggleTaskActive(params.id, body.isActive);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    // General update
    const result = await updateTaskTemplate(params.id, body as Partial<CreateTaskTemplateInput>);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// DELETE /api/ops/tasks/[id]
// Soft-delete by setting isActive = false
// ──────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const result = await toggleTaskActive(params.id, false);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, message: 'Task deactivated' });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
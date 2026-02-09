// app/api/employee/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { 
  completeTask,
  getEmployeeTasksForDate, 
  verifyTask 
} from '@/lib/daily-task-utils';
import { db } from '@/lib/db';
import { employeeTasks, tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// GET: Fetch tasks for the current employee
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const storeId = searchParams.get('storeId');
    
    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      );
    }
    
    const targetDate = date ? new Date(date) : new Date();
    
    // Get employee tasks for the date
    const employeeTasks = await getEmployeeTasksForDate(
      session.user.id,
      storeId,
      targetDate
    );
    
    // Get daily task templates that match this employee
    const dailyTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.isDaily, true));
    
    // Format the response
    const formattedTasks = employeeTasks.map(item => ({
      task: item.task,
      employeeTask: item.employeeTask,
      attendance: item.attendance
    }));
    
    return NextResponse.json({
      assignedTasks: formattedTasks,
      dailyTasks: dailyTasks,
    });
  } catch (error) {
    console.error('Error fetching employee tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

// PATCH: Update task status
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { taskId, status, notes, attachmentUrls } = body;
    
    if (!taskId || !status) {
      return NextResponse.json(
        { error: 'Task ID and status are required' },
        { status: 400 }
      );
    }
    
    // If completing the task, use the completeTask function
    if (status === 'completed') {
      const result = await completeTask({
        employeeTaskId: taskId,
        formData: body.formData,
        attachmentUrls,
        notes,
        completedBy: session.user.id
      });
      
      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }
    } else {
      // For other status updates, directly update the database
      await db
        .update(employeeTasks)
        .set({
          status,
          updatedAt: new Date(),
          ...(status === 'completed' && { completedAt: new Date() })
        })
        .where(eq(employeeTasks.id, taskId));
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}

// POST: Complete a task with form data and attachments
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { employeeTaskId, attachmentUrls, notes } = body;
    
    if (!employeeTaskId) {
      return NextResponse.json(
        { error: 'Employee task ID is required' },
        { status: 400 }
      );
    }
    
    // First, verify that the task exists and belongs to the current user
    const task = await db
      .select({
        employeeTask: employeeTasks,
        task: tasks
      })
      .from(employeeTasks)
      .innerJoin(tasks, eq(employeeTasks.taskId, tasks.id))
      .where(
        and(
          eq(employeeTasks.id, employeeTaskId),
          eq(employeeTasks.userId, session.user.id)
        )
      )
      .limit(1);
    
    if (!task || task.length === 0) {
      return NextResponse.json(
        { error: 'Task not found or access denied' },
        { status: 404 }
      );
    }
    
    // Check if the task is already completed
    if (task[0].employeeTask.status === 'completed') {
      return NextResponse.json(
        { error: 'Task is already completed' },
        { status: 400 }
      );
    }
    
    // Validate required attachments if the task requires them
    if (task[0].task.requiresAttachment && (!attachmentUrls || attachmentUrls.length === 0)) {
      return NextResponse.json(
        { error: 'This task requires at least one attachment' },
        { status: 400 }
      );
    }
    
    // Update the task with completion data
    await db
      .update(employeeTasks)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
        // Convert attachmentUrls array to JSON string for storage
        attachmentUrls: attachmentUrls && attachmentUrls.length > 0 
          ? JSON.stringify(attachmentUrls) 
          : null,
        notes: notes || null
      })
      .where(eq(employeeTasks.id, employeeTaskId));
    
    return NextResponse.json({ 
      success: true,
      message: 'Task completed successfully'
    });
  } catch (error) {
    console.error('Error completing task:', error);
    return NextResponse.json(
      { error: 'Failed to complete task' },
      { status: 500 }
    );
  }
}
// lib/daily-task-utils.ts
import { db } from '@/lib/db';
import { 
  tasks, 
  employeeTasks, 
  schedules, 
  attendance, 
  users 
} from '@/lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export interface TaskFormField {
  id: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'time';
  label: string;
  required: boolean;
  options?: string[]; // For select fields
  placeholder?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface TaskFormSchema {
  fields: TaskFormField[];
}

export interface TaskCompletionData {
  employeeTaskId: string;
  formData?: Record<string, any>;
  attachmentUrls?: string[];
  notes?: string;
  completedBy: string;
}

/**
 * Generate daily tasks for all scheduled employees on a specific date
 * This should be called by OPS at the beginning of each day or scheduled via cron
 */
export async function generateDailyTasksForDate(
  storeId: string,
  date: Date,
  createdBy: string
): Promise<{ success: boolean; tasksCreated: number; errors?: string[] }> {
  try {
    const errors: string[] = [];
    let tasksCreated = 0;

    // Get all schedules for this date and store
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(date);
    dateEnd.setHours(23, 59, 59, 999);

    const schedulesForDate = await db
      .select({
        schedule: schedules,
        user: users,
      })
      .from(schedules)
      .leftJoin(users, eq(schedules.userId, users.id))
      .where(
        and(
          eq(schedules.storeId, storeId),
          gte(schedules.date, dateStart),
          lte(schedules.date, dateEnd),
          eq(schedules.isHoliday, false)
        )
      );

    if (schedulesForDate.length === 0) {
      return { success: true, tasksCreated: 0 };
    }

    // Get all daily tasks
    const dailyTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.isDaily, true));

    // For each schedule, assign matching tasks
    for (const { schedule, user } of schedulesForDate) {
      if (!user) continue;

      // Filter tasks that match this employee's role, type, and shift
      const matchingTasks = dailyTasks.filter((task) => {
        const roleMatch = task.role === user.role;
        const typeMatch = !task.employeeType || task.employeeType === user.employeeType;
        const shiftMatch = !task.shift || task.shift === schedule.shift;
        return roleMatch && typeMatch && shiftMatch;
      });

      // Create employee tasks
      for (const task of matchingTasks) {
        try {
          await db.insert(employeeTasks).values({
            taskId: task.id,
            userId: user.id,
            storeId: storeId,
            scheduleId: schedule.id,
            date: schedule.date,
            shift: schedule.shift,
            status: 'pending',
          });
          tasksCreated++;
        } catch (error) {
          errors.push(`Failed to create task ${task.title} for ${user.name}: ${error}`);
        }
      }
    }

    return { 
      success: errors.length === 0, 
      tasksCreated,
      ...(errors.length > 0 && { errors })
    };
  } catch (error) {
    return { 
      success: false, 
      tasksCreated: 0, 
      errors: [`Failed to generate daily tasks: ${error}`] 
    };
  }
}

/**
 * Auto-assign tasks to a specific employee when they're added to the schedule
 */
export async function assignTasksToSchedule(
  scheduleId: string,
  userId: string,
  storeId: string,
  shift: 'morning' | 'evening',
  date: Date
): Promise<{ success: boolean; tasksCreated: number }> {
  try {
    // Get user info
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new Error('User not found');
    }

    // Get all daily tasks that match this employee
    const dailyTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.isDaily, true));

    const matchingTasks = dailyTasks.filter((task) => {
      const roleMatch = task.role === user.role;
      const typeMatch = !task.employeeType || task.employeeType === user.employeeType;
      const shiftMatch = !task.shift || task.shift === shift;
      return roleMatch && typeMatch && shiftMatch;
    });

    let tasksCreated = 0;
    for (const task of matchingTasks) {
      await db.insert(employeeTasks).values({
        taskId: task.id,
        userId: userId,
        storeId: storeId,
        scheduleId: scheduleId,
        date: date,
        shift: shift,
        status: 'pending',
      });
      tasksCreated++;
    }

    return { success: true, tasksCreated };
  } catch (error) {
    console.error('Error assigning tasks to schedule:', error);
    return { success: false, tasksCreated: 0 };
  }
}

/**
 * Record attendance for a scheduled employee
 */
export async function recordAttendance(
  scheduleId: string,
  status: 'present' | 'absent' | 'late' | 'excused',
  checkInTime?: Date,
  recordedBy?: string,
  notes?: string
): Promise<{ success: boolean; attendanceId?: string; error?: string }> {
  try {
    // Get schedule details
    const [schedule] = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);

    if (!schedule) {
      return { success: false, error: 'Schedule not found' };
    }

    // Check if attendance already exists
    const existing = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, scheduleId))
      .limit(1);

    let attendanceId: string;

    if (existing.length > 0) {
      // Update existing attendance
      await db
        .update(attendance)
        .set({
          status,
          checkInTime: checkInTime || existing[0].checkInTime,
          notes,
          recordedBy,
          updatedAt: new Date(),
        })
        .where(eq(attendance.id, existing[0].id));
      attendanceId = existing[0].id;
    } else {
      // Create new attendance record
      const [newAttendance] = await db
        .insert(attendance)
        .values({
          scheduleId: schedule.id,
          userId: schedule.userId,
          storeId: schedule.storeId,
          date: schedule.date,
          shift: schedule.shift,
          status,
          checkInTime,
          notes,
          recordedBy,
        })
        .returning({ id: attendance.id });
      attendanceId = newAttendance.id;
    }

    // Link attendance to employee tasks
    await db
      .update(employeeTasks)
      .set({ attendanceId })
      .where(
        and(
          eq(employeeTasks.scheduleId, scheduleId),
          eq(employeeTasks.userId, schedule.userId)
        )
      );

    return { success: true, attendanceId };
  } catch (error) {
    return { success: false, error: `Failed to record attendance: ${error}` };
  }
}

/**
 * Mark attendance checkout
 */
export async function checkoutAttendance(
  attendanceId: string,
  checkOutTime: Date
): Promise<{ success: boolean; error?: string }> {
  try {
    await db
      .update(attendance)
      .set({
        checkOutTime,
        updatedAt: new Date(),
      })
      .where(eq(attendance.id, attendanceId));

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to checkout: ${error}` };
  }
}

/**
 * Submit task completion with form data and attachments
 */
export async function completeTask(
  completionData: TaskCompletionData
): Promise<{ success: boolean; error?: string }> {
  try {
    const { employeeTaskId, formData, attachmentUrls, notes, completedBy } = completionData;

    // Get the employee task and associated task
    const [employeeTask] = await db
      .select({
        employeeTask: employeeTasks,
        task: tasks,
      })
      .from(employeeTasks)
      .leftJoin(tasks, eq(employeeTasks.taskId, tasks.id))
      .where(eq(employeeTasks.id, employeeTaskId))
      .limit(1);

    if (!employeeTask) {
      return { success: false, error: 'Task not found' };
    }

    // Validate form data if required
    if (employeeTask.task?.requiresForm && !formData) {
      return { success: false, error: 'Form data is required for this task' };
    }

    // Validate attachments if required
    if (employeeTask.task?.requiresAttachment && (!attachmentUrls || attachmentUrls.length === 0)) {
      return { success: false, error: 'Attachment is required for this task' };
    }

    // Validate attachment count
    if (attachmentUrls && employeeTask.task?.maxAttachments) {
      if (attachmentUrls.length > employeeTask.task.maxAttachments) {
        return { 
          success: false, 
          error: `Maximum ${employeeTask.task.maxAttachments} attachments allowed` 
        };
      }
    }

    // Validate form schema if exists
    if (employeeTask.task?.formSchema && formData) {
      const schema: TaskFormSchema = JSON.parse(employeeTask.task.formSchema);
      const validationError = validateFormData(formData, schema);
      if (validationError) {
        return { success: false, error: validationError };
      }
    }

    // Update employee task
    await db
      .update(employeeTasks)
      .set({
        status: 'completed',
        completedAt: new Date(),
        formData: formData ? JSON.stringify(formData) : null,
        attachmentUrls: attachmentUrls ? JSON.stringify(attachmentUrls) : null,
        notes,
        updatedAt: new Date(),
      })
      .where(eq(employeeTasks.id, employeeTaskId));

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to complete task: ${error}` };
  }
}

/**
 * Validate form data against schema
 */
function validateFormData(
  formData: Record<string, any>,
  schema: TaskFormSchema
): string | null {
  for (const field of schema.fields) {
    const value = formData[field.id];

    // Check required fields
    if (field.required && (value === undefined || value === null || value === '')) {
      return `${field.label} is required`;
    }

    // Type validation
    if (value !== undefined && value !== null) {
      switch (field.type) {
        case 'number':
          if (typeof value !== 'number' && isNaN(Number(value))) {
            return `${field.label} must be a number`;
          }
          if (field.validation?.min !== undefined && Number(value) < field.validation.min) {
            return `${field.label} must be at least ${field.validation.min}`;
          }
          if (field.validation?.max !== undefined && Number(value) > field.validation.max) {
            return `${field.label} must be at most ${field.validation.max}`;
          }
          break;
        case 'select':
          if (field.options && !field.options.includes(value)) {
            return `Invalid value for ${field.label}`;
          }
          break;
      }
    }
  }

  return null;
}

/**
 * Verify a completed task (for OPS)
 */
export async function verifyTask(
  employeeTaskId: string,
  verifiedBy: string,
  approved: boolean,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await db
      .update(employeeTasks)
      .set({
        verifiedBy,
        verifiedAt: new Date(),
        status: approved ? 'completed' : 'pending',
        notes: notes || undefined,
        updatedAt: new Date(),
      })
      .where(eq(employeeTasks.id, employeeTaskId));

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to verify task: ${error}` };
  }
}

/**
 * Get tasks for an employee on a specific date
 */
export async function getEmployeeTasksForDate(
  userId: string,
  storeId: string,
  date: Date
): Promise<any[]> {
  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const tasksForDate = await db
    .select({
      employeeTask: employeeTasks,
      task: tasks,
      schedule: schedules,
      attendance: attendance,
    })
    .from(employeeTasks)
    .leftJoin(tasks, eq(employeeTasks.taskId, tasks.id))
    .leftJoin(schedules, eq(employeeTasks.scheduleId, schedules.id))
    .leftJoin(attendance, eq(employeeTasks.attendanceId, attendance.id))
    .where(
      and(
        eq(employeeTasks.userId, userId),
        eq(employeeTasks.storeId, storeId),
        gte(employeeTasks.date, dateStart),
        lte(employeeTasks.date, dateEnd)
      )
    );

  return tasksForDate;
}

/**
 * Get task statistics for a store on a specific date
 */
export async function getTaskStatistics(
  storeId: string,
  date: Date
): Promise<{
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  completionRate: number;
}> {
  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const stats = await db
    .select({
      status: employeeTasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(employeeTasks)
    .where(
      and(
        eq(employeeTasks.storeId, storeId),
        gte(employeeTasks.date, dateStart),
        lte(employeeTasks.date, dateEnd)
      )
    )
    .groupBy(employeeTasks.status);

  const total = stats.reduce((sum, s) => sum + s.count, 0);
  const pending = stats.find(s => s.status === 'pending')?.count || 0;
  const inProgress = stats.find(s => s.status === 'in_progress')?.count || 0;
  const completed = stats.find(s => s.status === 'completed')?.count || 0;
  const completionRate = total > 0 ? (completed / total) * 100 : 0;

  return {
    total,
    pending,
    inProgress,
    completed,
    completionRate,
  };
}

/**
 * Create a new task template (for OPS)
 */
export async function createTaskTemplate(
  taskData: {
    title: string;
    description?: string;
    role: 'employee' | 'ops' | 'finance' | 'admin';
    employeeType?: 'pic' | 'so';
    shift?: 'morning' | 'evening';
    isDaily?: boolean;
    requiresForm?: boolean;
    formSchema?: TaskFormSchema;
    requiresAttachment?: boolean;
    maxAttachments?: number;
    createdBy: string;
  }
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    const [newTask] = await db
      .insert(tasks)
      .values({
        title: taskData.title,
        description: taskData.description,
        role: taskData.role,
        employeeType: taskData.employeeType,
        shift: taskData.shift,
        isDaily: taskData.isDaily ?? true,
        requiresForm: taskData.requiresForm ?? false,
        formSchema: taskData.formSchema ? JSON.stringify(taskData.formSchema) : null,
        requiresAttachment: taskData.requiresAttachment ?? false,
        maxAttachments: taskData.maxAttachments ?? 1,
        createdBy: taskData.createdBy,
      })
      .returning({ id: tasks.id });

    return { success: true, taskId: newTask.id };
  } catch (error) {
    return { success: false, error: `Failed to create task: ${error}` };
  }
}

/**
 * Get attendance summary for a date range
 */
export async function getAttendanceSummary(
  storeId: string,
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<any[]> {
  const query = db
    .select({
      attendance: attendance,
      user: users,
      schedule: schedules,
    })
    .from(attendance)
    .leftJoin(users, eq(attendance.userId, users.id))
    .leftJoin(schedules, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(attendance.storeId, storeId),
        gte(attendance.date, startDate),
        lte(attendance.date, endDate),
        userId ? eq(attendance.userId, userId) : undefined
      )
    );

  return await query;
}
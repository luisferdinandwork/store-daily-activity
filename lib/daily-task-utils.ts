// lib/daily-task-utils.ts
import { db } from '@/lib/db';
import {
  tasks,
  employeeTasks,
  schedules,
  attendance,
  users,
  type TaskFormSchema,
  type TaskRecurrence,
} from '@/lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────
// Recurrence helpers
// ─────────────────────────────────────────────────────────────

/**
 * Returns true when a task with the given recurrence / recurrenceDays
 * should be generated on `date`.
 *
 * daily   → always true
 * weekly  → recurrenceDays contains the weekday number (0=Sun … 6=Sat)
 * monthly → recurrenceDays contains the calendar day number (1–31)
 */
export function shouldTaskRunOnDate(
  recurrence: TaskRecurrence,
  recurrenceDays: string | null,
  date: Date,
): boolean {
  if (recurrence === 'daily') return true;

  if (!recurrenceDays) return false;

  let days: number[];
  try {
    days = JSON.parse(recurrenceDays) as number[];
  } catch {
    return false;
  }

  if (recurrence === 'weekly') {
    return days.includes(date.getDay()); // 0=Sunday
  }

  if (recurrence === 'monthly') {
    return days.includes(date.getDate()); // 1-31
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
// Task generation
// ─────────────────────────────────────────────────────────────

/**
 * Generate tasks for ALL scheduled employees on a specific date.
 * Handles daily, weekly, and monthly recurrence.
 * Should be called by OPS or via cron job each morning.
 */
export async function generateDailyTasksForDate(
  storeId: string,
  date: Date,
  createdBy: string,
): Promise<{ success: boolean; tasksCreated: number; errors?: string[] }> {
  try {
    const errors: string[] = [];
    let tasksCreated = 0;

    const dateStart = startOfDay(date);
    const dateEnd = endOfDay(date);

    // Fetch schedules for this store / date
    const schedulesForDate = await db
      .select({ schedule: schedules, user: users })
      .from(schedules)
      .leftJoin(users, eq(schedules.userId, users.id))
      .where(
        and(
          eq(schedules.storeId, storeId),
          gte(schedules.date, dateStart),
          lte(schedules.date, dateEnd),
          eq(schedules.isHoliday, false),
        ),
      );

    if (schedulesForDate.length === 0) {
      return { success: true, tasksCreated: 0 };
    }

    // Fetch ALL active tasks (daily + weekly + monthly)
    const allTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.isActive, true));

    // Filter to only tasks that run today
    const tasksForToday = allTasks.filter((task) =>
      shouldTaskRunOnDate(task.recurrence, task.recurrenceDays, date),
    );

    for (const { schedule, user } of schedulesForDate) {
      if (!user) continue;

      const matchingTasks = tasksForToday.filter((task) =>
        taskMatchesEmployee(task, user, schedule.shift),
      );

      for (const task of matchingTasks) {
        // Avoid duplicates (idempotent — safe to call multiple times)
        const existing = await db
          .select({ id: employeeTasks.id })
          .from(employeeTasks)
          .where(
            and(
              eq(employeeTasks.taskId, task.id),
              eq(employeeTasks.userId, user.id),
              eq(employeeTasks.scheduleId, schedule.id),
            ),
          )
          .limit(1);

        if (existing.length > 0) continue;

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
          errors.push(
            `Failed to create task "${task.title}" for ${user.name}: ${error}`,
          );
        }
      }
    }

    return {
      success: errors.length === 0,
      tasksCreated,
      ...(errors.length > 0 && { errors }),
    };
  } catch (error) {
    return {
      success: false,
      tasksCreated: 0,
      errors: [`Failed to generate tasks: ${error}`],
    };
  }
}

/**
 * Auto-assign tasks to a specific employee when they're added to the schedule.
 */
export async function assignTasksToSchedule(
  scheduleId: string,
  userId: string,
  storeId: string,
  shift: 'morning' | 'evening',
  date: Date,
): Promise<{ success: boolean; tasksCreated: number }> {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new Error('User not found');

    const allTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.isActive, true));

    const matchingTasks = allTasks.filter(
      (task) =>
        shouldTaskRunOnDate(task.recurrence, task.recurrenceDays, date) &&
        taskMatchesEmployee(task, user, shift),
    );

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

// ─────────────────────────────────────────────────────────────
// Attendance
// ─────────────────────────────────────────────────────────────

export async function recordAttendance(
  scheduleId: string,
  status: 'present' | 'absent' | 'late' | 'excused',
  checkInTime?: Date,
  recordedBy?: string,
  notes?: string,
): Promise<{ success: boolean; attendanceId?: string; error?: string }> {
  try {
    const [schedule] = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);

    if (!schedule) return { success: false, error: 'Schedule not found' };

    const existing = await db
      .select()
      .from(attendance)
      .where(eq(attendance.scheduleId, scheduleId))
      .limit(1);

    let attendanceId: string;

    if (existing.length > 0) {
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

    await db
      .update(employeeTasks)
      .set({ attendanceId })
      .where(
        and(
          eq(employeeTasks.scheduleId, scheduleId),
          eq(employeeTasks.userId, schedule.userId),
        ),
      );

    return { success: true, attendanceId };
  } catch (error) {
    return { success: false, error: `Failed to record attendance: ${error}` };
  }
}

export async function checkoutAttendance(
  attendanceId: string,
  checkOutTime: Date,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db
      .update(attendance)
      .set({ checkOutTime, updatedAt: new Date() })
      .where(eq(attendance.id, attendanceId));
    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to checkout: ${error}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Task completion
// ─────────────────────────────────────────────────────────────

export interface TaskCompletionData {
  employeeTaskId: string;
  formData?: Record<string, unknown>;
  attachmentUrls?: string[];
  notes?: string;
  completedBy: string;
}

export async function completeTask(
  completionData: TaskCompletionData,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { employeeTaskId, formData, attachmentUrls, notes } = completionData;

    const [employeeTask] = await db
      .select({ employeeTask: employeeTasks, task: tasks })
      .from(employeeTasks)
      .leftJoin(tasks, eq(employeeTasks.taskId, tasks.id))
      .where(eq(employeeTasks.id, employeeTaskId))
      .limit(1);

    if (!employeeTask) return { success: false, error: 'Task not found' };

    if (employeeTask.task?.requiresForm && !formData) {
      return { success: false, error: 'Form data is required for this task' };
    }

    if (
      employeeTask.task?.requiresAttachment &&
      (!attachmentUrls || attachmentUrls.length === 0)
    ) {
      return { success: false, error: 'Attachment is required for this task' };
    }

    if (attachmentUrls && employeeTask.task?.maxAttachments) {
      if (attachmentUrls.length > employeeTask.task.maxAttachments) {
        return {
          success: false,
          error: `Maximum ${employeeTask.task.maxAttachments} attachments allowed`,
        };
      }
    }

    if (employeeTask.task?.formSchema && formData) {
      const schema: TaskFormSchema = JSON.parse(employeeTask.task.formSchema);
      const validationError = validateFormData(
        formData as Record<string, unknown>,
        schema,
      );
      if (validationError) return { success: false, error: validationError };
    }

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

// ─────────────────────────────────────────────────────────────
// Task verification (OPS)
// ─────────────────────────────────────────────────────────────

export async function verifyTask(
  employeeTaskId: string,
  verifiedBy: string,
  approved: boolean,
  notes?: string,
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

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

export async function getEmployeeTasksForDate(
  userId: string,
  storeId: string,
  date: Date,
): Promise<unknown[]> {
  return db
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
        gte(employeeTasks.date, startOfDay(date)),
        lte(employeeTasks.date, endOfDay(date)),
      ),
    );
}

export async function getTaskStatistics(
  storeId: string,
  date: Date,
): Promise<{
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  completionRate: number;
}> {
  const stats = await db
    .select({
      status: employeeTasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(employeeTasks)
    .where(
      and(
        eq(employeeTasks.storeId, storeId),
        gte(employeeTasks.date, startOfDay(date)),
        lte(employeeTasks.date, endOfDay(date)),
      ),
    )
    .groupBy(employeeTasks.status);

  const total = stats.reduce((sum, s) => sum + s.count, 0);
  const pending = stats.find((s) => s.status === 'pending')?.count || 0;
  const inProgress = stats.find((s) => s.status === 'in_progress')?.count || 0;
  const completed = stats.find((s) => s.status === 'completed')?.count || 0;

  return {
    total,
    pending,
    inProgress,
    completed,
    completionRate: total > 0 ? (completed / total) * 100 : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Task template CRUD
// ─────────────────────────────────────────────────────────────

export interface CreateTaskTemplateInput {
  title: string;
  description?: string;
  role: 'employee' | 'ops' | 'finance' | 'admin';
  employeeType?: 'pic' | 'so';
  shift?: 'morning' | 'evening';
  recurrence: TaskRecurrence;
  /**
   * daily   → undefined / null
   * weekly  → array of weekday numbers [0-6]
   * monthly → array of calendar day numbers [1-31]
   */
  recurrenceDays?: number[];
  requiresForm?: boolean;
  formSchema?: TaskFormSchema;
  requiresAttachment?: boolean;
  maxAttachments?: number;
  createdBy: string;
}

export async function createTaskTemplate(
  data: CreateTaskTemplateInput,
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    if (data.recurrence !== 'daily' && (!data.recurrenceDays || data.recurrenceDays.length === 0)) {
      return {
        success: false,
        error: 'recurrenceDays is required for weekly and monthly tasks',
      };
    }

    if (data.recurrence === 'weekly') {
      const invalid = data.recurrenceDays!.some((d) => d < 0 || d > 6);
      if (invalid) return { success: false, error: 'Weekly days must be 0-6 (Sun-Sat)' };
    }

    if (data.recurrence === 'monthly') {
      const invalid = data.recurrenceDays!.some((d) => d < 1 || d > 31);
      if (invalid) return { success: false, error: 'Monthly days must be 1-31' };
    }

    const [newTask] = await db
      .insert(tasks)
      .values({
        title: data.title,
        description: data.description,
        role: data.role,
        employeeType: data.employeeType,
        shift: data.shift,
        recurrence: data.recurrence,
        recurrenceDays:
          data.recurrence !== 'daily' && data.recurrenceDays
            ? JSON.stringify(data.recurrenceDays)
            : null,
        isActive: true,
        requiresForm: data.requiresForm ?? false,
        formSchema: data.formSchema ? JSON.stringify(data.formSchema) : null,
        requiresAttachment: data.requiresAttachment ?? false,
        maxAttachments: data.maxAttachments ?? 1,
        createdBy: data.createdBy,
      })
      .returning({ id: tasks.id });

    return { success: true, taskId: newTask.id };
  } catch (error) {
    return { success: false, error: `Failed to create task: ${error}` };
  }
}

export async function updateTaskTemplate(
  taskId: string,
  data: Partial<CreateTaskTemplateInput>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateValues: Partial<typeof tasks.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) updateValues.title = data.title;
    if (data.description !== undefined) updateValues.description = data.description;
    if (data.role !== undefined) updateValues.role = data.role;
    if (data.employeeType !== undefined) updateValues.employeeType = data.employeeType;
    if (data.shift !== undefined) updateValues.shift = data.shift;
    if (data.recurrence !== undefined) updateValues.recurrence = data.recurrence;
    if (data.recurrenceDays !== undefined) {
      updateValues.recurrenceDays =
        data.recurrenceDays.length > 0 ? JSON.stringify(data.recurrenceDays) : null;
    }
    if (data.requiresForm !== undefined) updateValues.requiresForm = data.requiresForm;
    if (data.formSchema !== undefined) {
      updateValues.formSchema = data.formSchema ? JSON.stringify(data.formSchema) : null;
    }
    if (data.requiresAttachment !== undefined)
      updateValues.requiresAttachment = data.requiresAttachment;
    if (data.maxAttachments !== undefined) updateValues.maxAttachments = data.maxAttachments;

    await db.update(tasks).set(updateValues).where(eq(tasks.id, taskId));

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to update task: ${error}` };
  }
}

export async function toggleTaskActive(
  taskId: string,
  isActive: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db
      .update(tasks)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to update task: ${error}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Attendance summary
// ─────────────────────────────────────────────────────────────

export async function getAttendanceSummary(
  storeId: string,
  startDate: Date,
  endDate: Date,
  userId?: string,
): Promise<unknown[]> {
  return db
    .select({ attendance, user: users, schedule: schedules })
    .from(attendance)
    .leftJoin(users, eq(attendance.userId, users.id))
    .leftJoin(schedules, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(attendance.storeId, storeId),
        gte(attendance.date, startDate),
        lte(attendance.date, endDate),
        userId ? eq(attendance.userId, userId) : undefined,
      ),
    );
}

// ─────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function taskMatchesEmployee(
  task: { role: string; employeeType: string | null; shift: string | null },
  user: { role: string; employeeType: string | null },
  shift: string,
): boolean {
  const roleMatch = task.role === user.role;
  const typeMatch = !task.employeeType || task.employeeType === user.employeeType;
  const shiftMatch = !task.shift || task.shift === shift;
  return roleMatch && typeMatch && shiftMatch;
}

function validateFormData(
  formData: Record<string, unknown>,
  schema: TaskFormSchema,
): string | null {
  for (const field of schema.fields) {
    const value = formData[field.id];

    if (field.required && (value === undefined || value === null || value === '')) {
      return `${field.label} is required`;
    }

    if (value !== undefined && value !== null) {
      if (field.type === 'number') {
        if (typeof value !== 'number' && isNaN(Number(value))) {
          return `${field.label} must be a number`;
        }
        if (field.validation?.min !== undefined && Number(value) < field.validation.min) {
          return `${field.label} must be at least ${field.validation.min}`;
        }
        if (field.validation?.max !== undefined && Number(value) > field.validation.max) {
          return `${field.label} must be at most ${field.validation.max}`;
        }
      }
      if (field.type === 'select' && field.options && !field.options.includes(String(value))) {
        return `Invalid value for ${field.label}`;
      }
    }
  }
  return null;
}
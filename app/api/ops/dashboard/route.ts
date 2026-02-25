// app/api/ops/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, employeeTasks, schedules, attendance, users } from '@/lib/db/schema';
import { getTaskStatistics } from '@/lib/daily-task-utils';
import { eq, and, gte, lte, sql, count } from 'drizzle-orm';

/**
 * GET /api/ops/dashboard?storeId=&date=
 * Returns aggregated stats for the OPS dashboard.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId');
    const dateParam = searchParams.get('date');

    if (!storeId) {
      return NextResponse.json({ success: false, error: 'storeId is required' }, { status: 400 });
    }

    const date = dateParam ? new Date(dateParam) : new Date();
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(date);
    dateEnd.setHours(23, 59, 59, 999);

    // Task stats for today
    const taskStats = await getTaskStatistics(storeId, date);

    // Attendance stats for today
    const attendanceStats = await db
      .select({
        status: attendance.status,
        count: sql<number>`count(*)::int`,
      })
      .from(attendance)
      .where(
        and(
          eq(attendance.storeId, storeId),
          gte(attendance.date, dateStart),
          lte(attendance.date, dateEnd),
        ),
      )
      .groupBy(attendance.status);

    const totalScheduled = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schedules)
      .where(
        and(
          eq(schedules.storeId, storeId),
          gte(schedules.date, dateStart),
          lte(schedules.date, dateEnd),
          eq(schedules.isHoliday, false),
        ),
      );

    // Active task templates count by recurrence
    const taskTemplateCounts = await db
      .select({
        recurrence: tasks.recurrence,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(eq(tasks.isActive, true))
      .groupBy(tasks.recurrence);

    // Recent completed tasks (last 5)
    const recentCompleted = await db
      .select({
        employeeTask: employeeTasks,
        task: { id: tasks.id, title: tasks.title },
        user: { id: users.id, name: users.name },
      })
      .from(employeeTasks)
      .leftJoin(tasks, eq(employeeTasks.taskId, tasks.id))
      .leftJoin(users, eq(employeeTasks.userId, users.id))
      .where(
        and(
          eq(employeeTasks.storeId, storeId),
          eq(employeeTasks.status, 'completed'),
          gte(employeeTasks.date, dateStart),
          lte(employeeTasks.date, dateEnd),
        ),
      )
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        date: date.toISOString(),
        tasks: taskStats,
        attendance: {
          scheduled: totalScheduled[0]?.count || 0,
          present: attendanceStats.find((s) => s.status === 'present')?.count || 0,
          late: attendanceStats.find((s) => s.status === 'late')?.count || 0,
          absent: attendanceStats.find((s) => s.status === 'absent')?.count || 0,
          excused: attendanceStats.find((s) => s.status === 'excused')?.count || 0,
        },
        taskTemplates: {
          daily: taskTemplateCounts.find((t) => t.recurrence === 'daily')?.count || 0,
          weekly: taskTemplateCounts.find((t) => t.recurrence === 'weekly')?.count || 0,
          monthly: taskTemplateCounts.find((t) => t.recurrence === 'monthly')?.count || 0,
        },
        recentCompleted,
      },
    });
  } catch (error) {
    console.error('[GET /api/ops/dashboard]', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
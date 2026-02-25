// app/api/ops/stores/[storeId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { stores, users, schedules, employeeTasks, attendance, tasks } from '@/lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

type Params = { params: Promise<{ storeId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { storeId } = await params;

    const today = new Date();
    const dateStart = new Date(today);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(today);
    dateEnd.setHours(23, 59, 59, 999);

    // Store info
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store) {
      return NextResponse.json({ success: false, error: 'Store not found' }, { status: 404 });
    }

    // Today's schedules for this store
    const schedulesForToday = await db
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

    // For each scheduled employee, get their task stats + recent tasks + attendance
    const employees = await Promise.all(
      schedulesForToday.map(async ({ schedule, user }) => {
        if (!user) return null;

        // Task stats
        const taskStats = await db
          .select({
            status: employeeTasks.status,
            count: sql<number>`count(*)::int`,
          })
          .from(employeeTasks)
          .where(
            and(
              eq(employeeTasks.userId, user.id),
              eq(employeeTasks.storeId, storeId),
              eq(employeeTasks.scheduleId, schedule.id),
            ),
          )
          .groupBy(employeeTasks.status);

        const taskTotal = taskStats.reduce((s, r) => s + r.count, 0);
        const taskCompleted = taskStats.find((r) => r.status === 'completed')?.count ?? 0;
        const taskPending = taskStats.find((r) => r.status === 'pending')?.count ?? 0;
        const taskInProgress = taskStats.find((r) => r.status === 'in_progress')?.count ?? 0;

        // Recent tasks (latest 3)
        const recentTaskRows = await db
          .select({
            id: employeeTasks.id,
            status: employeeTasks.status,
            completedAt: employeeTasks.completedAt,
            title: tasks.title,
          })
          .from(employeeTasks)
          .leftJoin(tasks, eq(employeeTasks.taskId, tasks.id))
          .where(
            and(
              eq(employeeTasks.userId, user.id),
              eq(employeeTasks.scheduleId, schedule.id),
            ),
          )
          .limit(5);

        // Attendance
        const [att] = await db
          .select()
          .from(attendance)
          .where(eq(attendance.scheduleId, schedule.id))
          .limit(1);

        return {
          user: {
            id: user.id,
            name: user.name,
            employeeType: user.employeeType,
          },
          shift: schedule.shift,
          attendance: att
            ? {
                status: att.status,
                checkInTime: att.checkInTime?.toISOString() ?? null,
              }
            : null,
          tasks: {
            total: taskTotal,
            completed: taskCompleted,
            pending: taskPending,
            inProgress: taskInProgress,
          },
          recentTasks: recentTaskRows.map((r) => ({
            id: r.id,
            title: r.title ?? 'Unknown Task',
            status: r.status,
            completedAt: r.completedAt?.toISOString() ?? null,
          })),
        };
      }),
    );

    return NextResponse.json({
      success: true,
      data: {
        store: {
          id: store.id,
          name: store.name,
          address: store.address,
          pettyCashBalance: store.pettyCashBalance,
        },
        date: today.toISOString(),
        employees: employees.filter(Boolean),
      },
    });
  } catch (error) {
    console.error('[GET /api/ops/stores/[storeId]]', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
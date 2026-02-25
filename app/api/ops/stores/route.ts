// app/api/ops/stores/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { stores, employeeTasks, attendance, schedules } from '@/lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export async function GET() {
  try {
    const today = new Date();
    const dateStart = new Date(today);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(today);
    dateEnd.setHours(23, 59, 59, 999);

    const allStores = await db.select().from(stores);

    const result = await Promise.all(
      allStores.map(async (store) => {
        // Task stats
        const taskStats = await db
          .select({
            status: employeeTasks.status,
            count: sql<number>`count(*)::int`,
          })
          .from(employeeTasks)
          .where(
            and(
              eq(employeeTasks.storeId, store.id),
              gte(employeeTasks.date, dateStart),
              lte(employeeTasks.date, dateEnd),
            ),
          )
          .groupBy(employeeTasks.status);

        const total = taskStats.reduce((s, r) => s + r.count, 0);
        const completed = taskStats.find((r) => r.status === 'completed')?.count ?? 0;
        const pending = taskStats.find((r) => r.status === 'pending')?.count ?? 0;

        // Attendance stats
        const [scheduledRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(schedules)
          .where(
            and(
              eq(schedules.storeId, store.id),
              gte(schedules.date, dateStart),
              lte(schedules.date, dateEnd),
              eq(schedules.isHoliday, false),
            ),
          );

        const attStats = await db
          .select({
            status: attendance.status,
            count: sql<number>`count(*)::int`,
          })
          .from(attendance)
          .where(
            and(
              eq(attendance.storeId, store.id),
              gte(attendance.date, dateStart),
              lte(attendance.date, dateEnd),
            ),
          )
          .groupBy(attendance.status);

        const present =
          (attStats.find((r) => r.status === 'present')?.count ?? 0) +
          (attStats.find((r) => r.status === 'late')?.count ?? 0);

        return {
          id: store.id,
          name: store.name,
          address: store.address,
          pettyCashBalance: store.pettyCashBalance,
          stats: {
            total,
            completed,
            pending,
            completionRate: total > 0 ? (completed / total) * 100 : 0,
          },
          attendance: {
            scheduled: scheduledRow?.count ?? 0,
            present,
          },
        };
      }),
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[GET /api/ops/stores]', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
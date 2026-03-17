// app/api/ops/schedules/area/route.ts
//
// GET /api/ops/schedules/area
//
// Returns the full area → stores → monthly schedules + employees tree
// for the currently authenticated OPS user.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import { users, stores, areas, monthlySchedules, monthlyScheduleEntries } from '@/lib/db/schema';
import { and, eq, desc }             from 'drizzle-orm';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const u       = session?.user as any;

    if (!u?.id || u?.role !== 'ops') {
      return NextResponse.json(
        { success: false, error: 'Only OPS users can access this resource.' },
        { status: 403 },
      );
    }
    if (!u?.areaId) {
      return NextResponse.json(
        { success: false, error: 'OPS user has no area assigned. Contact an admin.' },
        { status: 400 },
      );
    }

    const areaId: string = u.areaId;

    // ── 1. Fetch area ─────────────────────────────────────────────────────────
    const [area] = await db
      .select()
      .from(areas)
      .where(eq(areas.id, areaId))
      .limit(1);

    if (!area) {
      return NextResponse.json({ success: false, error: 'Area not found.' }, { status: 404 });
    }

    // ── 2. Fetch all stores in this area ──────────────────────────────────────
    const areaStores = await db
      .select()
      .from(stores)
      .where(eq(stores.areaId, areaId))
      .orderBy(stores.name);

    // ── 3. For each store: fetch latest monthly schedule + employees ───────────
    const storeResults = await Promise.all(
      areaStores.map(async (store) => {

        // Get the most recent monthly schedule for this store
        const latestSchedules = await db
          .select()
          .from(monthlySchedules)
          .where(eq(monthlySchedules.storeId, store.id))
          .orderBy(desc(monthlySchedules.yearMonth))
          .limit(3); // last 3 months

        // For each schedule, get entry summary (employee count, shift breakdown)
        const scheduleSummaries = await Promise.all(
          latestSchedules.map(async (ms) => {
            const entries = await db
              .select({
                entry: monthlyScheduleEntries,
                user:  users,
              })
              .from(monthlyScheduleEntries)
              .leftJoin(users, eq(monthlyScheduleEntries.userId, users.id))
              .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));

            const uniqueEmployees = new Set(entries.map(e => e.entry.userId)).size;
            const morningShifts   = entries.filter(e => !e.entry.isOff && !e.entry.isLeave && e.entry.shift === 'morning').length;
            const eveningShifts   = entries.filter(e => !e.entry.isOff && !e.entry.isLeave && e.entry.shift === 'evening').length;
            const leaveDays       = entries.filter(e => e.entry.isLeave).length;

            return {
              id:              ms.id,
              yearMonth:       ms.yearMonth,
              note:            ms.note ?? null,
              createdAt:       ms.createdAt.toISOString(),
              updatedAt:       ms.updatedAt.toISOString(),
              uniqueEmployees,
              morningShifts,
              eveningShifts,
              leaveDays,
              totalEntries:    entries.length,
            };
          }),
        );

        // Fetch all employees whose home store is this store
        const employees = await db
          .select({
            id:           users.id,
            name:         users.name,
            role:         users.role,
            employeeType: users.employeeType,
          })
          .from(users)
          .where(
            and(
              eq(users.homeStoreId, store.id),
              eq(users.role,        'employee'),
            ),
          )
          .orderBy(users.name);

        // Check which employees appear in the latest schedule
        const latestMs       = latestSchedules[0];
        const scheduledUserIds = new Set<string>();
        if (latestMs) {
          const latestEntries = await db
            .select({ userId: monthlyScheduleEntries.userId })
            .from(monthlyScheduleEntries)
            .where(eq(monthlyScheduleEntries.monthlyScheduleId, latestMs.id));
          latestEntries.forEach(e => scheduledUserIds.add(e.userId));
        }

        return {
          storeId:          store.id,
          storeName:        store.name,
          address:          store.address,
          scheduleSummaries,
          employees,
          scheduledUserIds: [...scheduledUserIds],
          currentYearMonth: latestMs?.yearMonth ?? null,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      area: {
        areaId:   area.id,
        areaName: area.name,
        stores:   storeResults,
      },
    });
  } catch (err) {
    console.error('[GET /api/ops/schedules/area]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
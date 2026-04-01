// app/api/ops/schedules/area/route.ts
//
// Returns the OPS user's area + all stores in that area, with schedule
// summaries, employee roster, and scheduled-user IDs for each store.
// This is what OpsSchedulesPage fetches on load.
//
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  users, stores, areas,
  monthlySchedules, monthlyScheduleEntries,
} from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ── 1. Find the OPS user's area ─────────────────────────────────────────
    const [opsUser] = await db
      .select({ areaId: users.areaId })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!opsUser?.areaId) {
      // Not assigned to any area yet — return null so the page shows the
      // "No area assigned" empty state instead of crashing.
      return NextResponse.json({ success: true, area: null });
    }

    const [area] = await db
      .select({ id: areas.id, name: areas.name })
      .from(areas)
      .where(eq(areas.id, opsUser.areaId))
      .limit(1);

    if (!area) {
      return NextResponse.json({ success: true, area: null });
    }

    // ── 2. Get all stores in this area ──────────────────────────────────────
    const areaStores = await db
      .select({ id: stores.id, name: stores.name, address: stores.address })
      .from(stores)
      .where(eq(stores.areaId, area.id))
      .orderBy(stores.name);

    if (!areaStores.length) {
      return NextResponse.json({
        success: true,
        area: { areaId: area.id, areaName: area.name, stores: [] },
      });
    }

    // ── 3. Build per-store data in parallel ─────────────────────────────────
    const storeData = await Promise.all(
      areaStores.map(async (store) => {

        // ── 3a. All monthly schedules for this store ────────────────────────
        const scheduleRows = await db
          .select({
            id:        monthlySchedules.id,
            yearMonth: monthlySchedules.yearMonth,
            note:      monthlySchedules.note,
            createdAt: monthlySchedules.createdAt,
            updatedAt: monthlySchedules.updatedAt,
          })
          .from(monthlySchedules)
          .where(eq(monthlySchedules.storeId, store.id))
          .orderBy(sql`${monthlySchedules.yearMonth} DESC`);

        // ── 3b. Build schedule summaries ────────────────────────────────────
        const scheduleSummaries = await Promise.all(
          scheduleRows.map(async (ms) => {
            const entries = await db
              .select({
                userId:  monthlyScheduleEntries.userId,
                shift:   monthlyScheduleEntries.shift,
                isOff:   monthlyScheduleEntries.isOff,
                isLeave: monthlyScheduleEntries.isLeave,
              })
              .from(monthlyScheduleEntries)
              .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));

            const uniqueEmployees = new Set(entries.map(e => e.userId)).size;
            const morningShifts   = entries.filter(e => e.shift === 'morning' && !e.isOff && !e.isLeave).length;
            const eveningShifts   = entries.filter(e => e.shift === 'evening' && !e.isOff && !e.isLeave).length;
            const leaveDays       = entries.filter(e => e.isLeave).length;
            const totalEntries    = entries.length;

            return {
              id:              ms.id,
              yearMonth:       ms.yearMonth,
              note:            ms.note,
              createdAt:       ms.createdAt.toISOString(),
              updatedAt:       ms.updatedAt.toISOString(),
              uniqueEmployees,
              morningShifts,
              eveningShifts,
              leaveDays,
              totalEntries,
            };
          }),
        );

        // ── 3c. Current month's scheduled user IDs ──────────────────────────
        const now = new Date();
        const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const [currentMs] = await db
          .select({ id: monthlySchedules.id })
          .from(monthlySchedules)
          .where(
            and(
              eq(monthlySchedules.storeId,   store.id),
              eq(monthlySchedules.yearMonth, currentYearMonth),
            ),
          )
          .limit(1);

        let scheduledUserIds: string[] = [];
        if (currentMs) {
          const currentEntries = await db
            .select({ userId: monthlyScheduleEntries.userId })
            .from(monthlyScheduleEntries)
            .where(eq(monthlyScheduleEntries.monthlyScheduleId, currentMs.id));
          scheduledUserIds = [...new Set(currentEntries.map(e => e.userId))];
        }

        // ── 3d. All employees whose homeStoreId is this store ───────────────
        const storeEmployees = await db
          .select({
            id:           users.id,
            name:         users.name,
            employeeType: users.employeeType,
            role:         users.role,
          })
          .from(users)
          .where(
            and(
              eq(users.homeStoreId, store.id),
              eq(users.role,        'employee'),
            ),
          )
          .orderBy(users.name);

        return {
          storeId:          store.id,
          storeName:        store.name,
          address:          store.address,
          scheduleSummaries,
          employees:        storeEmployees.map(e => ({
            id:           e.id,
            name:         e.name,
            employeeType: e.employeeType,
            role:         e.role,
          })),
          scheduledUserIds,
          currentYearMonth: currentMs ? currentYearMonth : null,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      area: {
        areaId:   area.id,
        areaName: area.name,
        stores:   storeData,
      },
    });

  } catch (err) {
    console.error('[GET /api/ops/schedules/area]', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
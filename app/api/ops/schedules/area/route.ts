// app/api/ops/schedules/area/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, asc, eq, sql } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  areas,
  employeeTypes,
  monthlyScheduleEntries,
  monthlySchedules,
  shifts,
  stores,
  users,
} from '@/lib/db/schema';

import {
  getOpsActor,
  listStoresForActor,
} from '../_helpers';

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Backward-compatible summary endpoint for older OPS schedule widgets.
 * Updated to count dynamic shifts by code instead of assuming only
 * morning/evening columns.
 */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const actor = await getOpsActor(session.user.id);

  if (!actor) {
    return NextResponse.json(
      { success: false, error: 'OPS only.' },
      { status: 403 },
    );
  }

  const areaRows = actor.isHO
    ? await db
        .select({ id: areas.id, name: areas.name })
        .from(areas)
        .orderBy(asc(areas.name))
    : actor.areaId
      ? await db
          .select({ id: areas.id, name: areas.name })
          .from(areas)
          .where(eq(areas.id, actor.areaId))
          .limit(1)
      : [];

  if (!actor.isHO && !actor.areaId) {
    return NextResponse.json({
      success: true,
      area: null,
      areas: [],
      stores: [],
    });
  }

  const visibleStores = await listStoresForActor(actor);
  const currentYM = currentYearMonth();

  const storeData = await Promise.all(
    visibleStores.map(async (store) => {
      const schedules = await db
        .select({
          id: monthlySchedules.id,
          yearMonth: monthlySchedules.yearMonth,
          note: monthlySchedules.note,
          createdAt: monthlySchedules.createdAt,
          updatedAt: monthlySchedules.updatedAt,
        })
        .from(monthlySchedules)
        .where(eq(monthlySchedules.storeId, store.id))
        .orderBy(sql`${monthlySchedules.yearMonth} DESC`);

      const scheduleSummaries = await Promise.all(
        schedules.map(async (schedule) => {
          const entries = await db
            .select({
              userId: monthlyScheduleEntries.userId,
              shiftCode: shifts.code,
              isOff: monthlyScheduleEntries.isOff,
              isLeave: monthlyScheduleEntries.isLeave,
            })
            .from(monthlyScheduleEntries)
            .leftJoin(shifts, eq(shifts.id, monthlyScheduleEntries.shiftId))
            .where(eq(monthlyScheduleEntries.monthlyScheduleId, schedule.id));

          const workingEntries = entries.filter((entry) => !entry.isOff && !entry.isLeave && entry.shiftCode);
          const shiftCounts = workingEntries.reduce<Record<string, number>>((acc, entry) => {
            const code = entry.shiftCode ?? 'unknown';
            acc[code] = (acc[code] ?? 0) + 1;
            return acc;
          }, {});

          return {
            id: schedule.id,
            yearMonth: schedule.yearMonth,
            note: schedule.note,
            createdAt: schedule.createdAt.toISOString(),
            updatedAt: schedule.updatedAt.toISOString(),
            uniqueEmployees: new Set(entries.map((entry) => entry.userId)).size,
            leaveDays: entries.filter((entry) => entry.isLeave).length,
            totalEntries: entries.length,
            shiftCounts,

            // Kept for older UI cards.
            morningShifts: shiftCounts.morning ?? 0,
            eveningShifts: shiftCounts.evening ?? 0,
            fullDayShifts: shiftCounts.full_day ?? 0,
          };
        }),
      );

      const [currentSchedule] = await db
        .select({ id: monthlySchedules.id })
        .from(monthlySchedules)
        .where(
          and(
            eq(monthlySchedules.storeId, store.id),
            eq(monthlySchedules.yearMonth, currentYM),
          ),
        )
        .limit(1);

      let scheduledUserIds: string[] = [];

      if (currentSchedule) {
        const currentEntries = await db
          .select({ userId: monthlyScheduleEntries.userId })
          .from(monthlyScheduleEntries)
          .where(eq(monthlyScheduleEntries.monthlyScheduleId, currentSchedule.id));

        scheduledUserIds = [...new Set(currentEntries.map((entry) => entry.userId))];
      }

      const employees = await db
        .select({
          id: users.id,
          name: users.name,
          employeeType: employeeTypes.code,
        })
        .from(users)
        .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
        .where(
          and(
            eq(users.homeStoreId, store.id),
            eq(users.isActive, true),
          ),
        )
        .orderBy(users.name);

      return {
        storeId: store.id,
        storeName: store.name,
        address: store.address,
        areaId: store.areaId,
        areaName: store.areaName ?? '—',
        scheduleSummaries,
        employees,
        scheduledUserIds,
        currentYearMonth: currentSchedule ? currentYM : null,
      };
    }),
  );

  return NextResponse.json({
    success: true,
    isHO: actor.isHO,
    area: actor.isHO
      ? null
      : areaRows[0]
        ? { areaId: areaRows[0].id, areaName: areaRows[0].name, stores: storeData }
        : null,
    areas: areaRows,
    stores: storeData,
  });
}

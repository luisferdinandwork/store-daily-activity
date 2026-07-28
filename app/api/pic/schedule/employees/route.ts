// app/api/pic/schedule/employees/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, eq, sql } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  users,
  userRoles,
  employeeTypes,
  monthlyScheduleEntries,
  monthlySchedules,
  userStoreAssignments,
} from '@/lib/db/schema';
import { dateToYearMonth } from '@/lib/schedule-utils';

import {
  canManageSchedule,
  resolveActorCodes,
} from '../_utils';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;

    if (!user?.id || !user?.homeStoreId) {
      return NextResponse.json(
        { success: false, error: 'Only OPS or PIC can access this resource.' },
        { status: 403 },
      );
    }

    const { role, empType } = await resolveActorCodes(user.id as string);

    if (!canManageSchedule(role, empType)) {
      return NextResponse.json(
        { success: false, error: 'Only OPS or PIC can access this resource.' },
        { status: 403 },
      );
    }

    const storeId = Number(user.homeStoreId);

    if (Number.isNaN(storeId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid homeStoreId in session.' },
        { status: 400 },
      );
    }

    const homeEmployees = await db
      .select({
        id: users.id,
        nik: users.nik,
        name: users.name,
        employeeType: employeeTypes.code,
        source: sql<string>`'home'`.as('source'),
      })
      .from(users)
      .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
      .where(
        and(
          eq(users.homeStoreId, storeId),
          eq(users.isActive, true),
        ),
      )
      .orderBy(users.name);

    const currentYM = dateToYearMonth(new Date());

    const deployedRows = await db
      .selectDistinct({
        id: users.id,
        nik: users.nik,
        name: users.name,
        employeeType: employeeTypes.code,
        source: sql<string>`'deployed'`.as('source'),
      })
      .from(monthlyScheduleEntries)
      .innerJoin(
        monthlySchedules,
        eq(monthlyScheduleEntries.monthlyScheduleId, monthlySchedules.id),
      )
      .innerJoin(users, eq(monthlyScheduleEntries.userId, users.id))
      .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
      .innerJoin(
        userStoreAssignments,
        and(
          eq(userStoreAssignments.userId, users.id),
          eq(userStoreAssignments.storeId, storeId),
          eq(userStoreAssignments.isActive, true),
        ),
      )
      .where(
        and(
          eq(monthlySchedules.storeId, storeId),
          eq(monthlySchedules.yearMonth, currentYM),
          eq(users.isActive, true),
        ),
      )
      .orderBy(users.name);

    const seen = new Map<string, (typeof homeEmployees)[number]>();

    for (const emp of homeEmployees) {
      seen.set(emp.id, emp);
    }

    for (const emp of deployedRows) {
      if (!seen.has(emp.id)) {
        seen.set(emp.id, emp);
      }
    }

    return NextResponse.json({
      success: true,
      employees: [...seen.values()],
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
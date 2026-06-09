// app/api/ops/schedules/employees/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, eq, sql } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  employeeTypes,
  monthlyScheduleEntries,
  monthlySchedules,
  userStoreAssignments,
  users,
} from '@/lib/db/schema';
import { dateToYearMonth } from '@/lib/schedule-utils';

import {
  assertStoreInActorArea,
  getOpsActor,
  parseStoreId,
} from '../_helpers';

export async function GET(req: NextRequest) {
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

  const parsedStore = parseStoreId(req.nextUrl.searchParams.get('storeId'));

  if (!parsedStore.ok) {
    return NextResponse.json(
      { success: false, error: parsedStore.error },
      { status: 400 },
    );
  }

  const areaError = await assertStoreInActorArea(actor, parsedStore.id);

  if (areaError) {
    return NextResponse.json(
      { success: false, error: areaError },
      { status: 403 },
    );
  }

  try {
    const homeEmployees = await db
      .select({
        id: users.id,
        nik: users.nik,
        name: users.name,
        employeeType: employeeTypes.code,
        source: sql<string>`'home'`.as('source'),
      })
      .from(users)
      .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
      .where(
        and(
          eq(users.homeStoreId, parsedStore.id),
          eq(users.isActive, true),
        ),
      )
      .orderBy(users.name);

    const currentYearMonth = dateToYearMonth(new Date());

    const deployedEmployees = await db
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
        eq(monthlySchedules.id, monthlyScheduleEntries.monthlyScheduleId),
      )
      .innerJoin(users, eq(users.id, monthlyScheduleEntries.userId))
      .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
      .innerJoin(
        userStoreAssignments,
        and(
          eq(userStoreAssignments.userId, users.id),
          eq(userStoreAssignments.storeId, parsedStore.id),
          eq(userStoreAssignments.isActive, true),
        ),
      )
      .where(
        and(
          eq(monthlySchedules.storeId, parsedStore.id),
          eq(monthlySchedules.yearMonth, currentYearMonth),
          eq(users.isActive, true),
        ),
      )
      .orderBy(users.name);

    const merged = new Map<string, (typeof homeEmployees)[number]>();

    for (const employee of homeEmployees) merged.set(employee.id, employee);
    for (const employee of deployedEmployees) {
      if (!merged.has(employee.id)) merged.set(employee.id, employee);
    }

    return NextResponse.json({
      success: true,
      employees: [...merged.values()],
    });
  } catch (err) {
    console.error('[GET /api/ops/schedules/employees]', err);

    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}

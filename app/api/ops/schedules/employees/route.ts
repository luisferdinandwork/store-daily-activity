// app/api/ops/schedules/employees/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import {
  users, employeeTypes, monthlyScheduleEntries, monthlySchedules,
} from '@/lib/db/schema';
import { and, eq, sql }              from 'drizzle-orm';
import { dateToYearMonth }           from '@/lib/schedule-utils';
import { getOpsActor, assertStoreInActorArea, parseStoreId } from '../_helpers';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const parsed = parseStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });

  const areaErr = await assertStoreInActorArea(actor, parsed.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  // Home employees
  const homeEmployees = await db
    .select({
      id:           users.id,
      name:         users.name,
      email:        users.email,
      employeeType: employeeTypes.code,
      source:       sql<string>`'home'`.as('source'),
    })
    .from(users)
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.homeStoreId, parsed.id))
    .orderBy(users.name);

  // Currently deployed via this month's schedule
  const currentYM = dateToYearMonth(new Date());
  const deployedRows = await db
    .selectDistinct({
      id:           users.id,
      name:         users.name,
      email:        users.email,
      employeeType: employeeTypes.code,
      source:       sql<string>`'deployed'`.as('source'),
    })
    .from(monthlyScheduleEntries)
    .innerJoin(monthlySchedules, eq(monthlyScheduleEntries.monthlyScheduleId, monthlySchedules.id))
    .innerJoin(users, eq(monthlyScheduleEntries.userId, users.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(
      and(
        eq(monthlySchedules.storeId,   parsed.id),
        eq(monthlySchedules.yearMonth, currentYM),
      ),
    )
    .orderBy(users.name);

  const seen = new Map<string, typeof homeEmployees[0]>();
  for (const emp of homeEmployees) seen.set(emp.id, emp);
  for (const emp of deployedRows)  if (!seen.has(emp.id)) seen.set(emp.id, emp);

  return NextResponse.json({ success: true, employees: [...seen.values()] });
}
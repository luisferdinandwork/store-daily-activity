// app/api/pic/schedule/employees/route.ts
import { NextRequest, NextResponse }      from 'next/server';
import { getServerSession }               from 'next-auth';
import { authOptions }                    from '@/lib/auth';
import { db }                             from '@/lib/db';
import {
  users, employeeTypes,
  monthlyScheduleEntries, monthlySchedules,
  userStoreAssignments,
} from '@/lib/db/schema';
import { and, eq, sql }                   from 'drizzle-orm';
import { dateToYearMonth }                from '@/lib/schedule-utils';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const u       = session?.user as any;

    if (!u?.id || !u?.homeStoreId) {
      return NextResponse.json(
        { success: false, error: 'Only PIC 1 can access this resource.' },
        { status: 403 },
      );
    }

    // Resolve employeeType code via DB lookup instead of trusting the session string
    const [actorRow] = await db
      .select({ code: employeeTypes.code })
      .from(users)
      .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
      .where(eq(users.id, u.id as string))
      .limit(1);

    if (actorRow?.code !== 'pic_1') {
      return NextResponse.json(
        { success: false, error: 'Only PIC 1 can access this resource.' },
        { status: 403 },
      );
    }

    const storeId = Number(u.homeStoreId);
    if (isNaN(storeId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid homeStoreId in session.' },
        { status: 400 },
      );
    }

    // 1. Employees whose home store is this store
    const homeEmployees = await db
      .select({
        id:           users.id,
        nik:          users.nik,
        name:         users.name,
        employeeType: employeeTypes.code,
        source:       sql<string>`'home'`.as('source'),
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

    // 2. Employees deployed here via this month's schedule who have an
    //    active assignment at this store (catches legitimate cross-posts,
    //    excludes stale entries from users who have since been reassigned).
    const currentYM = dateToYearMonth(new Date());

    const deployedRows = await db
      .selectDistinct({
        id:           users.id,
        nik:          users.nik,
        name:         users.name,
        employeeType: employeeTypes.code,
        source:       sql<string>`'deployed'`.as('source'),
      })
      .from(monthlyScheduleEntries)
      .innerJoin(monthlySchedules,
        eq(monthlyScheduleEntries.monthlyScheduleId, monthlySchedules.id))
      .innerJoin(users,
        eq(monthlyScheduleEntries.userId, users.id))
      .leftJoin(employeeTypes,
        eq(users.employeeTypeId, employeeTypes.id))
      // Only include if there is still an active assignment at this store
      .innerJoin(userStoreAssignments,
        and(
          eq(userStoreAssignments.userId,   users.id),
          eq(userStoreAssignments.storeId,  storeId),
          eq(userStoreAssignments.isActive, true),
        ),
      )
      .where(
        and(
          eq(monthlySchedules.storeId,   storeId),
          eq(monthlySchedules.yearMonth, currentYM),
          eq(users.isActive,             true),
        ),
      )
      .orderBy(users.name);

    // Merge: deduplicate by id, home employees take priority
    const seen = new Map<string, typeof homeEmployees[0]>();
    for (const emp of homeEmployees) seen.set(emp.id, emp);
    for (const emp of deployedRows)  if (!seen.has(emp.id)) seen.set(emp.id, emp);

    return NextResponse.json({ success: true, employees: [...seen.values()] });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
// app/api/pic/schedule/employees/route.ts
import { NextRequest, NextResponse }               from 'next/server';
import { getServerSession }                        from 'next-auth';
import { authOptions }                             from '@/lib/auth';
import { db }                                      from '@/lib/db';
import { users, monthlyScheduleEntries, monthlySchedules } from '@/lib/db/schema';
import { and, eq, sql }                            from 'drizzle-orm';
import { dateToYearMonth }                         from '@/lib/schedule-utils';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const u       = session?.user as any;

    if (!u?.id || u?.employeeType !== 'pic_1' || !u?.homeStoreId) {
      return NextResponse.json(
        { success: false, error: 'Only PIC 1 can access this resource.' },
        { status: 403 },
      );
    }

    // homeStoreId from session may arrive as a string — coerce to number
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
        name:         users.name,
        email:        users.email,
        employeeType: users.employeeType,
        source:       sql<string>`'home'`.as('source'),
      })
      .from(users)
      .where(
        and(
          eq(users.homeStoreId, storeId),
          eq(users.role, 'employee'),
        ),
      )
      .orderBy(users.name);

    // 2. Employees currently deployed here via this month's schedule
    const currentYM = dateToYearMonth(new Date());

    const deployedRows = await db
      .selectDistinct({
        id:           users.id,
        name:         users.name,
        email:        users.email,
        employeeType: users.employeeType,
        source:       sql<string>`'deployed'`.as('source'),
      })
      .from(monthlyScheduleEntries)
      .innerJoin(monthlySchedules, eq(monthlyScheduleEntries.monthlyScheduleId, monthlySchedules.id))
      .innerJoin(users, eq(monthlyScheduleEntries.userId, users.id))
      .where(
        and(
          eq(monthlySchedules.storeId,   storeId),
          eq(monthlySchedules.yearMonth, currentYM),
          eq(users.role, 'employee'),
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
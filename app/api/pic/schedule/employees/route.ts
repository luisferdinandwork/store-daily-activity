// app/api/pic/schedule/employees/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { and, eq, ne } from 'drizzle-orm';

// ─── GET /api/pic/schedule/employees ─────────────────────────────────────────
// Returns all employees in the same store as the PIC 1 (excluding OPS/finance/admin
// and the PIC 1 themselves — PIC 1 schedules themselves too, so we include all).
//
// The PIC 1 is included in the list so they can assign their own schedule.
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const u = session?.user as any;

    if (!u?.id || u?.employeeType !== 'pic_1' || !u?.storeId) {
      return NextResponse.json(
        { success: false, error: 'Only PIC 1 can access this resource.' },
        { status: 403 },
      );
    }

    const storeId: string = u.storeId;

    // Return all employee-role users in this store (pic_1, pic_2, so).
    // OPS/finance/admin are excluded since they don't work store shifts.
    const storeEmployees = await db
      .select({
        id:           users.id,
        name:         users.name,
        email:        users.email,
        employeeType: users.employeeType,
      })
      .from(users)
      .where(
        and(
          eq(users.storeId, storeId),
          eq(users.role,    'employee'),
        ),
      )
      .orderBy(users.name);

    return NextResponse.json({ success: true, employees: storeEmployees });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
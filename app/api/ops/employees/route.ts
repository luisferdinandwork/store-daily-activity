// app/api/ops/employees/route.ts
// Returns all employees (role = 'employee') for a given store.
// Uses homeStoreId — not storeId which doesn't exist on the users table.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import { and, eq }                   from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const storeIdParam = req.nextUrl.searchParams.get('storeId');
  const storeId = storeIdParam ? Number(storeIdParam) : NaN;
  if (!storeIdParam || Number.isNaN(storeId)) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  // Login is NIK-based (no email column on users) — see lib/auth.ts.
  const rows = await db
    .select({
      id:           users.id,
      name:         users.name,
      nik:          users.nik,
      role:         userRoles.code,
      employeeType: employeeTypes.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .where(
      and(
        eq(users.homeStoreId, storeId),
        eq(userRoles.code, 'employee'),
      ),
    )
    .orderBy(users.name);

  return NextResponse.json({ success: true, data: rows });
}
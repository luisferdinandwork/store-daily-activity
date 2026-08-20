// app/api/ops/employees/route.ts
// Returns all employees (role = 'employee') for a given store.
// Uses homeStoreId — not storeId which doesn't exist on the users table.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import { and, eq }                   from 'drizzle-orm';

import { assertStoreInActorArea, getOpsActor, parseStoreId } from '../tasks/_helpers';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor(session.user.id);
  if (!actor) return NextResponse.json({ error: 'OPS only.' }, { status: 403 });

  const parsedStore = parseStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!parsedStore.ok) {
    return NextResponse.json({ error: parsedStore.error }, { status: 400 });
  }
  const storeId = parsedStore.id;

  const areaError = await assertStoreInActorArea(actor, storeId);
  if (areaError) return NextResponse.json({ error: areaError }, { status: 403 });

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
// app/api/ops/employees/route.ts
// Returns all employees (role = 'employee') for a given store.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const rows = await db
    .select({
      id:           users.id,
      name:         users.name,
      email:        users.email,
      role:         users.role,
      employeeType: users.employeeType,
    })
    .from(users)
    .where(and(eq(users.storeId, storeId), eq(users.role, 'employee')))
    .orderBy(users.name);

  return NextResponse.json({ success: true, data: rows });
}
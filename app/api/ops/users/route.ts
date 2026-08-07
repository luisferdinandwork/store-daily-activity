// app/api/ops/users/route.ts
//
// POST — creates a new employee account. OPS/IT only, scoped the same way as
// transfers (lib/db/utils/user-transfers.ts::createEmployee): HO/IT can place
// the new employee at any store, Area OPS only at a store inside their own
// area. Always creates a role='employee' account — OPS accounts are IT-only
// (see app/api/it/users).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createEmployee } from '@/lib/db/utils/user-transfers';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);

  const nik = typeof body?.nik === 'string' ? body.nik : '';
  const name = typeof body?.name === 'string' ? body.name : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const employeeTypeId = Number(body?.employeeTypeId);
  const homeStoreId = Number(body?.homeStoreId);

  if (!Number.isInteger(employeeTypeId) || employeeTypeId <= 0) {
    return NextResponse.json({ error: 'A role (employee type) is required.' }, { status: 400 });
  }
  if (!Number.isInteger(homeStoreId) || homeStoreId <= 0) {
    return NextResponse.json({ error: 'A store is required.' }, { status: 400 });
  }

  const result = await createEmployee(session.user.id as string, {
    nik,
    name,
    password,
    employeeTypeId,
    homeStoreId,
  });

  if (!result.success) {
    const status = result.error.includes('already exists')
      ? 409
      : /outside your area|OPS\/Admin|Area OPS user|role is inactive|Actor not found/.test(result.error)
        ? 403
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, user: result.data }, { status: 201 });
}

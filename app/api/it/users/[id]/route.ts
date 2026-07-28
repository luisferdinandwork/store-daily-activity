// app/api/it/users/[id]/route.ts
//
// PATCH — updates an existing user's name/role/employee type/store/area/
// active status, and optionally resets their password. IT-only. NIK is
// immutable (it's the login identifier).

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes, stores } from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';

const SALT_ROUNDS = 10;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id } = await params;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!existing) {
    return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

  if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ success: false, error: 'Name cannot be empty.' }, { status: 400 });
    updates.name = name;
  }

  if (typeof body?.isActive === 'boolean') {
    updates.isActive = body.isActive;
  }

  if ('roleId' in (body ?? {})) {
    const roleId = Number(body.roleId);
    if (!Number.isInteger(roleId) || roleId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid roleId.' }, { status: 400 });
    }
    const [role] = await db.select({ id: userRoles.id, isActive: userRoles.isActive }).from(userRoles).where(eq(userRoles.id, roleId)).limit(1);
    if (!role || !role.isActive) {
      return NextResponse.json({ success: false, error: 'Invalid or inactive role.' }, { status: 400 });
    }
    updates.roleId = roleId;
  }

  if ('employeeTypeId' in (body ?? {})) {
    const raw = body.employeeTypeId;
    if (raw === null || raw === '') {
      updates.employeeTypeId = null;
    } else {
      const employeeTypeId = Number(raw);
      if (!Number.isInteger(employeeTypeId) || employeeTypeId <= 0) {
        return NextResponse.json({ success: false, error: 'Invalid employeeTypeId.' }, { status: 400 });
      }
      const [empType] = await db.select({ id: employeeTypes.id, isActive: employeeTypes.isActive }).from(employeeTypes).where(eq(employeeTypes.id, employeeTypeId)).limit(1);
      if (!empType || !empType.isActive) {
        return NextResponse.json({ success: false, error: 'Invalid or inactive employee type.' }, { status: 400 });
      }
      updates.employeeTypeId = employeeTypeId;
    }
  }

  if ('homeStoreId' in (body ?? {})) {
    const raw = body.homeStoreId;
    if (raw === null || raw === '') {
      updates.homeStoreId = null;
    } else {
      const homeStoreId = Number(raw);
      const [store] = await db.select({ id: stores.id, areaId: stores.areaId }).from(stores).where(eq(stores.id, homeStoreId)).limit(1);
      if (!store) {
        return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 400 });
      }
      updates.homeStoreId = homeStoreId;
      if (!('areaId' in (body ?? {}))) {
        updates.areaId = store.areaId;
      }
    }
  }

  if ('areaId' in (body ?? {})) {
    const raw = body.areaId;
    updates.areaId = raw === null || raw === '' ? null : Number(raw);
  }

  if (typeof body?.password === 'string' && body.password.length > 0) {
    if (body.password.length < 6) {
      return NextResponse.json({ success: false, error: 'Password must be at least 6 characters.' }, { status: 400 });
    }
    updates.password = await bcrypt.hash(body.password, SALT_ROUNDS);
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning({ id: users.id, nik: users.nik, name: users.name, isActive: users.isActive });

  return NextResponse.json({ success: true, user: updated });
}

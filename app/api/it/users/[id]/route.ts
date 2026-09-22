// app/api/it/users/[id]/route.ts
//
// PATCH — updates an existing user's name/role/employee type/store/area/
// active status, and optionally resets their password. IT-only. NIK is
// immutable (it's the login identifier).

import { NextResponse } from 'next/server';
import { validateNewPassword } from '@/lib/auth/password';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes, stores } from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';
import { setUserHomeStore } from '@/lib/db/utils/user-store-assignment';

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

  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
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

  // roleId / employeeTypeId / homeStoreId / areaId are handled together below
  // so a store/area/role change stays in sync with userStoreAssignments
  // (the history table other reports read the *active* roster from).
  let roleId = existing.roleId;
  if ('roleId' in (body ?? {})) {
    roleId = Number(body.roleId);
    if (!Number.isInteger(roleId) || roleId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid roleId.' }, { status: 400 });
    }
    const [role] = await db.select({ id: userRoles.id, isActive: userRoles.isActive }).from(userRoles).where(eq(userRoles.id, roleId)).limit(1);
    if (!role || !role.isActive) {
      return NextResponse.json({ success: false, error: 'Invalid or inactive role.' }, { status: 400 });
    }
  }

  let employeeTypeId = existing.employeeTypeId;
  if ('employeeTypeId' in (body ?? {})) {
    const raw = body.employeeTypeId;
    if (raw === null || raw === '') {
      employeeTypeId = null;
    } else {
      employeeTypeId = Number(raw);
      if (!Number.isInteger(employeeTypeId) || employeeTypeId <= 0) {
        return NextResponse.json({ success: false, error: 'Invalid employeeTypeId.' }, { status: 400 });
      }
      const [empType] = await db.select({ id: employeeTypes.id, isActive: employeeTypes.isActive }).from(employeeTypes).where(eq(employeeTypes.id, employeeTypeId)).limit(1);
      if (!empType || !empType.isActive) {
        return NextResponse.json({ success: false, error: 'Invalid or inactive employee type.' }, { status: 400 });
      }
    }
  }

  let homeStoreId = existing.homeStoreId;
  let areaId = existing.areaId;
  let storeOrAreaChanged = false;

  if ('homeStoreId' in (body ?? {})) {
    storeOrAreaChanged = true;
    const raw = body.homeStoreId;
    if (raw === null || raw === '') {
      homeStoreId = null;
      // Unassigning a store doesn't clear the area unless areaId is also sent.
    } else {
      homeStoreId = Number(raw);
      const [store] = await db.select({ id: stores.id, areaId: stores.areaId }).from(stores).where(eq(stores.id, homeStoreId)).limit(1);
      if (!store) {
        return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 400 });
      }
      if (!('areaId' in (body ?? {}))) {
        areaId = store.areaId;
      }
    }
  }

  if ('areaId' in (body ?? {})) {
    storeOrAreaChanged = true;
    const raw = body.areaId;
    areaId = raw === null || raw === '' ? null : Number(raw);
  }

  if (typeof body?.password === 'string' && body.password.length > 0) {
    const pwPolicy = validateNewPassword(body.password);
    if (!pwPolicy.ok) {
      return NextResponse.json({ success: false, error: pwPolicy.error }, { status: 400 });
    }
    updates.password = await bcrypt.hash(body.password, SALT_ROUNDS);
    // Reset the 90-day password-policy clock — see lib/db/utils/password-policy.ts.
    updates.passwordChangedAt = new Date();
  }

  const roleOrTypeChanged = ('roleId' in (body ?? {})) || ('employeeTypeId' in (body ?? {}));

  if (storeOrAreaChanged || (roleOrTypeChanged && existing.homeStoreId != null)) {
    await setUserHomeStore({
      userId: id,
      homeStoreId,
      areaId,
      roleId,
      employeeTypeId,
      assignedBy: scope.userId,
      notes: 'Updated through IT Users management.',
    });
  } else {
    if ('roleId' in (body ?? {})) updates.roleId = roleId;
    if ('employeeTypeId' in (body ?? {})) updates.employeeTypeId = employeeTypeId;
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning({ id: users.id, nik: users.nik, name: users.name, isActive: users.isActive });

  return NextResponse.json({ success: true, user: updated });
}

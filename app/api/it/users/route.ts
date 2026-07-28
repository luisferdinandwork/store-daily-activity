// app/api/it/users/route.ts
//
// GET  — lists every user account (all roles), joined with role/employee
//        type/store/area, plus the lookup lists (roles, employeeTypes,
//        areas, stores) the Users page needs for its filters/forms.
// POST — creates a new user account. IT-only.

import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import {
  users, userRoles, employeeTypes, stores, areas, userStoreAssignments,
} from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';

const SALT_ROUNDS = 10;

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const [userRows, roleRows, empTypeRows, areaRows, storeRows] = await Promise.all([
    db
      .select({
        id: users.id,
        nik: users.nik,
        name: users.name,
        isActive: users.isActive,

        roleId: users.roleId,
        roleCode: userRoles.code,
        roleLabel: userRoles.label,

        employeeTypeId: users.employeeTypeId,
        employeeTypeCode: employeeTypes.code,
        employeeTypeLabel: employeeTypes.label,

        homeStoreId: users.homeStoreId,
        storeName: stores.name,

        areaId: users.areaId,
        areaName: areas.name,

        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.id, users.roleId))
      .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
      .leftJoin(stores, eq(stores.id, users.homeStoreId))
      .leftJoin(areas, eq(areas.id, users.areaId))
      .orderBy(asc(users.name)),
    db.select({ id: userRoles.id, code: userRoles.code, label: userRoles.label })
      .from(userRoles)
      .where(eq(userRoles.isActive, true))
      .orderBy(asc(userRoles.sortOrder), asc(userRoles.id)),
    db.select({ id: employeeTypes.id, code: employeeTypes.code, label: employeeTypes.label })
      .from(employeeTypes)
      .where(eq(employeeTypes.isActive, true))
      .orderBy(asc(employeeTypes.sortOrder), asc(employeeTypes.id)),
    db.select({ id: areas.id, name: areas.name }).from(areas).orderBy(asc(areas.name)),
    db.select({ id: stores.id, name: stores.name, areaId: stores.areaId }).from(stores).orderBy(asc(stores.name)),
  ]);

  return NextResponse.json({
    success: true,
    users: userRows.map((u) => ({
      id: u.id,
      nik: u.nik,
      name: u.name,
      isActive: u.isActive,
      roleId: u.roleId,
      roleCode: u.roleCode,
      roleLabel: u.roleLabel,
      employeeTypeId: u.employeeTypeId,
      employeeTypeCode: u.employeeTypeCode,
      employeeTypeLabel: u.employeeTypeLabel,
      homeStoreId: u.homeStoreId,
      storeName: u.storeName,
      areaId: u.areaId,
      areaName: u.areaName,
      createdAt: u.createdAt,
    })),
    roles: roleRows,
    employeeTypes: empTypeRows,
    areas: areaRows,
    stores: storeRows,
  });
}

export async function POST(req: Request) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => null);

  const nik = typeof body?.nik === 'string' ? body.nik.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const roleId = Number(body?.roleId);
  const employeeTypeId = body?.employeeTypeId ? Number(body.employeeTypeId) : null;
  const homeStoreId = body?.homeStoreId ? Number(body.homeStoreId) : null;
  let areaId = body?.areaId ? Number(body.areaId) : null;

  if (!nik) return NextResponse.json({ success: false, error: 'NIK is required.' }, { status: 400 });
  if (!name) return NextResponse.json({ success: false, error: 'Name is required.' }, { status: 400 });
  if (!password || password.length < 6) {
    return NextResponse.json({ success: false, error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return NextResponse.json({ success: false, error: 'A role is required.' }, { status: 400 });
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.nik, nik)).limit(1);
  if (existing) {
    return NextResponse.json({ success: false, error: 'A user with this NIK already exists.' }, { status: 409 });
  }

  const [role] = await db.select({ id: userRoles.id, isActive: userRoles.isActive }).from(userRoles).where(eq(userRoles.id, roleId)).limit(1);
  if (!role || !role.isActive) {
    return NextResponse.json({ success: false, error: 'Invalid or inactive role.' }, { status: 400 });
  }

  if (employeeTypeId) {
    const [empType] = await db.select({ id: employeeTypes.id, isActive: employeeTypes.isActive }).from(employeeTypes).where(eq(employeeTypes.id, employeeTypeId)).limit(1);
    if (!empType || !empType.isActive) {
      return NextResponse.json({ success: false, error: 'Invalid or inactive employee type.' }, { status: 400 });
    }
  }

  if (homeStoreId) {
    const [store] = await db.select({ id: stores.id, areaId: stores.areaId }).from(stores).where(eq(stores.id, homeStoreId)).limit(1);
    if (!store) {
      return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 400 });
    }
    areaId = areaId ?? store.areaId;
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);

  const [created] = await db
    .insert(users)
    .values({
      nik,
      name,
      password: hashed,
      roleId,
      employeeTypeId,
      homeStoreId,
      areaId,
      isActive: true,
    })
    .returning({ id: users.id, nik: users.nik, name: users.name });

  if (homeStoreId) {
    await db.insert(userStoreAssignments).values({
      userId: created.id,
      storeId: homeStoreId,
      areaId,
      roleId,
      employeeTypeId,
      isActive: true,
      notes: 'Created through IT Users management.',
    });
  }

  return NextResponse.json({ success: true, user: created }, { status: 201 });
}

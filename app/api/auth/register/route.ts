// app/api/auth/register/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  users,
  userRoles,
  employeeTypes,
  stores,
  userStoreAssignments,
} from '@/lib/db/schema';

type RegisterBody = {
  nik?: unknown;
  name?: unknown;
  password?: unknown;

  roleId?: unknown;
  roleCode?: unknown;

  employeeTypeId?: unknown;
  employeeTypeCode?: unknown;

  homeStoreId?: unknown;
  storeId?: unknown;

  areaId?: unknown;
};

function asCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function resolveRoleId(body: RegisterBody): Promise<number | null> {
  const directRoleId = asNullableNumber(body.roleId);
  if (directRoleId) return directRoleId;

  const roleCode = asCleanString(body.roleCode || 'employee');

  const [role] = await db
    .select({
      id: userRoles.id,
      isActive: userRoles.isActive,
    })
    .from(userRoles)
    .where(eq(userRoles.code, roleCode))
    .limit(1);

  if (!role || !role.isActive) return null;

  return role.id;
}

async function resolveEmployeeTypeId(body: RegisterBody): Promise<number | null> {
  const directEmployeeTypeId = asNullableNumber(body.employeeTypeId);
  if (directEmployeeTypeId) return directEmployeeTypeId;

  const employeeTypeCode = asCleanString(body.employeeTypeCode);
  if (!employeeTypeCode) return null;

  const [employeeType] = await db
    .select({
      id: employeeTypes.id,
      isActive: employeeTypes.isActive,
    })
    .from(employeeTypes)
    .where(eq(employeeTypes.code, employeeTypeCode))
    .limit(1);

  if (!employeeType || !employeeType.isActive) return null;

  return employeeType.id;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RegisterBody;

    const nik = asCleanString(body.nik);
    const name = asCleanString(body.name);
    const password = asCleanString(body.password);

    const homeStoreId = asNullableNumber(body.homeStoreId) ?? asNullableNumber(body.storeId);
    let areaId = asNullableNumber(body.areaId);

    if (!nik) {
      return NextResponse.json(
        { error: 'NIK is required.' },
        { status: 400 },
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: 'Name is required.' },
        { status: 400 },
      );
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 400 },
      );
    }

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.nik, nik))
      .limit(1);

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this NIK already exists.' },
        { status: 400 },
      );
    }

    const roleId = await resolveRoleId(body);

    if (!roleId) {
      return NextResponse.json(
        { error: 'Invalid or inactive role.' },
        { status: 400 },
      );
    }

    const employeeTypeId = await resolveEmployeeTypeId(body);

    if (homeStoreId) {
      const [store] = await db
        .select({
          id: stores.id,
          areaId: stores.areaId,
        })
        .from(stores)
        .where(eq(stores.id, homeStoreId))
        .limit(1);

      if (!store) {
        return NextResponse.json(
          { error: 'Store not found.' },
          { status: 400 },
        );
      }

      // If areaId was not provided, inherit it from the selected store.
      areaId = areaId ?? store.areaId;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [createdUser] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        nik,
        name,
        password: hashedPassword,
        roleId,
        employeeTypeId,
        homeStoreId,
        areaId,
        isActive: true,
      })
      .returning({
        id: users.id,
        nik: users.nik,
        name: users.name,
        roleId: users.roleId,
        employeeTypeId: users.employeeTypeId,
        homeStoreId: users.homeStoreId,
        areaId: users.areaId,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    if (homeStoreId) {
      await db.insert(userStoreAssignments).values({
        userId: createdUser.id,
        storeId: homeStoreId,
        areaId,
        roleId,
        employeeTypeId,
        isActive: true,
        notes: 'Registered through auth register API.',
      });
    }

    return NextResponse.json(
      { user: createdUser },
      { status: 201 },
    );
  } catch (error) {
    console.error('Registration error:', error);

    return NextResponse.json(
      { error: 'An error occurred during registration.' },
      { status: 500 },
    );
  }
}
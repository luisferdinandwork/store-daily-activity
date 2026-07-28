// app/api/it/switch-role/route.ts
//
// POST — lets an IT user temporarily preview the app as another role.
//
//   { action: 'switch', roleCode: string, employeeTypeCode?: string }
//     → only the LIVE 'it' role may initiate; rejects if already switched
//       (must 'return' first). Snapshots the real IT role into
//       users.switchedFromRoleId/switchedFromEmployeeTypeId so it can be
//       restored, then reassigns roleId/employeeTypeId to the target.
//
//   { action: 'return' }
//     → restores roleId/employeeTypeId from switchedFromRoleId/
//       switchedFromEmployeeTypeId and clears both.
//
// Both responses include `redirectTo`, the resolved home path for the
// user's new effective role, computed the same way app/page.tsx does.
// The client must call useSession().update() after this to refresh the
// live JWT session (see the jwt callback's trigger === 'update' handling
// in lib/auth.ts) — this endpoint only changes the DB row.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { asc, eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { employeeTypes, userRoles, users } from '@/lib/db/schema';

// GET — lists active roles (and employee types) the switch-role picker can
// target. IT-only.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'it') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const [roles, empTypes] = await Promise.all([
    db
      .select({ id: userRoles.id, code: userRoles.code, label: userRoles.label })
      .from(userRoles)
      .where(eq(userRoles.isActive, true))
      .orderBy(asc(userRoles.sortOrder), asc(userRoles.id)),
    db
      .select({ id: employeeTypes.id, code: employeeTypes.code, label: employeeTypes.label })
      .from(employeeTypes)
      .where(eq(employeeTypes.isActive, true))
      .orderBy(asc(employeeTypes.sortOrder), asc(employeeTypes.id)),
  ]);

  return NextResponse.json({
    success: true,
    roles: roles.filter((r) => r.code !== 'it'),
    employeeTypes: empTypes,
  });
}

function resolveHomePath(roleCode: string, employeeTypeCode: string | null): string {
  if (roleCode === 'employee') {
    return employeeTypeCode === 'pic_1' || employeeTypeCode === 'pic_2' ? '/pic' : '/employee';
  }
  if (roleCode === 'ops')     return '/ops';
  if (roleCode === 'finance') return '/finance';
  if (roleCode === 'it')      return '/it';
  if (roleCode === 'audit')   return '/audit';
  return '/login';
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId  = session?.user?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const [actor] = await db
      .select({
        id: users.id,
        roleId: users.roleId,
        employeeTypeId: users.employeeTypeId,
        roleCode: userRoles.code,
        switchedFromRoleId: users.switchedFromRoleId,
        switchedFromEmployeeTypeId: users.switchedFromEmployeeTypeId,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.id, users.roleId))
      .where(eq(users.id, userId))
      .limit(1);

    if (!actor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'switch') {
      if (actor.roleCode !== 'it') {
        return NextResponse.json(
          { success: false, error: 'Only IT can switch roles.' },
          { status: 403 },
        );
      }

      if (actor.switchedFromRoleId) {
        return NextResponse.json(
          { success: false, error: 'Already previewing another role — return to IT first.' },
          { status: 409 },
        );
      }

      const roleCode = String(body?.roleCode ?? '');
      if (!roleCode || roleCode === 'it') {
        return NextResponse.json({ success: false, error: 'Invalid target role.' }, { status: 400 });
      }

      const [targetRole] = await db
        .select({ id: userRoles.id, code: userRoles.code, isActive: userRoles.isActive })
        .from(userRoles)
        .where(eq(userRoles.code, roleCode))
        .limit(1);

      if (!targetRole || !targetRole.isActive) {
        return NextResponse.json({ success: false, error: 'Role not found or inactive.' }, { status: 400 });
      }

      let targetEmployeeTypeId: number | null = null;
      let targetEmployeeTypeCode: string | null = null;

      if (body?.employeeTypeCode) {
        const [empType] = await db
          .select({ id: employeeTypes.id, code: employeeTypes.code, isActive: employeeTypes.isActive })
          .from(employeeTypes)
          .where(eq(employeeTypes.code, String(body.employeeTypeCode)))
          .limit(1);

        if (!empType || !empType.isActive) {
          return NextResponse.json({ success: false, error: 'Employee type not found or inactive.' }, { status: 400 });
        }
        targetEmployeeTypeId = empType.id;
        targetEmployeeTypeCode = empType.code;
      }

      await db
        .update(users)
        .set({
          roleId: targetRole.id,
          employeeTypeId: targetEmployeeTypeId,
          switchedFromRoleId: actor.roleId,
          switchedFromEmployeeTypeId: actor.employeeTypeId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return NextResponse.json({
        success: true,
        redirectTo: resolveHomePath(targetRole.code, targetEmployeeTypeCode),
      });
    }

    if (action === 'return') {
      if (!actor.switchedFromRoleId) {
        return NextResponse.json(
          { success: false, error: 'Not currently previewing another role.' },
          { status: 409 },
        );
      }

      const [realRole] = await db
        .select({ id: userRoles.id, code: userRoles.code })
        .from(userRoles)
        .where(eq(userRoles.id, actor.switchedFromRoleId))
        .limit(1);

      if (!realRole) {
        return NextResponse.json({ success: false, error: 'Original role no longer exists.' }, { status: 500 });
      }

      let realEmployeeTypeCode: string | null = null;
      if (actor.switchedFromEmployeeTypeId) {
        const [empType] = await db
          .select({ code: employeeTypes.code })
          .from(employeeTypes)
          .where(eq(employeeTypes.id, actor.switchedFromEmployeeTypeId))
          .limit(1);
        realEmployeeTypeCode = empType?.code ?? null;
      }

      await db
        .update(users)
        .set({
          roleId: realRole.id,
          employeeTypeId: actor.switchedFromEmployeeTypeId,
          switchedFromRoleId: null,
          switchedFromEmployeeTypeId: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return NextResponse.json({
        success: true,
        redirectTo: resolveHomePath(realRole.code, realEmployeeTypeCode),
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    console.error('[POST /api/it/switch-role]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

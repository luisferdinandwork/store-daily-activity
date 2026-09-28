// app/api/it/switch-role/route.ts
//
// POST — lets an IT user temporarily preview the app as another role.
//
//   { action: 'switch', roleCode, employeeTypeCode?, areaId?, storeId?, shiftId? }
//     → only the LIVE 'it' role may initiate; rejects if already switched
//       (must 'return' first). Snapshots the real IT role into
//       users.switchedFromRoleId/switchedFromEmployeeTypeId (+ real store/area
//       in switchContext), then reassigns roleId/employeeTypeId to the target.
//       ops_area needs `areaId`; employee needs `storeId` + `shiftId` — the
//       preview then gets a daily schedule (lib/role-preview.ts).
//
//   { action: 'return' }
//     → restoreRealRole(): real role/type/store/area back, preview's future
//       schedule days removed.
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
import { areas, employeeTypes, shifts, stores, userRoles, users } from '@/lib/db/schema';
import { fillPreviewSchedule, restoreRealRole } from '@/lib/role-preview';

// GET — lists active roles (and employee types) the switch-role picker can
// target. IT-only.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'it') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const [roles, empTypes, areaRows, storeRows, shiftRows] = await Promise.all([
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
    db.select({ id: areas.id, name: areas.name }).from(areas).orderBy(asc(areas.name)),
    db
      .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId })
      .from(stores)
      .orderBy(asc(stores.storeNo)),
    db
      .select({
        id: shifts.id,
        code: shifts.code,
        label: shifts.label,
        startTime: shifts.startTime,
        endTime: shifts.endTime,
      })
      .from(shifts)
      .where(eq(shifts.isActive, true))
      .orderBy(asc(shifts.sortOrder), asc(shifts.id)),
  ]);

  return NextResponse.json({
    success: true,
    roles: roles.filter((r) => r.code !== 'it'),
    employeeTypes: empTypes,
    areas: areaRows,
    stores: storeRows,
    shifts: shiftRows,
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
        homeStoreId: users.homeStoreId,
        areaId: users.areaId,
        switchedFromRoleId: users.switchedFromRoleId,
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

      // Context the target role needs to be a valid, usable session.
      let targetAreaId: number | null = null;
      let targetStoreId: number | null = null;
      let targetShiftId: number | null = null;

      if (targetRole.code === 'ops' && targetEmployeeTypeCode === 'ops_area') {
        const areaId = Number(body?.areaId);
        const [area] = Number.isInteger(areaId)
          ? await db.select({ id: areas.id }).from(areas).where(eq(areas.id, areaId)).limit(1)
          : [];
        if (!area) {
          return NextResponse.json({ success: false, error: 'Pick an area for OPS Area.' }, { status: 400 });
        }
        targetAreaId = area.id;
      }

      if (targetRole.code === 'employee') {
        const storeId = Number(body?.storeId);
        const shiftId = Number(body?.shiftId);
        const [store] = Number.isInteger(storeId)
          ? await db.select({ id: stores.id, areaId: stores.areaId }).from(stores).where(eq(stores.id, storeId)).limit(1)
          : [];
        const [shift] = Number.isInteger(shiftId)
          ? await db.select({ id: shifts.id, isActive: shifts.isActive }).from(shifts).where(eq(shifts.id, shiftId)).limit(1)
          : [];
        if (!store) {
          return NextResponse.json({ success: false, error: 'Pick a store for the employee preview.' }, { status: 400 });
        }
        if (!shift || !shift.isActive) {
          return NextResponse.json({ success: false, error: 'Pick a shift for the employee preview.' }, { status: 400 });
        }
        targetStoreId = store.id;
        targetAreaId = store.areaId;
        targetShiftId = shift.id;
      }

      await db
        .update(users)
        .set({
          roleId: targetRole.id,
          employeeTypeId: targetEmployeeTypeId,
          homeStoreId: targetStoreId,
          areaId: targetAreaId,
          switchedFromRoleId: actor.roleId,
          switchedFromEmployeeTypeId: actor.employeeTypeId,
          switchContext: {
            originalHomeStoreId: actor.homeStoreId ?? null,
            originalAreaId: actor.areaId ?? null,
            previewShiftId: targetShiftId,
          },
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      if (targetStoreId && targetShiftId) {
        try {
          await fillPreviewSchedule(userId, targetStoreId, targetShiftId);
        } catch (err) {
          console.error('[switch-role] preview schedule failed:', err);
        }
      }

      return NextResponse.json({
        success: true,
        redirectTo: resolveHomePath(targetRole.code, targetEmployeeTypeCode),
      });
    }

    if (action === 'return') {
      const restored = await restoreRealRole(userId);
      if (!restored) {
        return NextResponse.json(
          { success: false, error: 'Not currently previewing another role.' },
          { status: 409 },
        );
      }

      return NextResponse.json({
        success: true,
        redirectTo: resolveHomePath(restored.roleCode, restored.employeeTypeCode),
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    console.error('[POST /api/it/switch-role]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

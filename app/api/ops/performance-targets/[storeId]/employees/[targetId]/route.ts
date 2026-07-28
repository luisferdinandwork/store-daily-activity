// app/api/ops/performance-targets/[storeId]/employees/[targetId]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH  /api/ops/performance-targets/:storeId/employees/:targetId
//   → update a roster row's targetRoleCode / sortOrder / notes / isActive,
//     and/or its fixed monthly percentage.
//     Body: { targetRoleCode?, sortOrder?, notes?, isActive?, percentage?,
//             resetPercentage? }
//   → `percentage` sets an Ops override (isPercentageOverridden = true) and
//     rebalances the rest of the roster around it.
//   → `resetPercentage: true` clears the override, reverting this row back
//     to the default-template %.
//   → any targetRoleCode/sortOrder/isActive change re-syncs the whole
//     roster's default percentages for the (possibly changed) headcount.
//
// DELETE /api/ops/performance-targets/:storeId/employees/:targetId
//   → remove the employee from the roster for this store + month, then
//     re-syncs the remaining roster's percentages.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';

import { db } from '@/lib/db';
import { employeeMonthlyTargets, stores } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  resetEmployeeMonthlyPercentageToDefault,
  setEmployeeMonthlyPercentage,
  syncRosterPercentages,
} from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string; targetId: string }> };

const VALID_ROLES = new Set(['PIC1', 'PIC2', 'SA']);

async function loadTargetInScope(storeId: number, targetId: number, scope: Awaited<ReturnType<typeof resolveOpsScope>>) {
  if (!scope.ok) return null;

  const [row] = await db
    .select({
      target: employeeMonthlyTargets,
      areaId: stores.areaId,
    })
    .from(employeeMonthlyTargets)
    .innerJoin(stores, eq(stores.id, employeeMonthlyTargets.storeId))
    .where(
      and(
        eq(employeeMonthlyTargets.id, targetId),
        eq(employeeMonthlyTargets.storeId, storeId),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (scope.scope === 'area' && row.areaId !== scope.areaId) return null;

  return row.target;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw, targetId: targetIdRaw } = await params;
  const storeId = Number(storeIdRaw);
  const targetId = Number(targetIdRaw);

  if (!Number.isFinite(storeId) || !Number.isFinite(targetId)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const existing = await loadTargetInScope(storeId, targetId, scope);
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Roster row not found or out of scope.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);

  const updates: Partial<typeof employeeMonthlyTargets.$inferInsert> = {
    updatedBy: scope.userId,
    updatedAt: new Date(),
  };
  let structuralChange = false;

  if (typeof body?.targetRoleCode === 'string') {
    const role = body.targetRoleCode.trim().toUpperCase();
    if (!VALID_ROLES.has(role)) {
      return NextResponse.json(
        { success: false, error: 'targetRoleCode must be one of PIC1, PIC2, SA.' },
        { status: 400 },
      );
    }

    if (role === 'PIC1' || role === 'PIC2') {
      const [clash] = await db
        .select({ id: employeeMonthlyTargets.id })
        .from(employeeMonthlyTargets)
        .where(
          and(
            eq(employeeMonthlyTargets.storeId, storeId),
            eq(employeeMonthlyTargets.yearMonth, existing.yearMonth),
            eq(employeeMonthlyTargets.targetRoleCode, role),
            eq(employeeMonthlyTargets.isActive, true),
            ne(employeeMonthlyTargets.id, targetId),
          ),
        )
        .limit(1);

      if (clash) {
        return NextResponse.json(
          { success: false, error: `${role} is already assigned for this store and month.` },
          { status: 409 },
        );
      }
    }

    updates.targetRoleCode = role;
    structuralChange = true;
  }

  if (body?.sortOrder != null && Number.isFinite(Number(body.sortOrder))) {
    updates.sortOrder = Math.round(Number(body.sortOrder));
    structuralChange = true;
  }

  if (typeof body?.notes === 'string') {
    updates.notes = body.notes;
  }

  if (typeof body?.isActive === 'boolean') {
    updates.isActive = body.isActive;
    structuralChange = true;
  }

  await db
    .update(employeeMonthlyTargets)
    .set(updates)
    .where(eq(employeeMonthlyTargets.id, targetId));

  if (body?.percentage != null && Number.isFinite(Number(body.percentage))) {
    await setEmployeeMonthlyPercentage({
      employeeMonthlyTargetId: targetId,
      percentage: Number(body.percentage),
      updatedBy: scope.userId,
    });
  } else if (body?.resetPercentage === true) {
    await resetEmployeeMonthlyPercentageToDefault({
      employeeMonthlyTargetId: targetId,
      updatedBy: scope.userId,
    });
  } else if (structuralChange) {
    await syncRosterPercentages({
      storeId,
      yearMonth: existing.yearMonth,
      updatedBy: scope.userId,
    });
  }

  const [updated] = await db
    .select()
    .from(employeeMonthlyTargets)
    .where(eq(employeeMonthlyTargets.id, targetId))
    .limit(1);

  return NextResponse.json({ success: true, target: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw, targetId: targetIdRaw } = await params;
  const storeId = Number(storeIdRaw);
  const targetId = Number(targetIdRaw);

  if (!Number.isFinite(storeId) || !Number.isFinite(targetId)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const existing = await loadTargetInScope(storeId, targetId, scope);
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Roster row not found or out of scope.' }, { status: 404 });
  }

  await db.delete(employeeMonthlyTargets).where(eq(employeeMonthlyTargets.id, targetId));

  await syncRosterPercentages({
    storeId,
    yearMonth: existing.yearMonth,
    updatedBy: scope.userId,
  });

  return NextResponse.json({ success: true });
}

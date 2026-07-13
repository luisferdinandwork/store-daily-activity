// app/api/ops/performance-targets/[storeId]/employees/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/ops/performance-targets/:storeId/employees?yearMonth=YYYY-MM
//   → employees whose home store is this store, flagged with whether they
//     already have a roster row (employee_monthly_targets) for the month.
//     Used to populate the "add to roster" picker.
//
// POST /api/ops/performance-targets/:storeId/employees
//   → add an employee to the store's target roster for the month.
//   Body: { userId, yearMonth, targetRoleCode: 'PIC1'|'PIC2'|'SA', sortOrder? }
//   No amounts are set here — nominal targets are always derived per-day.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  employeeMonthlyTargets,
  stores,
  users,
} from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { ensureStoreMonthlyTargetPlan, toYearMonth } from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string }> };

const VALID_ROLES = new Set(['PIC1', 'PIC2', 'SA']);

async function loadStoreInScope(storeId: number, scope: Awaited<ReturnType<typeof resolveOpsScope>>) {
  if (!scope.ok) return null;

  const [store] = await db
    .select({ id: stores.id, areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return null;
  if (scope.scope === 'area' && store.areaId !== scope.areaId) return null;

  return store;
}

export async function GET(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw } = await params;
  const storeId = Number(storeIdRaw);

  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid store id.' }, { status: 400 });
  }

  const store = await loadStoreInScope(storeId, scope);
  if (!store) {
    return NextResponse.json({ success: false, error: 'Store not found or out of scope.' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const yearMonth = searchParams.get('yearMonth') ?? toYearMonth(new Date());

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'yearMonth must be in YYYY-MM format.' },
      { status: 400 },
    );
  }

  const employees = await db
    .select({ id: users.id, nik: users.nik, name: users.name })
    .from(users)
    .where(and(eq(users.homeStoreId, storeId), eq(users.isActive, true)));

  const existing = await db
    .select({ userId: employeeMonthlyTargets.userId, id: employeeMonthlyTargets.id })
    .from(employeeMonthlyTargets)
    .where(
      and(
        eq(employeeMonthlyTargets.storeId, storeId),
        eq(employeeMonthlyTargets.yearMonth, yearMonth),
        eq(employeeMonthlyTargets.isActive, true),
      ),
    );

  const rosteredUserIds = new Set(existing.map((row) => row.userId));

  const result = employees.map((employee) => ({
    ...employee,
    hasTarget: rosteredUserIds.has(employee.id),
  }));

  return NextResponse.json({ success: true, employees: result });
}

export async function POST(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw } = await params;
  const storeId = Number(storeIdRaw);

  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid store id.' }, { status: 400 });
  }

  const store = await loadStoreInScope(storeId, scope);
  if (!store) {
    return NextResponse.json({ success: false, error: 'Store not found or out of scope.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);

  const userId = body?.userId as string | undefined;
  const yearMonth = body?.yearMonth as string | undefined;

  if (!userId) {
    return NextResponse.json({ success: false, error: 'userId is required.' }, { status: 400 });
  }

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'yearMonth must be in YYYY-MM format.' },
      { status: 400 },
    );
  }

  const targetRoleCode = (body?.targetRoleCode as string | undefined)?.trim().toUpperCase() || 'SA';
  if (!VALID_ROLES.has(targetRoleCode)) {
    return NextResponse.json(
      { success: false, error: 'targetRoleCode must be one of PIC1, PIC2, SA.' },
      { status: 400 },
    );
  }

  // Confirm the user belongs to this store.
  const [user] = await db
    .select({ id: users.id, homeStoreId: users.homeStoreId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.homeStoreId !== storeId) {
    return NextResponse.json(
      { success: false, error: 'Employee is not assigned to this store.' },
      { status: 400 },
    );
  }

  // Only one PIC1 and one PIC2 per store + month.
  if (targetRoleCode === 'PIC1' || targetRoleCode === 'PIC2') {
    const [clash] = await db
      .select({ id: employeeMonthlyTargets.id })
      .from(employeeMonthlyTargets)
      .where(
        and(
          eq(employeeMonthlyTargets.storeId, storeId),
          eq(employeeMonthlyTargets.yearMonth, yearMonth),
          eq(employeeMonthlyTargets.targetRoleCode, targetRoleCode),
          eq(employeeMonthlyTargets.isActive, true),
        ),
      )
      .limit(1);

    if (clash) {
      return NextResponse.json(
        { success: false, error: `${targetRoleCode} is already assigned for this store and month.` },
        { status: 409 },
      );
    }
  }

  const sortOrder = Number.isFinite(Number(body?.sortOrder)) ? Math.round(Number(body.sortOrder)) : 0;

  const planId = await ensureStoreMonthlyTargetPlan({
    storeId,
    yearMonth,
    createdBy: scope.userId,
  });

  try {
    const [created] = await db
      .insert(employeeMonthlyTargets)
      .values({
        storeMonthlyTargetId: planId,
        userId,
        storeId,
        yearMonth,
        targetRoleCode,
        sortOrder,
        notes: typeof body?.notes === 'string' ? body.notes : null,
        isActive: true,
        createdBy: scope.userId,
        updatedBy: scope.userId,
      })
      .returning();

    return NextResponse.json({ success: true, target: created });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: 'This employee already has a roster row for this store and month.' },
      { status: 409 },
    );
  }
}
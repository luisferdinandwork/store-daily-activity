// app/api/ops/performance-targets/[storeId]/employees/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/ops/performance-targets/:storeId/employees?yearMonth=YYYY-MM
//   → employees assigned (homeStoreId) to this store, with their existing
//     employee_monthly_targets row for the month (if any). Used to populate
//     the "add target" picker with employees who don't yet have a target.
//
// POST /api/ops/performance-targets/:storeId/employees
//   → create a new employee_monthly_targets row for this store + month.
//   Body: { userId, yearMonth, targetRoleCode, targetWeightPct,
//           monthlySalesTarget, monthlyTransactionTarget, monthlyAtvTarget?, notes? }
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
import {
  calculateAtvTarget,
  ensureStoreMonthlyTargetPlan,
  safeNumber,
  toYearMonth,
} from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string }> };

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

  // Employees whose current home store is this store.
  const employees = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
    })
    .from(users)
    .where(and(eq(users.homeStoreId, storeId), eq(users.isActive, true)));

  // Existing targets for this store + month, by userId.
  const existing = await db
    .select({
      userId: employeeMonthlyTargets.userId,
      id: employeeMonthlyTargets.id,
    })
    .from(employeeMonthlyTargets)
    .where(
      and(
        eq(employeeMonthlyTargets.storeId, storeId),
        eq(employeeMonthlyTargets.yearMonth, yearMonth),
      ),
    );

  const targetedUserIds = new Set(existing.map((row) => row.userId));

  const result = employees.map((employee) => ({
    ...employee,
    hasTarget: targetedUserIds.has(employee.id),
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

  const targetRoleCode = (body?.targetRoleCode as string | undefined)?.trim() || 'SA';
  const targetWeightPct = safeNumber(body?.targetWeightPct ?? 100);
  const monthlySalesTarget = safeNumber(body?.monthlySalesTarget);
  const monthlyTransactionTarget = Math.round(safeNumber(body?.monthlyTransactionTarget));
  const monthlyAtvTarget = calculateAtvTarget(monthlySalesTarget, monthlyTransactionTarget);

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
        targetWeightPct: targetWeightPct.toFixed(2),
        monthlySalesTarget: String(monthlySalesTarget),
        monthlyTransactionTarget,
        monthlyAtvTarget: String(monthlyAtvTarget),
        notes: typeof body?.notes === 'string' ? body.notes : null,
        isActive: true,
        createdBy: scope.userId,
        updatedBy: scope.userId,
      })
      .returning();

    return NextResponse.json({ success: true, target: created });
  } catch (err) {
    // Likely the unique (userId, storeId, yearMonth) constraint.
    return NextResponse.json(
      { success: false, error: 'This employee already has a target for this store and month.' },
      { status: 409 },
    );
  }
}
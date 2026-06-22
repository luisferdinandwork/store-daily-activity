// app/api/ops/performance-targets/[storeId]/employees/[targetId]/calendar/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets/:storeId/employees/:targetId/calendar?yearMonth=YYYY-MM
//
// Returns one employee's daily sales actuals (from Business Central) for
// every day of the given month — used by the "monthly sales calendar"
// widget in the employee target table's Aksi column.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { employeeMonthlyTargets, stores, users } from '@/lib/db/schema';
import { getEmployeeDailyActualsForMonth } from '@/lib/performance/employee-actuals';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { toYearMonth } from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string; targetId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
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

  const [row] = await db
    .select({
      nik: users.nik,
      name: users.name,
      storeNo: stores.storeNo,
      areaId: stores.areaId,
    })
    .from(employeeMonthlyTargets)
    .innerJoin(users, eq(users.id, employeeMonthlyTargets.userId))
    .innerJoin(stores, eq(stores.id, employeeMonthlyTargets.storeId))
    .where(
      and(
        eq(employeeMonthlyTargets.id, targetId),
        eq(employeeMonthlyTargets.storeId, storeId),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ success: false, error: 'Target not found.' }, { status: 404 });
  }

  if (scope.scope === 'area' && row.areaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'Forbidden.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const yearMonth = searchParams.get('yearMonth') ?? toYearMonth(new Date());

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ success: false, error: 'yearMonth must be in YYYY-MM format.' }, { status: 400 });
  }

  const result = await getEmployeeDailyActualsForMonth({
    storeNo: row.storeNo,
    yearMonth,
    nik: row.nik,
  });

  return NextResponse.json({
    success: true,
    yearMonth,
    employee: { name: row.name, nik: row.nik },
    available: result.available,
    error: result.error,
    totalSales: result.totalSales,
    totalTransactionCount: result.totalTransactionCount,
    days: Array.from(result.byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
  });
}
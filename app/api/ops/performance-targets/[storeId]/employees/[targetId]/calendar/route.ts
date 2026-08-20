// app/api/ops/performance-targets/[storeId]/employees/[targetId]/calendar/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/performance-targets/:storeId/employees/:targetId/calendar
//     ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//
// Returns one employee's daily sales actuals (from Business Central) for
// every day in the given range (inclusive) — used by the "achievement
// timeline" widget in the employee target table's Aksi column, where Ops
// picks a period and sees how many days the employee hit their target.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { employeeMonthlyTargets, stores, users } from '@/lib/db/schema';
import { getEmployeeDailyActualsForRange } from '@/lib/performance/employee-actuals';
import { resolveOpsScope } from '@/lib/performance/ops-scope';

type Params = { params: Promise<{ storeId: string; targetId: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

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
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!startDate || !endDate || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json(
      { success: false, error: 'startDate and endDate (YYYY-MM-DD) are required.' },
      { status: 400 },
    );
  }

  if (startDate > endDate) {
    return NextResponse.json({ success: false, error: 'startDate must not be after endDate.' }, { status: 400 });
  }

  const spanDays = Math.round(
    (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000,
  ) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { success: false, error: `Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari.` },
      { status: 400 },
    );
  }

  const result = await getEmployeeDailyActualsForRange({
    storeNo: row.storeNo,
    nik: row.nik,
    startDate,
    endDate,
  });

  return NextResponse.json({
    success: true,
    startDate,
    endDate,
    employee: { name: row.name, nik: row.nik },
    available: result.available,
    error: result.error,
    totalSales: result.totalSales,
    totalTransactionCount: result.totalTransactionCount,
    days: Array.from(result.byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
  });
}

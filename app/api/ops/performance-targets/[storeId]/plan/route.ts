// app/api/ops/performance-targets/[storeId]/plan/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/performance-targets/:storeId/plan
//
// Updates (or creates, via ensureStoreMonthlyTargetPlan) the
// store_monthly_targets "header" row for a store + month:
//   - monthlySalesTarget / monthlyTransactionTarget  ← NEW: Ops sets these
//     DIRECTLY now. This is the single number that gets divided by days-in-
//     month and then split across the roster every day (see target-utils.ts).
//   - isLocked
//   - notes
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores, storeMonthlyTargets } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { ensureStoreMonthlyTargetPlan, safeNumber } from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw } = await params;
  const storeId = Number(storeIdRaw);

  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid store id.' }, { status: 400 });
  }

  const [store] = await db
    .select({ id: stores.id, areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  if (scope.scope === 'area' && store.areaId !== scope.areaId) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: store is outside your assigned area.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);

  const yearMonth = body?.yearMonth as string | undefined;
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'yearMonth must be in YYYY-MM format.' },
      { status: 400 },
    );
  }

  const planId = await ensureStoreMonthlyTargetPlan({
    storeId,
    yearMonth,
    createdBy: scope.userId,
  });

  const updates: Partial<typeof storeMonthlyTargets.$inferInsert> = {
    updatedBy: scope.userId,
    updatedAt: new Date(),
  };

  if (body?.monthlySalesTarget != null) {
    updates.monthlySalesTarget = String(Math.max(0, safeNumber(body.monthlySalesTarget)));
  }

  if (body?.monthlyTransactionTarget != null) {
    updates.monthlyTransactionTarget = Math.max(0, Math.round(safeNumber(body.monthlyTransactionTarget)));
  }

  if (typeof body?.isLocked === 'boolean') {
    updates.isLocked = body.isLocked;
    updates.lockedAt = body.isLocked ? new Date() : null;
    updates.lockedBy = body.isLocked ? scope.userId : null;
  }

  if (typeof body?.notes === 'string') {
    updates.notes = body.notes;
  }

  const [updated] = await db
    .update(storeMonthlyTargets)
    .set(updates)
    .where(eq(storeMonthlyTargets.id, planId))
    .returning();

  return NextResponse.json({ success: true, plan: updated });
}
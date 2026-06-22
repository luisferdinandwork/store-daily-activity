// app/api/ops/performance-targets/[storeId]/plan/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/performance-targets/:storeId/plan
//
// Updates (or creates, via ensureStoreMonthlyTargetPlan) the
// store_monthly_targets "header" row for a store + month:
//   - isLocked
//   - notes
//
// Store target *numbers* are never written here — they remain derived from
// employee_monthly_targets (see target-utils.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, stores, storeMonthlyTargets } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { ensureStoreMonthlyTargetPlan } from '@/lib/performance/target-utils';

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
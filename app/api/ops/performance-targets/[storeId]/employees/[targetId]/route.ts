// app/api/ops/performance-targets/[storeId]/employees/[targetId]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH  /api/ops/performance-targets/:storeId/employees/:targetId
//   → update an employee_monthly_targets row.
//
//   Body shape:
//     { targetRoleCode?, notes?, isActive? }                        — simple field updates, no rebalancing
//     { editMode: 'amount', monthlySalesTarget, monthlyTransactionTarget }
//       → the edited row's target AMOUNTS change directly. The store total
//         shifts by the delta; every row's weightPct is recomputed as
//         amount / newStoreTotal * 100 (amounts of other rows stay fixed).
//     { editMode: 'weight', targetWeightPct }
//       → the edited row's WEIGHT changes directly. Store total stays fixed.
//         PIC1/PIC2 (other than the edited row, if it's a PIC) keep their
//         weight; the SA pool is redistributed proportionally. All rows'
//         amounts are re-derived from the new weights.
//
//   In both rebalance modes, ALL active rows for the store + month are
//   updated in a single transaction so totals stay consistent.
//
// DELETE /api/ops/performance-targets/:storeId/employees/:targetId
//   → remove the row (hard delete; store rollup recalculates automatically).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { employeeMonthlyTargets, stores } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  calculateAtvTarget,
  rebalanceAfterAmountEdit,
  rebalanceAfterWeightEdit,
  safeNumber,
  type RebalanceRow,
} from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string; targetId: string }> };

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
    return NextResponse.json({ success: false, error: 'Target not found or out of scope.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const editMode = body?.editMode === 'amount' || body?.editMode === 'weight' ? body.editMode : null;

  // ── Rebalance modes: amount or weight edit, touches every active sibling row ──
  if (editMode) {
    const siblingRows = await db
      .select({
        id: employeeMonthlyTargets.id,
        targetRoleCode: employeeMonthlyTargets.targetRoleCode,
        targetWeightPct: employeeMonthlyTargets.targetWeightPct,
        monthlySalesTarget: employeeMonthlyTargets.monthlySalesTarget,
        monthlyTransactionTarget: employeeMonthlyTargets.monthlyTransactionTarget,
      })
      .from(employeeMonthlyTargets)
      .where(
        and(
          eq(employeeMonthlyTargets.storeId, storeId),
          eq(employeeMonthlyTargets.yearMonth, existing.yearMonth),
          eq(employeeMonthlyTargets.isActive, true),
        ),
      );

    const rebalanceInput: RebalanceRow[] = siblingRows.map((row) => ({
      id: row.id,
      targetRoleCode: row.targetRoleCode,
      targetWeightPct: safeNumber(row.targetWeightPct),
      monthlySalesTarget: safeNumber(row.monthlySalesTarget),
      monthlyTransactionTarget: safeNumber(row.monthlyTransactionTarget),
    }));

    let rebalanced: RebalanceRow[];

    if (editMode === 'amount') {
      if (body?.monthlySalesTarget == null || body?.monthlyTransactionTarget == null) {
        return NextResponse.json(
          { success: false, error: 'monthlySalesTarget and monthlyTransactionTarget are required for editMode=amount.' },
          { status: 400 },
        );
      }

      rebalanced = rebalanceAfterAmountEdit({
        rows: rebalanceInput,
        editedId: targetId,
        newMonthlySalesTarget: Math.round(safeNumber(body.monthlySalesTarget)),
        newMonthlyTransactionTarget: Math.round(safeNumber(body.monthlyTransactionTarget)),
      });
    } else {
      if (body?.targetWeightPct == null) {
        return NextResponse.json(
          { success: false, error: 'targetWeightPct is required for editMode=weight.' },
          { status: 400 },
        );
      }

      rebalanced = rebalanceAfterWeightEdit({
        rows: rebalanceInput,
        editedId: targetId,
        newWeightPct: safeNumber(body.targetWeightPct),
      });
    }

    // Apply simple field updates (role/notes/isActive) to the edited row
    // alongside the rebalanced amounts/weights.
    const extraUpdates: Partial<typeof employeeMonthlyTargets.$inferInsert> = {};
    if (typeof body?.targetRoleCode === 'string' && body.targetRoleCode.trim()) {
      extraUpdates.targetRoleCode = body.targetRoleCode.trim();
    }
    if (typeof body?.notes === 'string') extraUpdates.notes = body.notes;
    if (typeof body?.isActive === 'boolean') extraUpdates.isActive = body.isActive;

    const updatedRows = await db.transaction(async (tx) => {
      const results: (typeof employeeMonthlyTargets.$inferSelect)[] = [];

      for (const row of rebalanced) {
        const isEdited = row.id === targetId;
        const monthlyAtvTarget = calculateAtvTarget(row.monthlySalesTarget, row.monthlyTransactionTarget);

        const [updated] = await tx
          .update(employeeMonthlyTargets)
          .set({
            targetWeightPct: row.targetWeightPct.toFixed(2),
            monthlySalesTarget: String(row.monthlySalesTarget),
            monthlyTransactionTarget: row.monthlyTransactionTarget,
            monthlyAtvTarget: String(monthlyAtvTarget),
            updatedBy: scope.userId,
            updatedAt: new Date(),
            ...(isEdited ? extraUpdates : {}),
          })
          .where(eq(employeeMonthlyTargets.id, row.id))
          .returning();

        results.push(updated);
      }

      return results;
    });

    const target = updatedRows.find((row) => row.id === targetId) ?? null;

    return NextResponse.json({ success: true, target, updatedTargets: updatedRows });
  }

  // ── Simple field updates only (no amount/weight change) ──
  const updates: Partial<typeof employeeMonthlyTargets.$inferInsert> = {
    updatedBy: scope.userId,
    updatedAt: new Date(),
  };

  if (typeof body?.targetRoleCode === 'string' && body.targetRoleCode.trim()) {
    updates.targetRoleCode = body.targetRoleCode.trim();
  }

  if (typeof body?.notes === 'string') {
    updates.notes = body.notes;
  }

  if (typeof body?.isActive === 'boolean') {
    updates.isActive = body.isActive;
  }

  const [updated] = await db
    .update(employeeMonthlyTargets)
    .set(updates)
    .where(eq(employeeMonthlyTargets.id, targetId))
    .returning();

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
    return NextResponse.json({ success: false, error: 'Target not found or out of scope.' }, { status: 404 });
  }

  await db.delete(employeeMonthlyTargets).where(eq(employeeMonthlyTargets.id, targetId));

  return NextResponse.json({ success: true });
}
// app/api/ops/petty-cash/[txId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { stores } from '@/lib/db/schema/core';
import { pettyCashPeriods, pettyCashTransactions } from '@/lib/db/schema/petty-cash';

type Params = {
  params: Promise<{
    txId: string;
  }>;
};

export async function PATCH(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();

  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  const { txId: txIdStr } = await params;
  const txId = Number(txIdStr);

  if (Number.isNaN(txId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid txId.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const action =
    body?.action === 'approve' || body?.action === 'reject'
      ? body.action
      : null;

  const rejectionReason =
    typeof body?.rejectionReason === 'string'
      ? body.rejectionReason.trim()
      : null;

  if (!action) {
    return NextResponse.json(
      { success: false, error: 'Action must be approve or reject.' },
      { status: 400 },
    );
  }

  // Rejection reason is optional — Ops can reject without explaining, though
  // giving one helps the employee understand what to fix before resubmitting.

  const [requestRow] = await db
    .select({
      id: pettyCashTransactions.id,
      storeId: pettyCashTransactions.storeId,
      status: pettyCashTransactions.status,
      storeAreaId: stores.areaId,
    })
    .from(pettyCashTransactions)
    .innerJoin(stores, eq(stores.id, pettyCashTransactions.storeId))
    .where(eq(pettyCashTransactions.id, txId))
    .limit(1);

  if (!requestRow) {
    return NextResponse.json(
      { success: false, error: 'Petty cash request not found.' },
      { status: 404 },
    );
  }

  if (scope.scope === 'area' && requestRow.storeAreaId !== scope.areaId) {
    return NextResponse.json(
      {
        success: false,
        error: 'You can only approve petty cash requests from your assigned area.',
      },
      { status: 403 },
    );
  }

  if (requestRow.status !== 'pending_ops') {
    return NextResponse.json(
      {
        success: false,
        error: 'This request has already been processed.',
      },
      { status: 409 },
    );
  }

  if (action === 'reject') {
    const [rejected] = await db
      .update(pettyCashTransactions)
      .set({
        status: 'ops_rejected',
        rejectedBy: scope.userId,
        rejectedAt: new Date(),
        rejectionReason,
      })
      .where(
        and(
          eq(pettyCashTransactions.id, txId),
          eq(pettyCashTransactions.status, 'pending_ops'),
        ),
      )
      .returning({
        id: pettyCashTransactions.id,
      });

    if (!rejected) {
      return NextResponse.json(
        {
          success: false,
          error: 'Reject failed. Please refresh and try again.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      txId: rejected.id,
      status: 'ops_rejected',
    });
  }

  // OPS approval no longer deducts the balance — the requested amount is
  // just an estimate. The PIC records the actual amount used afterward (see
  // PATCH /api/employee/petty-cash), and that's what actually gets cut from
  // the store's ready petty cash.
  const [approved] = await db
    .update(pettyCashTransactions)
    .set({
      status: 'ops_approved',
      approvedBy: scope.userId,
      approvedAt: new Date(),
    })
    .where(
      and(
        eq(pettyCashTransactions.id, txId),
        eq(pettyCashTransactions.status, 'pending_ops'),
      ),
    )
    .returning({
      id: pettyCashTransactions.id,
      status: pettyCashTransactions.status,
    });

  if (!approved) {
    return NextResponse.json(
      {
        success: false,
        error: 'Approval failed. Request may already be processed.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    txId: approved.id,
    status: approved.status,
  });
}

/**
 * DELETE — IT only. Removes a petty cash request outright, for double entries
 * or mistakes by Ops / the PIC. A completed request had already cut its actual
 * amount from the store's balance, so that amount is put back on the period
 * (when it is still open; a closed period's balance was already rolled over).
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();

  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  if (!scope.isIt) {
    return NextResponse.json(
      { success: false, error: 'Only IT can delete petty cash requests.' },
      { status: 403 },
    );
  }

  const { txId: txIdStr } = await params;
  const txId = Number(txIdStr);

  if (!Number.isInteger(txId) || txId <= 0) {
    return NextResponse.json(
      { success: false, error: 'Invalid txId.' },
      { status: 400 },
    );
  }

  const result = await db.transaction(async (trx) => {
    const [deleted] = await trx
      .delete(pettyCashTransactions)
      .where(eq(pettyCashTransactions.id, txId))
      .returning({
        id: pettyCashTransactions.id,
        status: pettyCashTransactions.status,
        periodId: pettyCashTransactions.periodId,
        actualAmount: pettyCashTransactions.actualAmount,
      });

    if (!deleted) return null;

    let balanceRestored = false;

    if (deleted.status === 'completed' && deleted.periodId != null && deleted.actualAmount != null) {
      const restored = await trx
        .update(pettyCashPeriods)
        .set({
          currentBalance: sql`${pettyCashPeriods.currentBalance} + ${deleted.actualAmount}::numeric`,
        })
        .where(and(eq(pettyCashPeriods.id, deleted.periodId), eq(pettyCashPeriods.status, 'open')))
        .returning({ id: pettyCashPeriods.id });

      balanceRestored = restored.length > 0;
    }

    return { id: deleted.id, balanceRestored };
  });

  if (!result) {
    return NextResponse.json(
      { success: false, error: 'Petty cash request not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    txId: result.id,
    balanceRestored: result.balanceRestored,
  });
}

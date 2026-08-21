// app/api/ops/petty-cash/[txId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { stores } from '@/lib/db/schema/core';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';

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

  if (action === 'reject' && !rejectionReason) {
    return NextResponse.json(
      { success: false, error: 'Rejection reason is required.' },
      { status: 422 },
    );
  }

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
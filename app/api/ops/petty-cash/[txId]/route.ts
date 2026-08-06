// app/api/ops/petty-cash/[txId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { stores } from '@/lib/db/schema/core';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';

type Params = {
  params: Promise<{
    txId: string;
  }>;
};

function getRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;

  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    return (result as { rows: unknown[] }).rows;
  }

  return [];
}

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
      periodId: pettyCashTransactions.periodId,
      yearMonth: pettyCashTransactions.yearMonth,
      amount: pettyCashTransactions.amount,
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

  // The period was already fixed at request-creation time (see
  // POST /api/employee/petty-cash) — we deduct from that exact row rather
  // than re-deriving one by yearMonth, since balance now carries forward
  // across months instead of resetting on the calendar.
  if (!requestRow.periodId) {
    return NextResponse.json(
      { success: false, error: 'Petty cash period not found.' },
      { status: 500 },
    );
  }

  const amount = Number(requestRow.amount).toFixed(2);

  // Neon HTTP safe:
  // 1. Deduct balance only if enough balance exists.
  // 2. Approve the request only if deduction succeeds.
  const result = await db.execute(sql`
    WITH updated_period AS (
      UPDATE petty_cash_periods
      SET
        current_balance = current_balance - ${amount}::numeric,
        updated_at = NOW()
      WHERE id = ${requestRow.periodId}
        AND status = 'open'
        AND current_balance >= ${amount}::numeric
      RETURNING
        id,
        current_balance::text AS new_balance
    ),

    approved_request AS (
      UPDATE petty_cash_transactions
      SET
        period_id = updated_period.id,
        status = 'ops_approved',
        approved_by = ${scope.userId},
        approved_at = NOW(),
        updated_at = NOW()
      FROM updated_period
      WHERE petty_cash_transactions.id = ${txId}
        AND petty_cash_transactions.status = 'pending_ops'
      RETURNING
        petty_cash_transactions.id::int AS tx_id,
        petty_cash_transactions.status
    )

    SELECT
      approved_request.tx_id,
      approved_request.status,
      updated_period.new_balance
    FROM approved_request
    CROSS JOIN updated_period
  `);

  const rows = getRows(result);

  const row = rows[0] as
    | {
        tx_id: number;
        status: string;
        new_balance: string;
      }
    | undefined;

  if (!row) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Approval failed. Insufficient balance or request already processed.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    txId: row.tx_id,
    status: row.status,
    newBalance: row.new_balance,
  });
}
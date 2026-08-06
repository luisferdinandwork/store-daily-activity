// app/api/finance/petty-cash/[storeId]/refill/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveFinanceScope } from '@/lib/finance/scope';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefills,
  pettyCashTransactions,
} from '@/lib/db/schema/petty-cash';
import { stores } from '@/lib/db/schema/core';

type Params = { params: Promise<{ storeId: string }> };

function getJakartaMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;

  return `${year}-${month}`;
}

function addMonths(ym: string, amount: number) {
  const [year, month] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + amount, 1));

  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isValidMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

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

export async function POST(req: NextRequest, { params }: Params) {
  const scope = await resolveFinanceScope();

  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  const { storeId: storeIdStr } = await params;
  const storeId = Number(storeIdStr);

  if (Number.isNaN(storeId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid storeId.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const yearMonth =
    typeof body?.yearMonth === 'string' && body.yearMonth.trim()
      ? body.yearMonth.trim()
      : getJakartaMonth();

  if (!isValidMonth(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'Invalid yearMonth. Use YYYY-MM.' },
      { status: 400 },
    );
  }

  const notes = typeof body?.notes === 'string' ? body.notes.trim() : null;
  const nextYearMonth = addMonths(yearMonth, 1);

  const [storeRow] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!storeRow) {
    return NextResponse.json(
      { success: false, error: 'Store not found.' },
      { status: 404 },
    );
  }

  const [existingRefill] = await db
    .select({ id: pettyCashRefills.id })
    .from(pettyCashRefills)
    .where(
      and(
        eq(pettyCashRefills.storeId, storeId),
        eq(pettyCashRefills.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  if (existingRefill) {
    return NextResponse.json(
      {
        success: false,
        error: 'This store has already been closed/refilled for this month.',
      },
      { status: 409 },
    );
  }

  const txRows = await db
    .select({
      amount: pettyCashTransactions.amount,
      status: pettyCashTransactions.status,
    })
    .from(pettyCashTransactions)
    .where(
      and(
        eq(pettyCashTransactions.storeId, storeId),
        eq(pettyCashTransactions.yearMonth, yearMonth),
      ),
    );

  const pendingOpsCount = txRows.filter((tx) => tx.status === 'pending_ops').length;

  if (pendingOpsCount > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'There are still petty cash requests waiting for OPS approval.',
      },
      { status: 422 },
    );
  }

  const [period] = await db
    .select({
      id: pettyCashPeriods.id,
      openingBalance: pettyCashPeriods.openingBalance,
      currentBalance: pettyCashPeriods.currentBalance,
      status: pettyCashPeriods.status,
    })
    .from(pettyCashPeriods)
    .where(
      and(
        eq(pettyCashPeriods.storeId, storeId),
        eq(pettyCashPeriods.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  if (period?.status === 'closed') {
    return NextResponse.json(
      {
        success: false,
        error: 'This petty cash month is already closed.',
      },
      { status: 409 },
    );
  }

  const approvedSpend = txRows
    .filter((tx) => tx.status === 'ops_approved')
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const fallbackBalance = Math.max(0, PETTY_CASH_MAX_BALANCE - approvedSpend);

  const balanceBefore = Number(period?.currentBalance ?? fallbackBalance);

  const refillAmount = Math.max(
    0,
    PETTY_CASH_MAX_BALANCE - balanceBefore,
  );

  const balanceAfter = PETTY_CASH_MAX_BALANCE;

  const result = await db.execute(sql`
    WITH closed_period AS (
      INSERT INTO petty_cash_periods (
        store_id,
        year_month,
        opening_balance,
        current_balance,
        closing_balance,
        status,
        closed_by,
        closed_at
      )
      VALUES (
        ${storeId},
        ${yearMonth},
        ${String(PETTY_CASH_MAX_BALANCE)}::numeric,
        ${String(balanceBefore)}::numeric,
        ${String(balanceBefore)}::numeric,
        'closed',
        ${scope.userId},
        NOW()
      )
      ON CONFLICT (store_id, year_month)
      DO UPDATE SET
        current_balance = EXCLUDED.current_balance,
        closing_balance = EXCLUDED.closing_balance,
        status = 'closed',
        closed_by = EXCLUDED.closed_by,
        closed_at = NOW(),
        updated_at = NOW()
      RETURNING id
    ),

    inserted_refill AS (
      INSERT INTO petty_cash_refills (
        store_id,
        year_month,
        next_year_month,
        refill_amount,
        balance_before,
        balance_after,
        refill_by,
        notes
      )
      SELECT
        ${storeId},
        ${yearMonth},
        ${nextYearMonth},
        ${String(refillAmount)}::numeric,
        ${String(balanceBefore)}::numeric,
        ${String(balanceAfter)}::numeric,
        ${scope.userId},
        ${notes}
      FROM closed_period
      ON CONFLICT (store_id, year_month)
      DO NOTHING
      RETURNING id
    ),

    next_period AS (
      INSERT INTO petty_cash_periods (
        store_id,
        year_month,
        opening_balance,
        current_balance,
        status
      )
      SELECT
        ${storeId},
        ${nextYearMonth},
        ${String(PETTY_CASH_MAX_BALANCE)}::numeric,
        ${String(PETTY_CASH_MAX_BALANCE)}::numeric,
        'open'
      FROM inserted_refill
      ON CONFLICT (store_id, year_month)
      DO NOTHING
      RETURNING id
    ),

    legacy_store_update AS (
      UPDATE stores
      SET petty_cash_balance = ${String(PETTY_CASH_MAX_BALANCE)}::numeric
      WHERE id = ${storeId}
        AND EXISTS (SELECT 1 FROM inserted_refill)
      RETURNING id
    )

    SELECT
      inserted_refill.id::int AS refill_id
    FROM inserted_refill
  `);

  const rows = getRows(result);

  const row = rows[0] as
    | {
        refill_id: number;
      }
    | undefined;

  if (!row) {
    return NextResponse.json(
      {
        success: false,
        error: 'Refill failed. It may have already been processed.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    refillId: row.refill_id,
    closedYearMonth: yearMonth,
    nextYearMonth,
    refillAmount,
    balanceBefore,
    balanceAfter,
  });
}
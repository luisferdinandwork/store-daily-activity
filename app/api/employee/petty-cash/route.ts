// app/api/employee/petty-cash/route.ts
//
// GET  — returns the employee's store current monthly petty cash balance
//        + this month's transaction history.
//
// POST — submit a new petty cash transaction:
//          { amount, description, imageUrl, imageKey }
//
// Important:
//   - Uses petty_cash_periods as the real monthly petty cash ledger.
//   - Does NOT use db.transaction(), so it is safer for Neon HTTP.
//   - Uses one atomic SQL CTE for "deduct balance + insert transaction".

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { stores, users } from '@/lib/db/schema/core';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashTransactions,
} from '@/lib/db/schema/petty-cash';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentYearMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;

  return `${year}-${month}`;
}

async function getEmployeeStore(userId: string) {
  const [user] = await db
    .select({
      homeStoreId: users.homeStoreId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user?.homeStoreId ?? null;
}

async function ensurePettyCashPeriod(storeId: number, yearMonth: string) {
  await db
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: String(PETTY_CASH_MAX_BALANCE),
      currentBalance: String(PETTY_CASH_MAX_BALANCE),
      status: 'open',
    })
    .onConflictDoNothing({
      target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth],
    });

  const [period] = await db
    .select({
      id: pettyCashPeriods.id,
      openingBalance: pettyCashPeriods.openingBalance,
      currentBalance: pettyCashPeriods.currentBalance,
      closingBalance: pettyCashPeriods.closingBalance,
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

  return period ?? null;
}

// ─── GET /api/employee/petty-cash ─────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = await getEmployeeStore(userId);

  if (!storeId) {
    return NextResponse.json({ error: 'No store assigned.' }, { status: 403 });
  }

  const month = currentYearMonth();

  const [store] = await db
    .select({
      name: stores.name,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) {
    return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  }

  const period = await ensurePettyCashPeriod(storeId, month);

  if (!period) {
    return NextResponse.json(
      { error: 'Petty cash period could not be created.' },
      { status: 500 },
    );
  }

  const txList = await db
    .select({
      id: pettyCashTransactions.id,
      amount: pettyCashTransactions.amount,
      description: pettyCashTransactions.description,
      imageUrl: pettyCashTransactions.imageUrl,
      verifiedAt: pettyCashTransactions.verifiedAt,
      createdAt: pettyCashTransactions.createdAt,
    })
    .from(pettyCashTransactions)
    .where(
      and(
        eq(pettyCashTransactions.storeId, storeId),
        eq(pettyCashTransactions.yearMonth, month),
        isNull(pettyCashTransactions.archivedAt),
      ),
    )
    .orderBy(desc(pettyCashTransactions.createdAt));

  return NextResponse.json({
    success: true,
    storeName: store.name,
    balance: period.currentBalance ?? '0',
    openingBalance: period.openingBalance,
    closingBalance: period.closingBalance,
    periodStatus: period.status,
    month,
    transactions: txList.map((t) => ({
      id: t.id,
      amount: t.amount,
      description: t.description,
      imageUrl: t.imageUrl,
      verifiedAt: t.verifiedAt ? new Date(t.verifiedAt).toISOString() : null,
      createdAt: new Date(t.createdAt).toISOString(),
    })),
  });
}

// ─── POST /api/employee/petty-cash ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    amount?: unknown;
    description?: unknown;
    imageUrl?: unknown;
    imageKey?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const amount = Number(body.amount);
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  const imageUrl =
    typeof body.imageUrl === 'string' && body.imageUrl.trim()
      ? body.imageUrl.trim()
      : null;
  const imageKey =
    typeof body.imageKey === 'string' && body.imageKey.trim()
      ? body.imageKey.trim()
      : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0.' },
      { status: 422 },
    );
  }

  if (!description) {
    return NextResponse.json(
      { error: 'Description is required.' },
      { status: 422 },
    );
  }

  if (!imageUrl) {
    return NextResponse.json(
      { error: 'Receipt photo is required.' },
      { status: 422 },
    );
  }

  const storeId = await getEmployeeStore(userId);

  if (!storeId) {
    return NextResponse.json({ error: 'No store assigned.' }, { status: 403 });
  }

  const month = currentYearMonth();

  const period = await ensurePettyCashPeriod(storeId, month);

  if (!period) {
    return NextResponse.json(
      { error: 'Petty cash period could not be created.' },
      { status: 500 },
    );
  }

  if (period.status === 'closed') {
    return NextResponse.json(
      { error: 'This petty cash month is already closed.' },
      { status: 422 },
    );
  }

  const currentBalance = Number(period.currentBalance ?? 0);

  if (amount > currentBalance) {
    return NextResponse.json(
      { error: `Insufficient balance. Current: ${currentBalance}` },
      { status: 422 },
    );
  }

  const amountValue = amount.toFixed(2);

  // Neon HTTP-safe atomic write:
  //
  // 1. Deduct from petty_cash_periods only if balance is still enough.
  // 2. Insert the transaction only if the deduction succeeded.
  // 3. Return the transaction id and new balance.
  //
  // This prevents two concurrent submissions from overspending the balance.
  const rawResult = await db.execute(sql`
    WITH updated_period AS (
      UPDATE petty_cash_periods
      SET
        current_balance = current_balance - ${amountValue}::numeric,
        updated_at = NOW()
      WHERE id = ${period.id}
        AND status = 'open'
        AND current_balance >= ${amountValue}::numeric
      RETURNING
        id,
        current_balance::text AS new_balance
    ),
    inserted_tx AS (
      INSERT INTO petty_cash_transactions (
        period_id,
        user_id,
        store_id,
        amount,
        description,
        image_url,
        image_key,
        year_month
      )
      SELECT
        updated_period.id,
        ${userId},
        ${storeId},
        ${amountValue}::numeric,
        ${description},
        ${imageUrl},
        ${imageKey},
        ${month}
      FROM updated_period
      RETURNING id
    )
    SELECT
      inserted_tx.id::int AS tx_id,
      updated_period.new_balance
    FROM inserted_tx
    CROSS JOIN updated_period
  `);

  const rows = Array.isArray(rawResult)
    ? rawResult
    : 'rows' in rawResult
      ? rawResult.rows
      : [];

  const row = rows[0] as
    | {
        tx_id: number;
        new_balance: string;
      }
    | undefined;

  if (!row) {
    return NextResponse.json(
      { error: 'Insufficient balance. Please refresh and try again.' },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      txId: row.tx_id,
      newBalance: row.new_balance,
      month,
    },
    { status: 201 },
  );
}
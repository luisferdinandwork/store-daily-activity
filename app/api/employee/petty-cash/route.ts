// app/api/employee/petty-cash/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { stores, users } from '@/lib/db/schema/core';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashTransactions,
} from '@/lib/db/schema/petty-cash';

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
    .select({ homeStoreId: users.homeStoreId })
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
    .select({ name: stores.name })
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
      status: pettyCashTransactions.status,
      imageUrl: pettyCashTransactions.imageUrl,
      approvedAt: pettyCashTransactions.approvedAt,
      rejectedAt: pettyCashTransactions.rejectedAt,
      rejectionReason: pettyCashTransactions.rejectionReason,
      verifiedAt: pettyCashTransactions.verifiedAt,
      createdAt: pettyCashTransactions.createdAt,
    })
    .from(pettyCashTransactions)
    .where(
      and(
        eq(pettyCashTransactions.storeId, storeId),
        eq(pettyCashTransactions.yearMonth, month),
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
      status: t.status,
      imageUrl: t.imageUrl,
      approvedAt: t.approvedAt ? new Date(t.approvedAt).toISOString() : null,
      rejectedAt: t.rejectedAt ? new Date(t.rejectedAt).toISOString() : null,
      rejectionReason: t.rejectionReason,
      verifiedAt: t.verifiedAt ? new Date(t.verifiedAt).toISOString() : null,
      createdAt: new Date(t.createdAt).toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    amount?: unknown;
    description?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const amount = Number(body.amount);
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';

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

  const [inserted] = await db
    .insert(pettyCashTransactions)
    .values({
      periodId: period.id,
      userId,
      storeId,
      amount: amount.toFixed(2),
      description,
      status: 'pending_ops',
      imageUrl: null,
      imageKey: null,
      yearMonth: month,
    })
    .returning({
      id: pettyCashTransactions.id,
    });

  return NextResponse.json(
    {
      success: true,
      txId: inserted.id,
      status: 'pending_ops',
      message: 'Petty cash request sent to OPS for approval.',
    },
    { status: 201 },
  );
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    txId?: unknown;
    imageUrl?: unknown;
    imageKey?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const txId = Number(body.txId);
  const imageUrl =
    typeof body.imageUrl === 'string' && body.imageUrl.trim()
      ? body.imageUrl.trim()
      : null;
  const imageKey =
    typeof body.imageKey === 'string' && body.imageKey.trim()
      ? body.imageKey.trim()
      : null;

  if (!Number.isFinite(txId)) {
    return NextResponse.json({ error: 'Invalid txId.' }, { status: 400 });
  }

  if (!imageUrl) {
    return NextResponse.json(
      { error: 'Receipt photo is required.' },
      { status: 422 },
    );
  }

  const result = await db.execute(sql`
    UPDATE petty_cash_transactions
    SET
      image_url = ${imageUrl},
      image_key = ${imageKey},
      updated_at = NOW()
    WHERE id = ${txId}
      AND user_id = ${userId}
      AND status = 'ops_approved'
      AND verified_at IS NULL
    RETURNING id::int
  `);

  const rows = getRows(result);
  const row = rows[0] as { id: number } | undefined;

  if (!row) {
    return NextResponse.json(
      {
        error:
          'Receipt upload failed. Request must be OPS approved and not yet verified.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    txId: row.id,
    imageUrl,
  });
}
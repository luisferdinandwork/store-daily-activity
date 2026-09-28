// app/api/employee/petty-cash/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { stores, users } from '@/lib/db/schema/core';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';
import { isPettyCashHolder } from '@/lib/db/utils/petty-cash-refill';
import { getActivePeriod } from '@/lib/db/utils/petty-cash-period';
import {
  getPettyCashCategory,
  listPettyCashCategories,
} from '@/lib/db/utils/petty-cash-categories';
import { PETTY_CASH_REASON_MAX } from '@/lib/petty-cash-categories';

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

function sessionEmployeeType(session: unknown): string | null | undefined {
  return (session as { user?: { employeeType?: string | null } } | null)?.user?.employeeType;
}

async function getEmployeeStore(userId: string) {
  const [user] = await db
    .select({ homeStoreId: users.homeStoreId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user?.homeStoreId ?? null;
}

// Petty cash balance carries forward across months — a store only gets a
// fresh max-balance period when it's actually refilled (see
// lib/db/utils/petty-cash-period.ts). This just resolves whichever period
// is currently active for the store.
async function ensurePettyCashPeriod(storeId: number, yearMonth: string) {
  return getActivePeriod(storeId, yearMonth);
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

  // period.yearMonth (not the raw calendar `month`) drives which
  // transactions we show: a refill pre-creates NEXT month's period as soon
  // as it's received, and the employee should immediately see that fresh
  // envelope — balance and history both — rather than waiting for the
  // calendar to catch up. See getActivePeriod in petty-cash-period.ts.
  const activeMonth = period.yearMonth;

  const categories = await listPettyCashCategories({ activeOnly: true });

  const txList = await db
    .select({
      id: pettyCashTransactions.id,
      amount: pettyCashTransactions.amount,
      actualAmount: pettyCashTransactions.actualAmount,
      description: pettyCashTransactions.description,
      categoryName: pettyCashTransactions.categoryName,
      status: pettyCashTransactions.status,
      imageUrl: pettyCashTransactions.imageUrl,
      approvedAt: pettyCashTransactions.approvedAt,
      rejectedAt: pettyCashTransactions.rejectedAt,
      rejectionReason: pettyCashTransactions.rejectionReason,
      createdAt: pettyCashTransactions.createdAt,
    })
    .from(pettyCashTransactions)
    .where(
      and(
        eq(pettyCashTransactions.storeId, storeId),
        eq(pettyCashTransactions.yearMonth, activeMonth),
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
    // The period's own month (the money in use) vs today's calendar month —
    // they differ when the balance carries over or a refill started next month.
    month: activeMonth,
    currentMonth: month,
    // Active request categories for the "new request" form, in display order.
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      defaultReason: c.defaultReason,
      requiresCustomReason: c.requiresCustomReason,
    })),
    transactions: txList.map((t) => ({
      id: t.id,
      amount: t.amount,
      actualAmount: t.actualAmount,
      description: t.description,
      categoryName: t.categoryName,
      status: t.status,
      imageUrl: t.imageUrl,
      approvedAt: t.approvedAt ? new Date(t.approvedAt).toISOString() : null,
      rejectedAt: t.rejectedAt ? new Date(t.rejectedAt).toISOString() : null,
      rejectionReason: t.rejectionReason,
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

  if (!isPettyCashHolder(sessionEmployeeType(session))) {
    return NextResponse.json(
      { error: 'Hanya PIC 1 yang bisa mengirim Request Petty Cash.' },
      { status: 403 },
    );
  }

  let body: {
    amount?: unknown;
    categoryId?: unknown;
    description?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const amount = Number(body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0.' },
      { status: 422 },
    );
  }

  // Every request is filed under an active category. Its default reason
  // fills in the Keterangan when the PIC leaves it blank; a custom-reason
  // category (Lain-Lain) has none, so the PIC must write their own.
  const categoryId = Number(body.categoryId);
  const category = Number.isInteger(categoryId) ? await getPettyCashCategory(categoryId) : null;

  if (!category || !category.isActive) {
    return NextResponse.json(
      { error: 'Pilih kategori petty cash.' },
      { status: 422 },
    );
  }

  const typedReason =
    typeof body.description === 'string' ? body.description.trim() : '';
  const description =
    typedReason || (category.requiresCustomReason ? '' : (category.defaultReason ?? ''));

  if (!description) {
    return NextResponse.json(
      { error: `Keterangan wajib diisi untuk kategori ${category.name}.` },
      { status: 422 },
    );
  }

  if (description.length > PETTY_CASH_REASON_MAX) {
    return NextResponse.json(
      { error: `Keterangan maksimal ${PETTY_CASH_REASON_MAX} karakter.` },
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
      categoryId: category.id,
      categoryName: category.name,
      status: 'pending_ops',
      imageUrl: null,
      imageKey: null,
      // Tag with the period's OWN month, not the raw calendar month — once a
      // refill has pre-created next month's period, new spend is already
      // happening against that envelope (see getActivePeriod), so it must be
      // grouped under that month for Finance's per-month ledger to add up.
      yearMonth: period.yearMonth,
      // Explicit app-clock timestamp instead of the column's DEFAULT NOW() —
      // the self-hosted Postgres session's own timezone doesn't necessarily
      // match the Node process (which runs in UTC in prod), so relying on the
      // DB default here produced a wrong-looking request time. Matches the
      // checkInTime convention (lib/schedule-utils.ts) for real timestamps.
      createdAt: new Date(),
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

  // Confirming the actual amount and uploading the receipt are PIC 1's job —
  // any PIC 1 of the request's store (not only whoever submitted it), so a
  // request isn't stranded when the PIC 1 changes. Everyone else only views.
  if (!isPettyCashHolder(sessionEmployeeType(session))) {
    return NextResponse.json(
      { error: 'Hanya PIC 1 yang bisa mengonfirmasi jumlah terpakai dan mengunggah struk.' },
      { status: 403 },
    );
  }

  const storeId = await getEmployeeStore(userId);

  if (!storeId) {
    return NextResponse.json({ error: 'No store assigned.' }, { status: 403 });
  }

  let body: {
    txId?: unknown;
    imageUrl?: unknown;
    imageKey?: unknown;
    actualAmount?: unknown;
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

  // Confirming the actual amount used — PIC 1 only, and only once OPS has
  // approved it. This is what finally cuts the money from the store's ready
  // petty cash, since the originally requested amount was just an estimate.
  if (body.actualAmount !== undefined) {
    const actualAmount = Number(body.actualAmount);

    if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
      return NextResponse.json(
        { error: 'Actual amount used must be greater than 0.' },
        { status: 422 },
      );
    }

    const result = await db.execute(sql`
      WITH target_tx AS (
        SELECT id, period_id
        FROM petty_cash_transactions
        WHERE id = ${txId}
          AND store_id = ${storeId}
          AND status = 'ops_approved'
      ),

      updated_period AS (
        UPDATE petty_cash_periods
        SET
          current_balance = current_balance - ${actualAmount.toFixed(2)}::numeric,
          updated_at = NOW()
        WHERE id = (SELECT period_id FROM target_tx)
          AND status = 'open'
          AND current_balance >= ${actualAmount.toFixed(2)}::numeric
        RETURNING id, current_balance::text AS new_balance
      ),

      completed_tx AS (
        UPDATE petty_cash_transactions
        SET
          actual_amount = ${actualAmount.toFixed(2)}::numeric,
          actual_amount_by = ${userId},
          actual_amount_at = NOW(),
          status = 'completed',
          image_url = COALESCE(${imageUrl}, image_url),
          image_key = COALESCE(${imageKey}, image_key),
          updated_at = NOW()
        FROM updated_period
        WHERE petty_cash_transactions.id = (SELECT id FROM target_tx)
        RETURNING petty_cash_transactions.id::int AS tx_id, petty_cash_transactions.status
      )

      SELECT tx_id, status, new_balance FROM completed_tx CROSS JOIN updated_period
    `);

    const rows = getRows(result);
    const row = rows[0] as { tx_id: number; status: string; new_balance: string } | undefined;

    if (!row) {
      return NextResponse.json(
        {
          error:
            'Could not confirm the actual amount. The request must be OPS approved, not yet confirmed, and the balance must cover this amount.',
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
      AND store_id = ${storeId}
      AND status IN ('ops_approved', 'completed')
    RETURNING id::int
  `);

  const rows = getRows(result);
  const row = rows[0] as { id: number } | undefined;

  if (!row) {
    return NextResponse.json(
      {
        error: 'Receipt upload failed. Request must be OPS approved.',
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
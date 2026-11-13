// app/api/employee/petty-cash/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { stores, users } from '@/lib/db/schema/core';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashTransactions,
} from '@/lib/db/schema/petty-cash';
import {
  getRefillOutstanding,
  getRefillReceivedWithin,
  getSpendable,
  isPettyCashHolder,
} from '@/lib/db/utils/petty-cash-refill';
import { getActivePeriod, rollRequestToActivePeriod } from '@/lib/db/utils/petty-cash-period';
import {
  getPettyCashCategory,
  listPettyCashCategories,
} from '@/lib/db/utils/petty-cash-categories';
import { PETTY_CASH_REASON_MAX, pettyCashDescription } from '@/lib/petty-cash-categories';
import { assertStoreOperational } from '@/lib/db/utils/store-status';
import { reviewOutcome } from '@/lib/petty-cash-review';
import { jakartaDateKey } from '@/lib/day-bucket';
import { addMonths, periodLabel, receiptPhotoAction } from '@/lib/petty-cash-period';
import { refillStateOf } from '@/lib/petty-cash-report';

/** How many of the store's requests the page lists (newest first) — it searches / filters them client-side. */
const MAX_LISTED_REQUESTS = 500;

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

// Petty cash only runs for active stores: a ready_to_open store carries Rp 0 and
// a closed one is frozen for Audit. Checked before getActivePeriod, which would
// otherwise bootstrap a full-balance period on first read.
async function storeInactiveResponse(storeId: number) {
  const message = await assertStoreOperational(storeId);
  return message ? NextResponse.json({ error: message }, { status: 403 }) : null;
}

async function getEmployeeStore(userId: string) {
  const [user] = await db
    .select({ homeStoreId: users.homeStoreId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user?.homeStoreId ?? null;
}

// The CALENDAR decides the period in use: it runs 16th → 15th and changes on the 16th, whether or not a refill was
// sent (see lib/db/utils/petty-cash-period.ts). This resolves it, moving the store forward if its last one ended.
async function ensurePettyCashPeriod(storeId: number) {
  return getActivePeriod(storeId);
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

  const inactive = await storeInactiveResponse(storeId);
  if (inactive) return inactive;

  const month = currentYearMonth();

  const [store] = await db
    .select({ name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) {
    return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  }

  const period = await ensurePettyCashPeriod(storeId);

  if (!period) {
    return NextResponse.json(
      { error: 'Petty cash period could not be created.' },
      { status: 500 },
    );
  }

  // period.yearMonth (not the raw calendar `month`) is the period in use: a period runs 16th → 15th and is named
  // after the month it ends in, so on the 20th of November the period in use is December.
  const activeMonth = period.yearMonth;

  // A period starts at the full Rp 1.000.000 on paper, but the cash box holds that only once the Refill of the
  // period before it has been received — so the balance shown (and spendable) leaves it out until then, and adds
  // the period's own Refill once it has arrived.
  const { spendable, owed: refillOwed } = await getSpendable(storeId, period);

  const categories = await listPettyCashCategories({ activeOnly: true });

  // Every request of the store, any month, newest first: the page searches / filters / sorts them as one
  // list (each request appears once) and works out the current period's counters from `month` itself.
  const txList = await db
    .select({
      id: pettyCashTransactions.id,
      amount: pettyCashTransactions.amount,
      actualAmount: pettyCashTransactions.actualAmount,
      description: pettyCashTransactions.description,
      categoryId: pettyCashTransactions.categoryId,
      categoryName: pettyCashTransactions.categoryName,
      status: pettyCashTransactions.status,
      imageUrl: pettyCashTransactions.imageUrl,
      approvedAt: pettyCashTransactions.approvedAt,
      rejectedAt: pettyCashTransactions.rejectedAt,
      rejectionReason: pettyCashTransactions.rejectionReason,
      createdAt: pettyCashTransactions.createdAt,
      yearMonth: pettyCashTransactions.yearMonth,
      financeReview: pettyCashTransactions.financeReview,
      financeComment: pettyCashTransactions.financeComment,
      isReRequest: pettyCashTransactions.isReRequest,
      requestDate: pettyCashTransactions.requestDate,
      reRequestOfId: pettyCashTransactions.reRequestOfId,
    })
    .from(pettyCashTransactions)
    .where(eq(pettyCashTransactions.storeId, storeId))
    .orderBy(desc(pettyCashTransactions.createdAt), desc(pettyCashTransactions.id))
    .limit(MAX_LISTED_REQUESTS);

  // Which of these Perlu Perbaikan requests were already filed again (original id → the re-request's id).
  const reRequestedAs = new Map<number, number>();
  if (txList.length > 0) {
    const filedAgain = await db
      .select({ id: pettyCashTransactions.id, of: pettyCashTransactions.reRequestOfId })
      .from(pettyCashTransactions)
      .where(inArray(pettyCashTransactions.reRequestOfId, txList.map((t) => t.id)));
    for (const r of filedAgain) if (r.of != null) reRequestedAs.set(r.of, r.id);
  }

  // The period before the one in use has ended (its 15th is over) and its Refill has not arrived: not asked for
  // yet, on its way, or turned down. The page says so — new requests are already counted in the period in use,
  // and nothing is blocked.
  const previousMonth = addMonths(period.yearMonth, -1);
  let closedPeriod: { month: string; refillState: string } | null = null;
  if (refillOwed > 0) {
    const [previousRefill] = await db
      .select()
      .from(pettyCashRefillRequests)
      .where(and(eq(pettyCashRefillRequests.storeId, storeId), eq(pettyCashRefillRequests.yearMonth, previousMonth)))
      .orderBy(desc(pettyCashRefillRequests.requestedAt), desc(pettyCashRefillRequests.id))
      .limit(1);
    closedPeriod = { month: previousMonth, refillState: previousRefill ? refillStateOf(previousRefill) : 'none' };
  }

  // A request Finance sent back (Perlu Perbaikan) is a `draft` PIC 1 fixes and sends to OPS again — the SAME request.
  // Finance already put it in the period it is counted in (its own, or the next one), so the fix form checks what
  // was spent against what THAT period has left — a period that doesn't exist yet starts at the maximum.
  const isFixable = (t: (typeof txList)[number]) => t.status === 'draft';
  // A draft left in a period that has ended moves on to the period in use when it is sent (rollRequestToActivePeriod).
  const fixMonth = (t: (typeof txList)[number]) => (t.yearMonth >= period.yearMonth ? t.yearMonth : period.yearMonth);
  const targetMonths = [...new Set(txList.filter(isFixable).map(fixMonth))];
  // Spendable = the period's balance minus the refill of the period before it that has not arrived yet.
  const targetBalance = new Map<string, number>([[period.yearMonth, spendable]]);
  const missingMonths = targetMonths.filter((m) => !targetBalance.has(m));
  if (missingMonths.length > 0) {
    const rows = await db
      .select({ yearMonth: pettyCashPeriods.yearMonth, balance: pettyCashPeriods.currentBalance })
      .from(pettyCashPeriods)
      .where(and(eq(pettyCashPeriods.storeId, storeId), inArray(pettyCashPeriods.yearMonth, missingMonths)));
    for (const r of rows) {
      const target = await getSpendable(storeId, { yearMonth: r.yearMonth, currentBalance: r.balance });
      targetBalance.set(r.yearMonth, target.spendable);
    }
  }

  return NextResponse.json({
    success: true,
    storeName: store.name,
    closedPeriod,
    balance: String(spendable),
    // The refill of the previous period that has not been received yet (even if nobody asked for it yet): the
    // balance rises by this on receipt. `requested` = it has been asked for.
    refillPending:
      refillOwed > 0
        ? { month: previousMonth, amount: refillOwed, requested: closedPeriod?.refillState !== 'none' }
        : null,
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
      definition: c.definition,
      examples: c.examples,
    })),
    transactions: txList.map((t) => ({
      id: t.id,
      amount: t.amount,
      actualAmount: t.actualAmount,
      description: pettyCashDescription(t.description),
      categoryId: t.categoryId,
      categoryName: t.categoryName,
      status: t.status,
      imageUrl: t.imageUrl,
      // What PIC 1 may do about the receipt photo: replace it (OPS-approved, not finished yet), add the first one,
      // or nothing — a finished request's photo is locked, a Re-request is the way to change it.
      receiptAction: receiptPhotoAction({ status: t.status, hasPhoto: Boolean(t.imageUrl), financeReview: t.financeReview }),
      approvedAt: t.approvedAt ? new Date(t.approvedAt).toISOString() : null,
      rejectedAt: t.rejectedAt ? new Date(t.rejectedAt).toISOString() : null,
      rejectionReason: t.rejectionReason,
      createdAt: new Date(t.createdAt).toISOString(),
      // The petty cash period it was filed in (YYYY-MM) — not always the month it was filed in.
      month: t.yearMonth,
      // Finance's decision on it (Perlu Perbaikan / Ditolak / Diterima) and its comment.
      reviewOutcome: reviewOutcome(t.financeReview),
      financeComment: t.financeComment,
      // A re-request (a Perlu Perbaikan request filed again): the day PIC 1 gave as the day it was made,
      // the request it files again, and — on the original — the re-request that did it.
      isReRequest: t.isReRequest,
      requestDate: t.requestDate ? jakartaDateKey(t.requestDate) : null,
      reRequestOfId: t.reRequestOfId,
      reRequestedAs: reRequestedAs.get(t.id) ?? null,
      // Sent back by Finance (Perlu Perbaikan) and waiting for PIC 1 to fix it and send it to OPS again.
      canFix: isFixable(t),
      // The period it is counted in and what that period has left.
      fixTarget: isFixable(t)
        ? { month: fixMonth(t), balance: targetBalance.get(fixMonth(t)) ?? PETTY_CASH_MAX_BALANCE }
        : null,
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

  // Every request is filed under an active category. A category has no preset
  // Keterangan — the PIC always writes their own.
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
  const description = pettyCashDescription(typedReason);

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

  const inactive = await storeInactiveResponse(storeId);
  if (inactive) return inactive;

  // A refill never blocks a request: this one is simply filed under the period the calendar says is in use now
  // (up to the 15th this month's, from the 16th the next one's) — see getActivePeriod.
  const period = await ensurePettyCashPeriod(storeId);

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
      // Tag with the period's OWN month, not the raw calendar month — from the 16th new spend belongs to the
      // next month's period (see getActivePeriod), so it must be grouped under that month for
      // Finance's per-month ledger to add up.
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
      // The period it is counted in — the page tells PIC 1 when that is not the calendar month.
      periodMonth: period.yearMonth,
      periodLabel: periodLabel(period.yearMonth),
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

  const inactive = await storeInactiveResponse(storeId);
  if (inactive) return inactive;

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

    // A request still waiting when its period ended belongs to the period in use (it normally moved on the 16th,
    // when the calendar moved the store; this catches stragglers) — that is the balance the actual amount is cut from.
    await rollRequestToActivePeriod(txId, storeId);

    // What is spendable is the period's balance minus a refill still on its way (getRefillOutstanding), plus its
    // own refill once received (getRefillReceivedWithin) — `net` is what to add to the balance in the check below.
    const [owner] = await db
      .select({ yearMonth: pettyCashTransactions.yearMonth })
      .from(pettyCashTransactions)
      .where(and(eq(pettyCashTransactions.id, txId), eq(pettyCashTransactions.storeId, storeId)))
      .limit(1);
    const owed = owner ? await getRefillOutstanding(storeId, owner.yearMonth) : 0;
    const received = owner ? await getRefillReceivedWithin(storeId, owner.yearMonth) : 0;
    const net = received - owed;

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
          AND current_balance + ${net.toFixed(2)}::numeric >= ${actualAmount.toFixed(2)}::numeric
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
            owed > 0
              ? 'Saldo belum cukup untuk jumlah ini — Refill yang sedang diproses belum dihitung sampai foto buktinya diunggah.'
              : 'Could not confirm the actual amount. The request must be OPS approved, not yet confirmed, and the balance must cover this amount.',
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

  // The receipt photo can be swapped only until the request is finished (receiptPhotoAction): while it is
  // OPS-approved, or — as a first upload, not a replacement — on a finished request that has no photo yet and
  // that Finance has not turned down. A finished request's photo is locked; a Re-request is how it is changed.
  const result = await db.execute(sql`
    UPDATE petty_cash_transactions
    SET
      image_url = ${imageUrl},
      image_key = ${imageKey},
      updated_at = NOW()
    WHERE id = ${txId}
      AND store_id = ${storeId}
      AND (
        status = 'ops_approved'
        OR (
          status = 'completed'
          AND image_url IS NULL
          AND (finance_review IS NULL OR finance_review = 'accepted')
        )
      )
    RETURNING id::int
  `);

  const rows = getRows(result);
  const row = rows[0] as { id: number } | undefined;

  if (!row) {
    const [current] = await db
      .select({
        status: pettyCashTransactions.status,
        imageUrl: pettyCashTransactions.imageUrl,
        financeReview: pettyCashTransactions.financeReview,
      })
      .from(pettyCashTransactions)
      .where(and(eq(pettyCashTransactions.id, txId), eq(pettyCashTransactions.storeId, storeId)))
      .limit(1);

    const error = !current
      ? 'Request tidak ditemukan.'
      : current.status === 'completed' && current.imageUrl
        ? 'Foto struk tidak bisa diganti setelah request selesai. Kalau perlu foto lain, ajukan ulang lewat Re-request.'
        : current.status === 'completed'
          ? 'Request ini sudah diputuskan Finance, jadi tidak ada foto yang perlu diunggah.'
          : 'Foto struk baru bisa diunggah setelah request disetujui OPS.';

    return NextResponse.json({ success: false, error }, { status: 409 });
  }

  return NextResponse.json({
    success: true,
    txId: row.id,
    imageUrl,
  });
}
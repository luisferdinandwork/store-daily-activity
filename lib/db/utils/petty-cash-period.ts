// lib/db/utils/petty-cash-period.ts
//
// Period helpers for the petty cash feature (the rules and wording: lib/petty-cash-period.ts).
//
// A store spends from ONE open period at a time. It is not recreated every calendar month — money doesn't vanish
// or reset because the month changed; a period stays open, carrying whatever balance is left, until PIC 1 sends
// the refill for it. Sending the refill CLOSES the period (what was used is fixed — that is what Finance
// transfers) and opens the next one straight away (petty-cash-refill.ts → closePeriodAndOpenNext), so requests
// keep flowing while the refill is still with OPS / Finance / waiting for PIC 1's receipt photos.
//
//   status 'open'      takes new requests (at most one per store in practice — the latest)
//   status 'upcoming'  created ahead of time because a Re-request of the period in use has to be counted in the
//                      NEXT period (lib/petty-cash-re-request.ts); it opens when the current one closes
//   status 'closed'    refill sent — no new request lands in it. Its balance still moves while Finance reviews
//                      the requests, until Finance verifies the refill (adjustPeriodBalance), and then it is frozen
//
// Finance's month-by-month dashboard is a per-month ledger, not a live balance view, so it deliberately does NOT
// use getActivePeriod — it queries pettyCashPeriods for an exact yearMonth match only
// (see app/api/finance/petty-cash/route.ts). Because requests are tagged with their period's month, a request
// filed in November while the refill was on its way shows up under December there.

import { db } from '@/lib/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashTransactions,
  type PettyCashPeriod,
} from '@/lib/db/schema/petty-cash';
import { addMonths } from '@/lib/petty-cash-period';

export { addMonths };

/** Either the pool or a transaction handle — every writer below takes one so it can join a transaction. */
export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

/** Requests still waiting when their period closes move on with the refill: they have not cost anything yet. */
const MOVES_ON_CLOSE = ['pending_ops', 'ops_approved'];

const MAX = String(PETTY_CASH_MAX_BALANCE);

export async function getPeriod(
  storeId: number,
  yearMonth: string,
  exec: DbExecutor = db,
): Promise<PettyCashPeriod | null> {
  const [row] = await exec
    .select()
    .from(pettyCashPeriods)
    .where(and(eq(pettyCashPeriods.storeId, storeId), eq(pettyCashPeriods.yearMonth, yearMonth)))
    .limit(1);
  return row ?? null;
}

/**
 * The period a store spends from right now — where a new request lands: its latest OPEN period (which may be
 * ahead of today's calendar month once a refill has been sent). `yearMonth` is only the starting month for a
 * store with no petty cash history at all.
 */
export async function getActivePeriod(storeId: number, yearMonth: string): Promise<PettyCashPeriod> {
  const [open] = await db
    .select()
    .from(pettyCashPeriods)
    .where(and(eq(pettyCashPeriods.storeId, storeId), eq(pettyCashPeriods.status, 'open')))
    .orderBy(desc(pettyCashPeriods.yearMonth))
    .limit(1);
  if (open) return open;

  // Nothing is open (every period was closed by hand, or only an 'upcoming' one is left): open the month after.
  const [latest] = await db
    .select()
    .from(pettyCashPeriods)
    .where(eq(pettyCashPeriods.storeId, storeId))
    .orderBy(desc(pettyCashPeriods.yearMonth))
    .limit(1);

  if (!latest) return bootstrapPeriod(storeId, yearMonth);
  return openPeriod(storeId, latest.status === 'upcoming' ? latest.yearMonth : addMonths(latest.yearMonth, 1));
}

/** Create-if-missing at max balance — never clobbers an existing row's balance. */
async function bootstrapPeriod(storeId: number, yearMonth: string): Promise<PettyCashPeriod> {
  const now = new Date();
  await db
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: MAX,
      currentBalance: MAX,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth] });

  const period = await getPeriod(storeId, yearMonth);
  if (!period) throw new Error('Failed to create petty cash period.');
  return period;
}

/**
 * Make `yearMonth` the period in use: create it at max balance if it is missing, and turn an 'upcoming' one into
 * 'open'. An existing period keeps its balance (a Re-request may already be counted in it).
 */
export async function openPeriod(storeId: number, yearMonth: string, exec: DbExecutor = db): Promise<PettyCashPeriod> {
  const now = new Date();
  await exec
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: MAX,
      currentBalance: MAX,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth] });

  await exec
    .update(pettyCashPeriods)
    .set({ status: 'open', updatedAt: now })
    .where(
      and(
        eq(pettyCashPeriods.storeId, storeId),
        eq(pettyCashPeriods.yearMonth, yearMonth),
        eq(pettyCashPeriods.status, 'upcoming'),
      ),
    );

  const period = await getPeriod(storeId, yearMonth, exec);
  if (!period) throw new Error('Failed to open petty cash period.');
  return period;
}

/**
 * A period created ahead of its time, for a Re-request that has to be counted in it. Created at max balance;
 * an existing period (open or already upcoming) is returned as it is.
 */
export async function ensureUpcomingPeriod(
  storeId: number,
  yearMonth: string,
  exec: DbExecutor = db,
): Promise<PettyCashPeriod> {
  const now = new Date();
  await exec
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: MAX,
      currentBalance: MAX,
      status: 'upcoming',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth] });

  const period = await getPeriod(storeId, yearMonth, exec);
  if (!period) throw new Error('Failed to create petty cash period.');
  return period;
}

export interface ClosedPeriod {
  /** The period that was closed (null when the store has no row for that month — legacy data). */
  closed: PettyCashPeriod | null;
  /** The period now in use. */
  next: PettyCashPeriod;
  /** Requests that were still waiting and moved to `next`. */
  moved: number;
}

/**
 * The refill of `yearMonth` was sent: close that period, open the one after it and move the requests that were
 * still waiting (pending OPS / OPS-approved, not confirmed yet) over to it. Safe to call again — a period that is
 * already closed stays as it is and nothing is created twice — which is how the receipt step makes sure of it for
 * refills sent before periods closed at that moment.
 */
export async function closePeriodAndOpenNext(
  storeId: number,
  yearMonth: string,
  closedBy: string,
  exec: DbExecutor = db,
): Promise<ClosedPeriod> {
  const now = new Date();

  await exec
    .update(pettyCashPeriods)
    .set({ status: 'closed', closedBy, closedAt: now, updatedAt: now })
    .where(
      and(
        eq(pettyCashPeriods.storeId, storeId),
        eq(pettyCashPeriods.yearMonth, yearMonth),
        ne(pettyCashPeriods.status, 'closed'),
      ),
    );

  const closed = await getPeriod(storeId, yearMonth, exec);
  const next = await openPeriod(storeId, addMonths(yearMonth, 1), exec);

  let moved = 0;
  if (closed) {
    const rows = await exec
      .update(pettyCashTransactions)
      .set({ periodId: next.id, yearMonth: next.yearMonth, updatedAt: now })
      .where(and(eq(pettyCashTransactions.periodId, closed.id), inArray(pettyCashTransactions.status, MOVES_ON_CLOSE)))
      .returning({ id: pettyCashTransactions.id });
    moved = rows.length;
  }

  return { closed, next, moved };
}

/**
 * A request that was still waiting when its period closed belongs to the period in use — normally it was moved
 * at that moment already; this catches the stragglers (a request left behind by older data, or a race). Called
 * right before PIC 1 confirms what was spent, since that is what cuts the money from the period.
 */
export async function rollRequestToActivePeriod(txId: number, storeId: number, yearMonth: string): Promise<void> {
  const [row] = await db
    .select({ status: pettyCashTransactions.status, periodStatus: pettyCashPeriods.status })
    .from(pettyCashTransactions)
    .leftJoin(pettyCashPeriods, eq(pettyCashPeriods.id, pettyCashTransactions.periodId))
    .where(and(eq(pettyCashTransactions.id, txId), eq(pettyCashTransactions.storeId, storeId)))
    .limit(1);

  if (!row || !MOVES_ON_CLOSE.includes(row.status)) return;
  if (row.periodStatus === 'open') return;

  const active = await getActivePeriod(storeId, yearMonth);
  await db
    .update(pettyCashTransactions)
    .set({ periodId: active.id, yearMonth: active.yearMonth, updatedAt: new Date() })
    .where(and(eq(pettyCashTransactions.id, txId), inArray(pettyCashTransactions.status, MOVES_ON_CLOSE)));
}

/**
 * Moves the money a period has left (+ gives back, − takes off), kept between 0 and the maximum. A period whose
 * refill Finance has VERIFIED is settled — the cash is already sent, the books are frozen — and is left alone;
 * every other period (open, upcoming, or closed and waiting for Finance) moves, which is how a request Finance
 * turns down gives its amount back to a refill that has not been verified yet.
 */
export async function adjustPeriodBalance(exec: DbExecutor, periodId: number | null, delta: number): Promise<boolean> {
  if (periodId == null || delta === 0) return false;

  const settled = sql`(${pettyCashPeriods.status} = 'closed' AND EXISTS (
    SELECT 1 FROM ${pettyCashRefillRequests}
    WHERE ${pettyCashRefillRequests.storeId} = ${pettyCashPeriods.storeId}
      AND ${pettyCashRefillRequests.yearMonth} = ${pettyCashPeriods.yearMonth}
      AND ${pettyCashRefillRequests.status} = 'approved'
      AND ${pettyCashRefillRequests.financeVerifiedAt} IS NOT NULL
  ))`;

  const rows = await exec
    .update(pettyCashPeriods)
    .set({
      currentBalance: sql`GREATEST(0, LEAST(${MAX}::numeric, ${pettyCashPeriods.currentBalance} + ${delta.toFixed(2)}::numeric))`,
      updatedAt: new Date(),
    })
    .where(and(eq(pettyCashPeriods.id, periodId), sql`NOT ${settled}`))
    .returning({ id: pettyCashPeriods.id });

  return rows.length > 0;
}

/**
 * Force this exact month's period to the max balance — creating it if missing. Only for provisioning a store that
 * is being activated (changeStoreStatus); a refill never resets a period (the next period may already carry
 * requests). Closed periods are left untouched (frozen books stay frozen).
 */
export async function topUpPeriodToMax(storeId: number, yearMonth: string): Promise<PettyCashPeriod> {
  const existing = await getPeriod(storeId, yearMonth);

  if (existing && existing.status === 'closed') {
    return existing;
  }

  const [period] = await db
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: MAX,
      currentBalance: MAX,
      status: 'open',
    })
    .onConflictDoUpdate({
      target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth],
      set: {
        currentBalance: MAX,
        updatedAt: new Date(),
      },
    })
    .returning();

  return period;
}

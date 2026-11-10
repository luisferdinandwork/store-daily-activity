// lib/db/utils/petty-cash-period.ts
//
// Period helpers for the petty cash feature (the rules and wording: lib/petty-cash-period.ts).
//
// THE CALENDAR decides which period a store spends from — the Refill does not. A period runs from the 16th of the
// month before its name to the 15th of its name (Jakarta); from the 16th everything is counted in the next one.
// Nothing runs at midnight: the first call that needs the period in use after the 15th moves the store forward
// (`getActivePeriod` → rollForward) — it closes the period that ended, opens the new one and takes along the
// requests that were still waiting. Every reader goes through `getActivePeriod`, so the stored `status` is never
// stale for anyone who matters (Finance's per-month ledger reads the rows as they are).
//
//   status 'open'      takes new requests (one per store — the period the calendar says, or a later one an
//                      earlier version of the flow opened, which is never taken back)
//   status 'upcoming'  created ahead of time because a Re-request of the period in use has to be counted in the
//                      NEXT period (lib/petty-cash-re-request.ts); it opens when the calendar reaches it
//   status 'closed'    its last day has passed (or Finance closed it at month end) — no new request lands in it.
//                      Its balance still moves while Finance reviews the requests, until Finance verifies the
//                      refill (adjustPeriodBalance), and then it is frozen
//
// Sending a Refill never touches a period (petty-cash-refill.ts): it only records which period it settles.
//
// Finance's month-by-month dashboard is a per-month ledger, not a live balance view, so it deliberately does NOT
// use getActivePeriod — it queries pettyCashPeriods for an exact yearMonth match only
// (see app/api/finance/petty-cash/route.ts). Because requests are tagged with their period's month, a request
// filed on the 20th of November shows up under December there.

import { db } from '@/lib/db';
import { and, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashTransactions,
  type PettyCashPeriod,
} from '@/lib/db/schema/petty-cash';
import { jakartaTodayKey } from '@/lib/day-bucket';
import {
  REFILL_DEADLINE_FIRST_PERIOD,
  addMonths,
  laterMonth,
  uncoveredUsage,
  usagePeriodFor,
} from '@/lib/petty-cash-period';

export { addMonths };

/** Either the pool or a transaction handle — every writer below takes one so it can join a transaction. */
export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

/** Requests still waiting when their period ends move on with the store: they have not cost anything yet. */
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
 * The month of the period a store spends from on Jakarta day `today`: the one the calendar says
 * (`usagePeriodFor`) — or a later OPEN one, because the period in use never goes backwards (an earlier version of
 * the flow opened the next period as soon as a Refill was sent, and requests may already sit in it). A month that
 * is already closed is skipped.
 */
function usageMonthOf(periods: PettyCashPeriod[], today: string): string {
  const openAhead = periods
    .filter((p) => p.status === 'open')
    .map((p) => p.yearMonth)
    .sort()
    .pop();
  let month = laterMonth(usagePeriodFor(today), openAhead ?? '');

  const closed = new Set(periods.filter((p) => p.status === 'closed').map((p) => p.yearMonth));
  while (closed.has(month)) month = addMonths(month, 1);
  return month;
}

/**
 * The period a store spends from right now — where a new request lands. It is the period of the calendar day
 * `today` (default: today in Jakarta): up to the 15th this month's, from the 16th the next month's. When that
 * period is not the one the store is on yet, the store is moved forward first (see rollForward). A store with no
 * petty cash history gets its first period here.
 *
 * `today` is a Jakarta day (YYYY-MM-DD); only tests pass it.
 */
export async function getActivePeriod(
  storeId: number,
  today: string = jakartaTodayKey(),
  exec: DbExecutor = db,
): Promise<PettyCashPeriod> {
  const periods = await exec.select().from(pettyCashPeriods).where(eq(pettyCashPeriods.storeId, storeId));

  const usageMonth = usageMonthOf(periods, today);
  const current = periods.find((p) => p.yearMonth === usageMonth);
  const hasEnded = periods.some((p) => p.status !== 'closed' && p.yearMonth < usageMonth);
  if (current?.status === 'open' && !hasEnded) return current;

  return rollForward(exec, storeId, usageMonth);
}

/**
 * What a period that ended carries into the next one: usage booked AFTER Finance froze the amount of its Refill
 * (the Refill did not cover it). Periods before the date-driven flow, and periods whose Refill is still live (it
 * will cover everything), carry nothing.
 */
async function carriedOver(
  exec: DbExecutor,
  storeId: number,
  period: { yearMonth: string; currentBalance: string },
): Promise<number> {
  if (period.yearMonth < REFILL_DEADLINE_FIRST_PERIOD) return 0;

  const [request] = await exec
    .select({ transferAmount: pettyCashRefillRequests.transferAmount })
    .from(pettyCashRefillRequests)
    .where(
      and(
        eq(pettyCashRefillRequests.storeId, storeId),
        eq(pettyCashRefillRequests.yearMonth, period.yearMonth),
        eq(pettyCashRefillRequests.status, 'approved'),
        isNotNull(pettyCashRefillRequests.transferAmount),
      ),
    )
    .orderBy(desc(pettyCashRefillRequests.requestedAt), desc(pettyCashRefillRequests.id))
    .limit(1);

  return uncoveredUsage(Number(period.currentBalance), request ? Number(request.transferAmount) : null);
}

/**
 * Move a store to `usageMonth`: close every period that has ended (anything not closed before that month), open
 * `usageMonth` (created at the maximum — less whatever the ended periods carry — or turned from 'upcoming' into
 * 'open'), and move the requests that were still waiting in the ended periods over to it.
 *
 * Safe to run twice and from two places at once: closing is one UPDATE that only the first caller gets rows back
 * from, so the carry and the moved requests are applied exactly once.
 */
async function rollForward(exec: DbExecutor, storeId: number, usageMonth: string): Promise<PettyCashPeriod> {
  const run = async (x: DbExecutor): Promise<PettyCashPeriod> => {
    const now = new Date();

    const ended = await x
      .update(pettyCashPeriods)
      .set({ status: 'closed', closedAt: now, updatedAt: now })
      .where(
        and(
          eq(pettyCashPeriods.storeId, storeId),
          ne(pettyCashPeriods.status, 'closed'),
          lt(pettyCashPeriods.yearMonth, usageMonth),
        ),
      )
      .returning({
        id: pettyCashPeriods.id,
        yearMonth: pettyCashPeriods.yearMonth,
        currentBalance: pettyCashPeriods.currentBalance,
      });

    let carry = 0;
    for (const p of ended) carry += await carriedOver(x, storeId, p);

    const created = await x
      .insert(pettyCashPeriods)
      .values({
        storeId,
        yearMonth: usageMonth,
        openingBalance: MAX,
        currentBalance: String(Math.max(0, PETTY_CASH_MAX_BALANCE - carry)),
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth] })
      .returning({ id: pettyCashPeriods.id });

    if (created.length === 0) {
      // It was there already — made ahead of time for a Re-request, or by a call a moment ago.
      await x
        .update(pettyCashPeriods)
        .set({ status: 'open', updatedAt: now })
        .where(
          and(
            eq(pettyCashPeriods.storeId, storeId),
            eq(pettyCashPeriods.yearMonth, usageMonth),
            eq(pettyCashPeriods.status, 'upcoming'),
          ),
        );
      if (carry > 0) {
        await x
          .update(pettyCashPeriods)
          .set({
            currentBalance: sql`GREATEST(0, ${pettyCashPeriods.currentBalance} - ${carry.toFixed(2)}::numeric)`,
            updatedAt: now,
          })
          .where(and(eq(pettyCashPeriods.storeId, storeId), eq(pettyCashPeriods.yearMonth, usageMonth)));
      }
    }

    const period = await getPeriod(storeId, usageMonth, x);
    if (!period) throw new Error('Failed to open petty cash period.');

    if (ended.length > 0) {
      await x
        .update(pettyCashTransactions)
        .set({ periodId: period.id, yearMonth: period.yearMonth, updatedAt: now })
        .where(
          and(
            inArray(pettyCashTransactions.periodId, ended.map((p) => p.id)),
            inArray(pettyCashTransactions.status, MOVES_ON_CLOSE),
          ),
        );
    }

    return period;
  };

  // Called with the pool: make the whole move one transaction. Called inside one: join it.
  return exec === db ? db.transaction((trx) => run(trx)) : run(exec);
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

/**
 * A request that was still waiting when its period ended belongs to the period in use — normally it was moved at
 * that moment already; this catches the stragglers (a request left behind by older data, or a race). Called right
 * before PIC 1 confirms what was spent, since that is what cuts the money from the period.
 */
export async function rollRequestToActivePeriod(
  txId: number,
  storeId: number,
  today: string = jakartaTodayKey(),
): Promise<void> {
  const [row] = await db
    .select({ status: pettyCashTransactions.status })
    .from(pettyCashTransactions)
    .where(and(eq(pettyCashTransactions.id, txId), eq(pettyCashTransactions.storeId, storeId)))
    .limit(1);

  if (!row || !MOVES_ON_CLOSE.includes(row.status)) return;

  // getActivePeriod also moves a store whose period has just ended — and the requests waiting in it.
  const active = await getActivePeriod(storeId, today);

  await db
    .update(pettyCashTransactions)
    .set({ periodId: active.id, yearMonth: active.yearMonth, updatedAt: new Date() })
    .where(
      and(
        eq(pettyCashTransactions.id, txId),
        eq(pettyCashTransactions.storeId, storeId),
        inArray(pettyCashTransactions.status, MOVES_ON_CLOSE),
      ),
    );
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

// lib/db/utils/petty-cash-period.ts
//
// Shared period-resolution helpers for the petty cash feature.
//
// A period row is NOT recreated every calendar month by default — money
// doesn't vanish or reset just because the month changed. A store's balance
// only tops back up to PETTY_CASH_MAX_BALANCE when it's actually refilled
// (see petty-cash-refill.ts, which pre-creates NEXT month's row once proof
// photos are submitted — the current month's own balance is left untouched,
// still carrying whatever's been spent).
//
// getActivePeriod always resolves to the store's single MOST RECENT period
// row, even if its yearMonth is ahead of today's actual calendar month. That
// pre-created next-month row is exactly what the store should be spending
// against as soon as the refill lands — the calendar hasn't rolled over yet,
// but the physical cash has already arrived, so the employee/OPS side (the
// "live balance" side of the feature) switches to it immediately rather than
// waiting for the month to change.
//
// Finance's month-by-month dashboard is different: it's a per-month
// provisioning ledger, not a live balance view, so it deliberately does NOT
// use getActivePeriod — it queries pettyCashPeriods for an exact yearMonth
// match only (see app/api/finance/petty-cash/route.ts). A store only shows
// up in a given month there if it actually has a period row for that exact
// month (i.e. it was refilled), and a past month's row is never touched
// again once a later one exists, so its balance stays exactly as it was.

import { db } from '@/lib/db';
import { and, desc, eq } from 'drizzle-orm';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  type PettyCashPeriod,
} from '@/lib/db/schema/petty-cash';

export function addMonths(yearMonth: string, amount: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The period a store should actively use right now: its single most recent
 * period row (by yearMonth) — which may already be ahead of `yearMonth`
 * (e.g. a refill pre-created next month's row) — falling back to a
 * brand-new bootstrap period at max balance for a store with no petty cash
 * history at all. `yearMonth` is only used as the bootstrap's starting
 * month in that no-history case.
 */
export async function getActivePeriod(storeId: number, yearMonth: string): Promise<PettyCashPeriod> {
  const [latest] = await db
    .select()
    .from(pettyCashPeriods)
    .where(eq(pettyCashPeriods.storeId, storeId))
    .orderBy(desc(pettyCashPeriods.yearMonth))
    .limit(1);

  if (latest) return latest;

  return bootstrapPeriod(storeId, yearMonth);
}

/** Create-if-missing at max balance — never clobbers an existing row's balance. */
async function bootstrapPeriod(storeId: number, yearMonth: string): Promise<PettyCashPeriod> {
  await db
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: String(PETTY_CASH_MAX_BALANCE),
      currentBalance: String(PETTY_CASH_MAX_BALANCE),
      status: 'open',
    })
    .onConflictDoNothing({ target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth] });

  const [period] = await db
    .select()
    .from(pettyCashPeriods)
    .where(and(eq(pettyCashPeriods.storeId, storeId), eq(pettyCashPeriods.yearMonth, yearMonth)))
    .limit(1);

  if (!period) throw new Error('Failed to create petty cash period.');
  return period;
}

/**
 * Force this exact month's period to the max balance — creating it if
 * missing. This is the deliberate "the store actually received the cash"
 * moment (a completed refill); never call this for passive balance lookups.
 * Closed periods are left untouched (frozen books stay frozen).
 */
export async function topUpPeriodToMax(storeId: number, yearMonth: string): Promise<PettyCashPeriod> {
  const [existing] = await db
    .select()
    .from(pettyCashPeriods)
    .where(and(eq(pettyCashPeriods.storeId, storeId), eq(pettyCashPeriods.yearMonth, yearMonth)))
    .limit(1);

  if (existing && existing.status !== 'open') {
    return existing;
  }

  const [period] = await db
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: String(PETTY_CASH_MAX_BALANCE),
      currentBalance: String(PETTY_CASH_MAX_BALANCE),
      status: 'open',
    })
    .onConflictDoUpdate({
      target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth],
      set: {
        currentBalance: String(PETTY_CASH_MAX_BALANCE),
        updatedAt: new Date(),
      },
    })
    .returning();

  return period;
}

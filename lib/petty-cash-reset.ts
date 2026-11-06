// lib/petty-cash-reset.ts
//
// IT "Reset Petty Cash" — shapes shared by the IT page and its API (client-safe, no DB imports).
// The logic is lib/db/utils/petty-cash-reset.ts; the API is /api/it/petty-cash-reset.
//
// A reset wipes the petty cash ACTIVITY of ONE store — never the settings (categories, users, stores):
//
//   • ONE PERIOD   the requests of that period and the refill that settles it go; the period itself stays
//                  (same status, so the chain of periods is never broken) with its balance back at the full
//                  Rp 1.000.000.
//   • ALL PERIODS  every request, refill and period of the store goes, and — for an active store — one fresh
//                  open period for this Jakarta month starts at Rp 1.000.000 (what the prod reset script
//                  does for every store, here for one).

import type { PeriodStatus } from '@/lib/petty-cash-period';
import type { RefillState } from '@/lib/petty-cash-report';

export type ResetScope = { type: 'period'; yearMonth: string } | { type: 'all' };

/** What `scope` looks like in a query string / JSON body: `all`, or `period` + a YYYY-MM month. */
export function parseResetScope(scope: unknown, month: unknown): ResetScope | null {
  if (scope === 'all') return { type: 'all' };
  if (scope === 'period' && typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { type: 'period', yearMonth: month };
  }
  return null;
}

/** A store in the picker, with how much petty cash data it holds. */
export interface ResetStoreRow {
  id: number;
  storeNo: string;
  name: string;
  status: string;
  periods: number;
  requests: number;
  refillRequests: number;
}

/** One period of the chosen store, as listed on the page. */
export interface ResetPeriodRow {
  yearMonth: string;
  status: PeriodStatus;
  balance: number;
  /** Requests filed under this period (any state). */
  requests: number;
  /** Of those: still waiting on OPS or on the PIC to confirm what was spent. */
  waiting: number;
  /** Of those: completed (the money was cut from the balance). */
  completed: number;
  /** The refill that settles this period (the latest one), null = none was sent. */
  refill: { state: RefillState; count: number } | null;
}

export interface ResetOverview {
  store: { id: number; storeNo: string; name: string; status: string };
  /** Newest period first. */
  periods: ResetPeriodRow[];
  /** Requests / refills of the store in total (what "all periods" removes). */
  totals: { requests: number; refillRequests: number };
}

/** What a reset is about to do (counts only — nothing has changed yet). */
export interface ResetPreview {
  store: { id: number; storeNo: string; name: string; status: string };
  scope: ResetScope;
  requests: number;
  requestsByStatus: Record<string, number>;
  /** Rupiah of the completed requests (actual amount) that are deleted with them. */
  completedAmount: number;
  refillRequests: number;
  /** Refills Finance already verified — the cash was sent to the store. */
  refillsVerified: number;
  /** Of those verified: the stores already confirmed receiving it (both proof photos). */
  refillsReceived: number;
  /** Rupiah Finance transferred on the verified refills in scope. */
  transferredAmount: number;
  /** Refills still on their way (waiting on OPS, or approved and not received yet). */
  refillsInFlight: number;
  /** Legacy month-end refills (petty_cash_refills). */
  legacyRefills: number;
  /** Period rows that disappear ("all periods") — a single-period reset keeps its row. */
  periodsRemoved: number;
  notifications: number;
  /** Period scope: Re-requests filed in other periods whose original request is deleted (they lose that link). */
  orphanedReRequests: number;
  /** How the store looks afterwards. */
  after: {
    /** The period left standing (null = none: the store is not active). */
    yearMonth: string | null;
    status: PeriodStatus | null;
    balance: number | null;
  };
}

export interface ResetResult {
  store: ResetPreview['store'];
  scope: ResetScope;
  deleted: {
    requests: number;
    refillRequests: number;
    legacyRefills: number;
    periods: number;
    notifications: number;
  };
  after: ResetPreview['after'];
}

/** "Periode November 2026" / "Semua periode" — for titles and toasts. */
export function resetScopeTitle(scope: ResetScope, periodName: (ym: string) => string): string {
  return scope.type === 'all' ? 'Semua periode' : `Periode ${periodName(scope.yearMonth)}`;
}

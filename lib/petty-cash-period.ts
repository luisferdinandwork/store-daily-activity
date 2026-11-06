// lib/petty-cash-period.ts
//
// Petty cash PERIOD rules (client-safe, no DB imports) — shared by the employee Petty Cash page, its APIs,
// the refill / re-request logic and the Ops + Finance views.
//
// A store's petty cash runs in periods named after a month (YYYY-MM). The period in use takes every new
// request. When PIC 1 sends the REFILL for it, that period is CLOSED on the spot — what was used is now fixed,
// and that is what Finance transfers — and the NEXT period opens right away. Requests keep being filed while the
// refill is still with OPS / Finance / waiting for PIC 1's receipt photos; they belong to the next period:
//
//     November period ──refill sent──▶ closed        December period ◀── new requests, from this moment
//
//   • a request still waiting on OPS (or OPS-approved and not yet confirmed) when the refill is sent moves to
//     the next period with it — it has not cost anything yet;
//   • a Re-request (a Perlu Perbaikan request filed again) is always counted in the period AFTER the one the
//     original was filed in, so Finance sees it in its next monthly check, never in the one that sent it back;
//   • the refill is due before the 15th of the period's month. After that it can still be sent, but it is
//     flagged "Terlambat" for OPS and Finance.

import { isDayKey } from '@/lib/day-bucket';

/** The refill of a period is due on or before this day of the period's month. */
export const REFILL_DEADLINE_DAY = 15;

/**
 * The first period the deadline counts for — refills of earlier periods (filed before the rule existed) are never
 * flagged late.
 */
export const REFILL_DEADLINE_FIRST_PERIOD = '2026-11';

/** `period.status` values. 'upcoming' = created ahead of time (only a Re-request lands there) and not open yet. */
export type PeriodStatus = 'open' | 'upcoming' | 'closed';

/** How IT sees a period's status (Reset Petty Cash). */
export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  open: 'Dipakai',
  upcoming: 'Akan datang',
  closed: 'Ditutup',
};

export const isValidYearMonth = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** "2026-11" → "November 2026" (fixed Indonesian wording, the same on the server and in the browser). */
export function periodLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return MONTHS_ID[(m || 1) - 1] ? `${MONTHS_ID[m - 1]} ${y}` : yearMonth;
}

/** "2026-11" → "November". */
export function periodMonthName(yearMonth: string): string {
  const [, m] = yearMonth.split('-').map(Number);
  return MONTHS_ID[(m || 1) - 1] ?? yearMonth;
}

/** "2026-11" + 1 → "2026-12". */
export function addMonths(yearMonth: string, amount: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The later of two periods (YYYY-MM sorts as text). */
export const laterMonth = (a: string, b: string): string => (a >= b ? a : b);

/**
 * The period a Re-request is counted in: the one after the original's, but never one that is already closed —
 * when the store has moved on (the original is old), it goes to the period in use.
 */
export function reRequestPeriodMonth(originMonth: string, usageMonth: string): string {
  return laterMonth(addMonths(originMonth, 1), usageMonth);
}

/** The last day the refill of `periodMonth` is on time, as YYYY-MM-DD. */
export function refillDeadline(periodMonth: string): string {
  return `${periodMonth}-${String(REFILL_DEADLINE_DAY).padStart(2, '0')}`;
}

export interface DeadlineStatus {
  /** YYYY-MM-DD — the last day it is on time. */
  deadline: string;
  /** Days from `today` to the deadline: 0 = today is the last day, negative = past it. */
  daysLeft: number;
  /** `today` is past the deadline. */
  late: boolean;
  /** Is the deadline in force for this period at all (see REFILL_DEADLINE_FIRST_PERIOD)? */
  applies: boolean;
}

/** Where a refill of `periodMonth` stands against its deadline on Jakarta day `today` (YYYY-MM-DD). */
export function deadlineStatus(periodMonth: string, today: string): DeadlineStatus {
  const deadline = refillDeadline(periodMonth);
  const applies = periodMonth >= REFILL_DEADLINE_FIRST_PERIOD;
  const daysLeft = isDayKey(today) ? daysBetween(today, deadline) : 0;
  return { deadline, daysLeft, late: applies && daysLeft < 0, applies };
}

/** True when a refill filed on Jakarta day `filedOn` was past the deadline of `periodMonth`. */
export function isRefillLate(periodMonth: string, filedOn: string): boolean {
  return deadlineStatus(periodMonth, filedOn).late;
}

function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

// ─── Receipt photo rule ──────────────────────────────────────────────────────

/**
 * The receipt photo of a request can be changed only until the request is finished (Selesai). Once it is
 * completed the photo is a record Finance may be looking at, so it is locked — the only way to put another
 * photo in is a Re-request. Two exceptions that are not "changing" it: an OPS-approved request (not finished
 * yet) can swap it freely, and a finished request that never got a photo can still have its first one added
 * (unless Finance already turned it down — then there is nothing left to upload).
 */
export function receiptPhotoAction(tx: {
  status: string;
  hasPhoto: boolean;
  financeReview: string | null | undefined;
}): 'replace' | 'add' | 'locked' | 'none' {
  if (tx.status === 'ops_approved') return tx.hasPhoto ? 'replace' : 'add';
  if (tx.status !== 'completed') return 'none';
  if (tx.financeReview === 'needs_fix' || tx.financeReview === 'rejected') return tx.hasPhoto ? 'locked' : 'none';
  return tx.hasPhoto ? 'locked' : 'add';
}

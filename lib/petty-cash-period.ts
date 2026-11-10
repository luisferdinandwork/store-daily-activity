// lib/petty-cash-period.ts
//
// Petty cash PERIOD rules (client-safe, no DB imports) — shared by the employee Petty Cash page, its APIs,
// the refill / re-request logic and the Ops + Finance views.
//
// A store's petty cash runs in periods named after a month (YYYY-MM). THE CALENDAR decides which period is in
// use, not the Refill: a period runs from the 16th of the month before its name to the 15th of its name, and
// the day after the 15th everything filed is counted in the next one —
//
//     November period            December period
//     16 Okt ───────── 15 Nov │ 16 Nov ───────── 15 Des │ 16 Des …
//                             ▲ the period changes by itself on the 16th (Jakarta), refill or not
//
//   • the Refill of a period is due on or before its last day (the 15th). Sending it does NOT close anything —
//     the period keeps taking requests until the 15th is over;
//   • a Refill sent after the 15th settles the period that has just ended, as long as nobody has requested it
//     yet (it is flagged "Terlambat"); once that period is settled, a Refill covers the period in use. Before
//     or on the 15th it covers the period in use too — unless an older period is still waiting for its Refill,
//     which always goes first (`pickRefillPeriod`);
//   • a request still waiting on OPS (or OPS-approved and not yet confirmed) when the period ends moves to the
//     new one with it — it has not cost anything yet;
//   • a Re-request (a Perlu Perbaikan request filed again) is always counted in the period AFTER the one the
//     original was filed in, so Finance sees it in its next monthly check, never in the one that sent it back.

import { isDayKey } from '@/lib/day-bucket';

/** The refill of a period is due on or before this day of the period's month. */
export const REFILL_DEADLINE_DAY = 15;

/**
 * The last day of a period, in the month it is named after — the same day its Refill is due. The 16th starts the
 * next period.
 */
export const PERIOD_LAST_DAY = REFILL_DEADLINE_DAY;

/** The most a store's cash box holds (and so the most a period can hold) — mirrors PETTY_CASH_MAX_BALANCE. */
const MAX_BALANCE = 1_000_000;

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

// ─── The calendar decides the period ─────────────────────────────────────────

/**
 * The period a Jakarta day (YYYY-MM-DD) belongs to: up to and including the 15th it is that month's period,
 * from the 16th on it is the NEXT month's — "2026-11-15" → "2026-11", "2026-11-16" → "2026-12".
 */
export function usagePeriodFor(dayKey: string): string {
  if (!isDayKey(dayKey)) return dayKey.slice(0, 7);
  const month = dayKey.slice(0, 7);
  return Number(dayKey.slice(8, 10)) > PERIOD_LAST_DAY ? addMonths(month, 1) : month;
}

/** First and last day (YYYY-MM-DD) of a period: "2026-11" → 2026-10-16 … 2026-11-15. */
export function periodWindow(periodMonth: string): { from: string; to: string } {
  return {
    from: `${addMonths(periodMonth, -1)}-${String(PERIOD_LAST_DAY + 1).padStart(2, '0')}`,
    to: `${periodMonth}-${String(PERIOD_LAST_DAY).padStart(2, '0')}`,
  };
}

const MONTHS_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-11" → "16 Okt – 15 Nov 2026" (the year shows on both ends only when the period crosses a year). */
export function periodRangeLabel(periodMonth: string): string {
  const { from, to } = periodWindow(periodMonth);
  const part = (key: string, withYear: boolean) => {
    const [y, m, d] = key.split('-').map(Number);
    return `${d} ${MONTHS_SHORT_ID[m - 1] ?? m}${withYear ? ` ${y}` : ''}`;
  };
  const crossesYear = from.slice(0, 4) !== to.slice(0, 4);
  return `${part(from, crossesYear)} – ${part(to, true)}`;
}

/** What `pickRefillPeriod` needs to know about a period of the store. */
export interface RefillCandidate {
  /** YYYY-MM */
  month: string;
  /** What the period has left on paper (`current_balance`). */
  balance: number;
  /** A Refill for it was asked for and not turned down (on its way or received) — or Finance settled it itself. */
  settled: boolean;
}

/**
 * The period a Refill sent now settles — `null` when there is nothing to refill.
 *
 * It is the OLDEST period, up to the one in use, that has been used and whose Refill nobody has asked for yet:
 *   • after the 15th the period that has just ended is still waiting → the Refill is for it (late);
 *   • on or before the 15th, with the previous period settled → the period in use;
 *   • on or before the 15th, with the previous period still waiting → that one first.
 * Periods older than the store's latest settled one are ignored (they belong to a cycle already closed out), and
 * a period whose Refill OPS turned down counts as waiting again.
 */
export function pickRefillPeriod(periods: RefillCandidate[], usageMonth: string): string | null {
  const lastSettled = periods
    .filter((p) => p.settled)
    .map((p) => p.month)
    .sort()
    .pop();

  const waiting = periods
    .filter(
      (p) =>
        !p.settled &&
        p.month <= usageMonth &&
        (lastSettled == null || p.month > lastSettled) &&
        p.balance < MAX_BALANCE,
    )
    .sort((a, b) => a.month.localeCompare(b.month));

  return waiting[0]?.month ?? null;
}

/**
 * What was used from a period AFTER Finance froze the amount of its Refill (`transferAmount`) — cash the Refill
 * did not cover. It carries into the next period, whose balance starts that much lower, so the next Refill pays
 * it. `balance` is the period's balance when it ended.
 */
export function uncoveredUsage(balance: number, transferAmount: number | null | undefined): number {
  if (transferAmount == null) return 0;
  return Math.max(0, Math.round(MAX_BALANCE - balance - transferAmount));
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

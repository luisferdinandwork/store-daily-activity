// lib/uang-modal-review.ts
// Shapes and rules for Finance's Uang Modal Review (daily) and Uang Modal Report
// (monthly) — client-safe, no DB imports. Shared by both pages, their APIs and
// the Excel export.
//
// Uang modal is the cashier's opening float. Unlike a deposit there is nothing
// to reconcile against a bank: what matters is HOW FULL the float is against
// its daily cap, so the review is built around fill rate and shortfall.

export { storeCodeOf } from '@/lib/petty-cash-report';
export { groupRowsByCode, type CodeGroup } from '@/lib/finance/code-groups';
export {
  dayBounds,
  dayKey,
  fmtDateLong,
  fmtDateShort,
  fmtDateTime,
  monthBounds,
  shiftDate,
  todayJakarta,
} from '@/lib/finance/dates';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Daily maximum uang modal / cashier float. Employees may report any total up
 * to this, but not above it (enforced in lib/db/utils/cek-uang-modal.ts).
 */
export const UANG_MODAL_MAX_TOTAL = 500_000;

/** Indonesian rupiah denominations used for cashier opening cash, largest first. */
export const UANG_MODAL_DENOMINATIONS = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100] as const;

// ─── Daily row ───────────────────────────────────────────────────────────────

export type UangModalTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'pending' | 'no_data';

export interface UangModalDenomination {
  value: number;
  quantity: number;
  amount: number;
}

export interface UangModalRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  /** Letters of the store code — FF001 → "FF". */
  code: string;

  /** Null when the store is scheduled but no task row exists. */
  taskId: number | null;
  status: UangModalTaskStatus;

  /** Cash counted, integer Rupiah. Null while nothing has been entered. */
  total: number | null;
  /** The cap this task was counted against. */
  max: number;
  /** Denominations actually counted (quantity > 0), largest first. */
  denominations: UangModalDenomination[];

  notes: string | null;
  submittedBy: string | null;
  completedAt: string | null;

  verifiedBy: string | null;
  verifiedAt: string | null;
  /** Completed and not verified yet. */
  canVerify: boolean;

  /** Staff on an opening shift that day. */
  scheduledStaff: { userId: string; name: string }[];
}

// ─── Review status ───────────────────────────────────────────────────────────

export type ReviewStatus =
  | 'belum_lapor'  // red    — day is over and no float was reported
  | 'kosong'       // red    — reported, but nothing was counted (Rp 0)
  | 'kurang'       // amber  — counted, but below the daily cap ("belum penuh")
  | 'draft'        // blue   — being counted today
  | 'belum_mulai'  // slate  — not started yet (today / future)
  | 'penuh';       // green  — float is at the cap

export interface StatusMeta {
  label: string;
  dot: string;
  badge: string;
  /** Counted as needing Finance's attention. */
  attention: boolean;
}

export const STATUS_META: Record<ReviewStatus, StatusMeta> = {
  belum_lapor: { label: 'Belum lapor', dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',          attention: true },
  kosong:      { label: 'Kosong',      dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',          attention: true },
  kurang:      { label: 'Belum penuh', dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-800 ring-amber-200',       attention: true },
  draft:       { label: 'Draft',       dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',          attention: false },
  belum_mulai: { label: 'Belum mulai', dot: 'bg-slate-300',   badge: 'bg-slate-100 text-slate-600 ring-slate-200',      attention: false },
  penuh:       { label: 'Penuh',       dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', attention: false },
};

export const STATUS_ORDER: ReviewStatus[] = ['belum_lapor', 'kosong', 'kurang', 'draft', 'belum_mulai', 'penuh'];

/** `isPastDay` — the reviewed date is before today (Jakarta), so "not reported" is now a miss. */
export function deriveReviewStatus(row: UangModalRow, isPastDay: boolean): ReviewStatus {
  if (row.status === 'completed') {
    const total = row.total ?? 0;
    if (total <= 0) return 'kosong';
    return total < row.max ? 'kurang' : 'penuh';
  }
  if (row.status === 'in_progress') return isPastDay ? 'belum_lapor' : 'draft';
  return isPastDay ? 'belum_lapor' : 'belum_mulai';
}

/** Rp still missing from the cap on a submitted float; 0 when full or not submitted. */
export function shortfallOf(row: UangModalRow): number {
  if (row.status !== 'completed') return 0;
  return Math.max(0, row.max - (row.total ?? 0));
}

/** Share of the cap that is filled, 0–100; null when nothing has been submitted. */
export function fillPct(row: UangModalRow): number | null {
  if (row.status !== 'completed' || row.max <= 0) return null;
  return Math.min(100, Math.round(((row.total ?? 0) / row.max) * 100));
}

export interface DayTotals {
  /** Stores that submitted. */
  submitted: number;
  total: number;
  shortfall: number;
  /** Combined cap of the stores that submitted. */
  max: number;
}

export function sumDay(rows: UangModalRow[]): DayTotals {
  const t: DayTotals = { submitted: 0, total: 0, shortfall: 0, max: 0 };
  for (const r of rows) {
    if (r.status !== 'completed') continue;
    t.submitted += 1;
    t.total += r.total ?? 0;
    t.shortfall += shortfallOf(r);
    t.max += r.max;
  }
  return t;
}

// ─── Monthly row ─────────────────────────────────────────────────────────────

export interface UangModalMonthRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  code: string;

  /** Days with an opening-shift schedule, up to and including today. */
  workDays: number;
  /** Submitted with the float at the cap. */
  fullDays: number;
  /** Submitted below the cap. */
  shortDays: number;
  /** Submitted with nothing counted. */
  emptyDays: number;
  /** Past work days with no submission. */
  missedDays: number;

  /** Sum of counted cash over the submitted days. */
  totalCounted: number;
  /** Sum of (cap − counted) over the submitted days. */
  totalShortfall: number;
  /** Average counted per submitted day; 0 when none. */
  avgCounted: number;
  /** Average fill of the cap over the submitted days, 0–100. */
  avgFillPct: number;

  /**
   * How many of the store's most recent work days in a row were NOT full
   * (short, empty or missed) — a store that is short every day needs a call.
   */
  notFullStreak: number;

  /** Submitted floats Finance hasn't verified yet. */
  unverified: number;
  /** YYYY-MM-DD of the latest submission in the month. */
  lastSubmittedDate: string | null;
}

export interface MonthTotals {
  stores: number;
  workDays: number;
  fullDays: number;
  shortDays: number;
  emptyDays: number;
  missedDays: number;
  totalCounted: number;
  totalShortfall: number;
  /** Fill of the cap across every submitted day of every store, 0–100. */
  fillPct: number;
  unverified: number;
}

export function sumMonth(rows: UangModalMonthRow[]): MonthTotals {
  const t: MonthTotals = {
    stores: rows.length, workDays: 0, fullDays: 0, shortDays: 0, emptyDays: 0, missedDays: 0,
    totalCounted: 0, totalShortfall: 0, fillPct: 0, unverified: 0,
  };
  for (const r of rows) {
    t.workDays += r.workDays;
    t.fullDays += r.fullDays;
    t.shortDays += r.shortDays;
    t.emptyDays += r.emptyDays;
    t.missedDays += r.missedDays;
    t.totalCounted += r.totalCounted;
    t.totalShortfall += r.totalShortfall;
    t.unverified += r.unverified;
  }
  const cap = t.totalCounted + t.totalShortfall;
  t.fillPct = cap > 0 ? Math.round((t.totalCounted / cap) * 100) : 0;
  return t;
}

/** A store's month needs attention when it missed days, kept coming up short, or has unverified floats. */
export const hasMonthIssue = (r: UangModalMonthRow) =>
  r.missedDays > 0 || r.shortDays > 0 || r.emptyDays > 0 || r.unverified > 0;

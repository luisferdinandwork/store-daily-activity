// lib/store-closing-review.ts
// Shapes and rules for Finance's Store Closing page — client-safe, no DB
// imports. Shared by the page and its API.
//
// Finance only needs two things from a store's closing: the photo of the
// Z-Report + EDC settlement together, and whether the Open Statement was
// POSTED or put ON HOLD — and, for a hold, to flip it to posted once it has
// been fixed.

export { storeCodeOf } from '@/lib/petty-cash-report';
export { groupRowsByCode, type CodeGroup } from '@/lib/finance/code-groups';
export {
  dayBounds,
  dayKey,
  fmtDateLong,
  fmtDateShort,
  fmtDateTime,
  shiftDate,
  todayJakarta,
} from '@/lib/finance/dates';

export type ClosingTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'pending' | 'no_data';

export interface StoreClosingRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  /** Letters of the store code — FF001 → "FF". */
  code: string;

  /** Null when the store was scheduled to close but no task row exists. */
  taskId: number | null;
  /** YYYY-MM-DD the closing belongs to (a held one can be from an earlier day). */
  date: string;
  status: ClosingTaskStatus;

  /** The one photo of the Z-Report and EDC settlement together. */
  zReportPhoto: string | null;

  // Open Statement
  decision: 'post_statement' | 'on_hold' | null;
  isOnHold: boolean;
  holdReason: string | null;
  heldAt: string | null;
  /** Set once a hold was resolved — by Finance ("fixed") or by Ops + a re-post. */
  holdResolvedAt: string | null;
  /** The Ops hold issue: title + status, so Finance can see where it stands. */
  holdIssue: { id: number; status: string } | null;
  /** Ops resolved the hold issue and the store now has to post the statement again. */
  reopened: boolean;
  /** Finance name when Finance flipped a hold to posted. */
  fixedBy: string | null;
  fixedAt: string | null;

  // Checklist
  eodZReportDone: boolean;
  edcSettlementDone: boolean;
  edcSummaryDone: boolean;
  notes: string | null;

  submittedBy: string | null;
  completedAt: string | null;
  photoAt: string | null;

  /** Staff on a closing shift that day. */
  scheduledStaff: { userId: string; name: string }[];

  /** Held and not fixed yet — Finance can mark the statement as posted. */
  canFix: boolean;
}

// ─── Statement state ─────────────────────────────────────────────────────────

export type StatementState =
  | 'on_hold'            // amber — statement is on hold
  | 'reopened'           // sky   — hold resolved by Ops, store has to post it
  | 'posted'             // green — statement posted
  | 'posted_after_hold'  // green — was on hold, now posted (fixed)
  | 'not_submitted'      // red   — day is over, closing never submitted
  | 'draft'              // blue  — being filled in today
  | 'not_started';       // slate — not started yet

export interface StatementMeta {
  label: string;
  dot: string;
  badge: string;
  attention: boolean;
}

export const STATEMENT_META: Record<StatementState, StatementMeta> = {
  on_hold:           { label: 'On Hold',              dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-800 ring-amber-300',       attention: true },
  reopened:          { label: 'Menunggu posting',     dot: 'bg-sky-500',     badge: 'bg-sky-50 text-sky-700 ring-sky-200',             attention: true },
  posted:            { label: 'Posted',               dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', attention: false },
  posted_after_hold: { label: 'Posted (diperbaiki)',  dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', attention: false },
  not_submitted:     { label: 'Belum submit',         dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',          attention: true },
  draft:             { label: 'Draft',                dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',          attention: false },
  not_started:       { label: 'Belum mulai',          dot: 'bg-slate-300',   badge: 'bg-slate-100 text-slate-600 ring-slate-200',      attention: false },
};

export const STATEMENT_ORDER: StatementState[] = [
  'on_hold', 'reopened', 'not_submitted', 'draft', 'not_started', 'posted', 'posted_after_hold',
];

/** `isPastDay` — the row's date is before today (Jakarta), so "not submitted" is now a miss. */
export function deriveStatement(row: StoreClosingRow, isPastDay: boolean): StatementState {
  if (row.isOnHold) return 'on_hold';
  if (row.status === 'completed') {
    return row.holdResolvedAt ? 'posted_after_hold' : 'posted';
  }
  if (row.reopened) return 'reopened';
  if (row.status === 'in_progress') return isPastDay ? 'not_submitted' : 'draft';
  return isPastDay ? 'not_submitted' : 'not_started';
}

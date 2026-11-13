// lib/petty-cash-transactions.ts
// Shapes for Finance's Petty Cash Transactions list (client-safe, no DB
// imports) — shared by the page and its API.

import { isIsoDay, todayJakarta } from '@/lib/finance/dates';
import { FINANCE_REVIEW_LABEL, PENDING_FINANCE_LABEL, isFinanceReview } from '@/lib/petty-cash-review';

/**
 * petty_cash_transactions.status — see lib/db/schema/petty-cash.ts. `draft` = Finance sent a completed request back
 * (Perlu Perbaikan): the SAME request is with PIC 1 to fix, then goes to OPS again (lib/petty-cash-review.ts).
 */
export type TxStatus = 'draft' | 'pending_ops' | 'ops_approved' | 'completed' | 'ops_rejected';

export const TX_STATUS_ORDER: TxStatus[] = ['pending_ops', 'ops_approved', 'completed', 'ops_rejected', 'draft'];

export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  pending_ops: 'Waiting OPS',
  ops_approved: 'Awaiting actual amount',
  completed: 'Completed',
  ops_rejected: 'Rejected',
  draft: 'Draft',
};

export const isTxStatus = (v: string): v is TxStatus => (TX_STATUS_ORDER as string[]).includes(v);

// ─── One state per request, as Finance sees it ───────────────────────────────
// A completed request is "Pending Finance" until Finance picks Diterima / Perlu Perbaikan / Ditolak; that decision
// then IS its state (no separate "Completed" next to it). Before that it is wherever OPS / PIC 1 left it.

export type FinanceRequestState =
  | 'waiting_ops'
  | 'awaiting_actual'
  | 'ops_rejected'
  | 'pending_finance'
  | 'accepted'
  | 'needs_fix'
  | 'rejected';

export function financeRequestState(status: string, review: string | null | undefined): FinanceRequestState {
  // Sent back to PIC 1 to fix: still Perlu Perbaikan until it comes back through OPS.
  if (status === 'draft') return 'needs_fix';
  if (status === 'pending_ops') return 'waiting_ops';
  if (status === 'ops_approved') return 'awaiting_actual';
  if (status === 'ops_rejected') return 'ops_rejected';
  return isFinanceReview(review) ? review : 'pending_finance';
}

export const FINANCE_REQUEST_STATE_LABEL: Record<FinanceRequestState, string> = {
  waiting_ops: TX_STATUS_LABEL.pending_ops,
  awaiting_actual: TX_STATUS_LABEL.ops_approved,
  ops_rejected: 'Rejected OPS',
  pending_finance: PENDING_FINANCE_LABEL,
  accepted: FINANCE_REVIEW_LABEL.accepted,
  needs_fix: FINANCE_REVIEW_LABEL.needs_fix,
  rejected: FINANCE_REVIEW_LABEL.rejected,
};

/** Text colour per state (petty cash keeps its own colour map). */
export const FINANCE_REQUEST_STATE_TEXT: Record<FinanceRequestState, string> = {
  waiting_ops: 'text-amber-600',
  awaiting_actual: 'text-sky-600',
  ops_rejected: 'text-rose-500',
  pending_finance: 'text-indigo-600',
  accepted: 'text-emerald-600',
  needs_fix: 'text-amber-700',
  rejected: 'text-rose-600',
};

// ─── Finance decision filter ─────────────────────────────────────────────────
// What Finance did with a completed request: nothing yet (Pending Finance) or one of its three decisions.

export type TxReviewFilter = 'pending' | 'accepted' | 'needs_fix' | 'rejected';

export const TX_REVIEW_FILTER_ORDER: TxReviewFilter[] = ['pending', 'accepted', 'needs_fix', 'rejected'];

export const TX_REVIEW_FILTER_LABEL: Record<TxReviewFilter, string> = {
  pending: PENDING_FINANCE_LABEL,
  accepted: 'Diterima',
  needs_fix: 'Perlu Perbaikan',
  rejected: 'Ditolak',
};

export const isTxReviewFilter = (v: string): v is TxReviewFilter => (TX_REVIEW_FILTER_ORDER as string[]).includes(v);

/** Has the request a receipt photo? */
export type TxPhotoFilter = 'with' | 'without';
export const TX_PHOTO_FILTER_LABEL: Record<TxPhotoFilter, string> = { with: 'Ada foto struk', without: 'Tanpa foto struk' };

// ─── Sort ────────────────────────────────────────────────────────────────────

export type TxSortKey = 'date' | 'store' | 'category' | 'submitter' | 'amount' | 'actual' | 'status';
export type SortDir = 'asc' | 'desc';

export const TX_SORT_KEYS: TxSortKey[] = ['date', 'store', 'category', 'submitter', 'amount', 'actual', 'status'];

export const TX_SORT_LABEL: Record<TxSortKey, string> = {
  date: 'Tanggal',
  store: 'Nama toko',
  category: 'Kategori',
  submitter: 'Diajukan oleh',
  amount: 'Nominal diajukan',
  actual: 'Nominal aktual',
  status: 'Status',
};

export const isTxSortKey = (v: string): v is TxSortKey => (TX_SORT_KEYS as string[]).includes(v);

/** The direction a column starts in when first clicked: newest / biggest first, names A→Z. */
export const defaultSortDir = (key: TxSortKey): SortDir =>
  key === 'date' || key === 'amount' || key === 'actual' ? 'desc' : 'asc';

export interface TransactionRow {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  /** The store's BC department code (Finance + IT only) — "Department Code" in the Purchase Invoice export. */
  deptCode: string | null;
  categoryName: string | null;
  /** The category's IS (Business Central item no.) — "No." in the Purchase Invoice export. */
  isCode: string | null;
  description: string;
  submittedBy: string;
  /** What the PIC asked for — an estimate. */
  amount: number;
  /** What was really spent; null until the PIC records it. */
  actualAmount: number | null;
  status: string;
  imageUrl: string | null;
  rejectionReason: string | null;
  /** When the request was made (ISO instant). */
  createdAt: string;
  /** Finance's review; Perlu Perbaikan / Ditolak requests are not counted as used. */
  financeReview: string | null;
  /** Finance's comment on that decision, if it left one. */
  financeComment: string | null;
  /** A Perlu Perbaikan request PIC 1 filed again (lib/petty-cash-re-request.ts); `createdAt` is the day it was filed. */
  isReRequest: boolean;
  /** The day PIC 1 gave as the day the request was made (YYYY-MM-DD); null on a normal request. */
  requestDate: string | null;
}

export interface TransactionStoreOption {
  id: number;
  storeNo: string;
  name: string;
  areaId: number;
}

export interface TransactionAreaOption {
  id: number;
  name: string;
}

/** Numbers for everything the filters select except the status, so the status counts keep their breakdown. */
export interface TransactionSummary {
  count: number;
  /** Requests Finance accepted (Diterima), actual amount — the same "used" as Monitoring and the Report. */
  totalUsed: number;
  byStatus: Record<TxStatus, number>;
  /** Completed requests Finance has not decided on yet (Pending Finance). */
  pendingFinance: number;
  /** How many of them are re-requests. */
  reRequestCount: number;
}

export interface TransactionsPage {
  from: string;
  to: string;
  rows: TransactionRow[];
  summary: TransactionSummary;
  /** Every store with petty cash (ready_to_open ones are left out), for the store + area pickers. */
  stores: TransactionStoreOption[];
  areas: TransactionAreaOption[];
  /** Every category name used so far, for the category picker. */
  categories: string[];
  /** Rows matching every filter, status included. */
  matching: number;
  /** The table's Total line: sums over EVERY matching row (not just the page on screen). */
  totals: TransactionTotals;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TransactionTotals {
  /** Diajukan — what was asked for. */
  amount: number;
  /** Aktual — what was recorded as spent (requests without one add nothing). */
  actual: number;
}

/** The filters both the list and its Excel export accept (query string → validated values). */
export interface TransactionQuery {
  from: string;
  to: string;
  storeId: number | null;
  areaId: number | null;
  status: TxStatus | null;
  /** Free text: store name / code, description, category, who filed it, `#id` or an amount. */
  q: string | null;
  category: string | null;
  review: TxReviewFilter | null;
  /** Only re-requests. */
  reRequest: boolean;
  photo: TxPhotoFilter | null;
  /** Rupiah, on the amount that counts (actual when recorded, else the one asked for). */
  minAmount: number | null;
  maxAmount: number | null;
  sort: TxSortKey;
  dir: SortDir;
  page: number;
}

const Q_MAX = 100;
const CATEGORY_MAX = 80;

/** A whole, non-negative Rupiah amount from a query value (dots / spaces tolerated), or null when blank. */
function amountParam(raw: string | null): { ok: true; value: number | null } | { ok: false } {
  const cleaned = raw?.replace(/[.\s]/g, '') ?? '';
  if (cleaned === '') return { ok: true, value: null };
  if (!/^\d{1,12}$/.test(cleaned)) return { ok: false };
  return { ok: true, value: Number(cleaned) };
}

/** ?from&to[&storeId][&areaId][&status][&q][&category][&review][&reRequest][&photo][&min][&max][&sort][&dir][&page] — from/to default to this month so far. */
export function parseTransactionQuery(
  q: URLSearchParams,
): ({ ok: true } & TransactionQuery) | { ok: false; error: string } {
  const today = todayJakarta();
  const from = q.get('from') ?? `${today.slice(0, 8)}01`;
  const to = q.get('to') ?? today;

  if (!isIsoDay(from) || !isIsoDay(to)) return { ok: false, error: 'Invalid date. Use YYYY-MM-DD.' };
  if (from > to) return { ok: false, error: '"from" must not be after "to".' };

  const storeParam = q.get('storeId');
  const storeId = storeParam ? Number(storeParam) : null;
  if (storeId !== null && !Number.isInteger(storeId)) return { ok: false, error: 'Invalid storeId.' };

  const areaParam = q.get('areaId');
  const areaId = areaParam ? Number(areaParam) : null;
  if (areaId !== null && !Number.isInteger(areaId)) return { ok: false, error: 'Invalid areaId.' };

  const statusParam = q.get('status');
  if (statusParam && !isTxStatus(statusParam)) return { ok: false, error: 'Invalid status.' };

  const reviewParam = q.get('review');
  if (reviewParam && !isTxReviewFilter(reviewParam)) return { ok: false, error: 'Invalid review.' };

  const photoParam = q.get('photo');
  if (photoParam && photoParam !== 'with' && photoParam !== 'without') return { ok: false, error: 'Invalid photo filter.' };

  const min = amountParam(q.get('min'));
  const max = amountParam(q.get('max'));
  if (!min.ok || !max.ok) return { ok: false, error: 'Invalid amount.' };
  if (min.value != null && max.value != null && min.value > max.value) {
    return { ok: false, error: 'Minimum amount must not be above the maximum.' };
  }

  const sortParam = q.get('sort');
  if (sortParam && !isTxSortKey(sortParam)) return { ok: false, error: 'Invalid sort.' };
  const sort: TxSortKey = sortParam && isTxSortKey(sortParam) ? sortParam : 'date';
  const dirParam = q.get('dir');
  if (dirParam && dirParam !== 'asc' && dirParam !== 'desc') return { ok: false, error: 'Invalid sort direction.' };

  const text = q.get('q')?.trim().slice(0, Q_MAX) || null;
  const category = q.get('category')?.trim().slice(0, CATEGORY_MAX) || null;

  return {
    ok: true,
    from,
    to,
    storeId,
    areaId,
    status: statusParam && isTxStatus(statusParam) ? statusParam : null,
    q: text,
    category,
    review: reviewParam && isTxReviewFilter(reviewParam) ? reviewParam : null,
    reRequest: q.get('reRequest') === '1',
    photo: photoParam === 'with' || photoParam === 'without' ? photoParam : null,
    minAmount: min.value,
    maxAmount: max.value,
    sort,
    dir: dirParam === 'asc' || dirParam === 'desc' ? dirParam : defaultSortDir(sort),
    page: Math.max(1, Math.floor(Number(q.get('page'))) || 1),
  };
}

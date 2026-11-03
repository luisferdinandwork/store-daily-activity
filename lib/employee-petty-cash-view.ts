// lib/employee-petty-cash-view.ts
//
// View logic for the employee Petty Cash page's request list (client-safe, pure): every request of the
// store — any month — as ONE compact list, searchable, filterable by what state it is in and by month,
// and sortable. Each request is in exactly one group, so it can only ever appear once.

import type { ReviewOutcome } from '@/lib/petty-cash-review';

/** The parts of a request the list needs (the page's own row type extends this). */
export interface RequestViewRow {
  id: number;
  amount: string;
  actualAmount: string | null;
  description: string;
  categoryName: string | null;
  /** petty_cash_transactions.status */
  status: string;
  imageUrl: string | null;
  rejectionReason: string | null;
  /** When it was filed (ISO instant). */
  createdAt: string;
  /** The petty cash period it belongs to (YYYY-MM). */
  month: string;
  /** Finance's decision (Perlu Perbaikan / Ditolak / Diterima). */
  reviewOutcome: ReviewOutcome;
  financeComment: string | null;
  isReRequest: boolean;
}

/** The one state a request is in, in the words the employee sees. */
export type RequestGroup = 'action' | 'pending_ops' | 'done' | 'needs_fix' | 'rejected';

export const GROUP_LABEL: Record<RequestGroup, string> = {
  action: 'Perlu tindakan',
  pending_ops: 'Menunggu OPS',
  done: 'Selesai',
  needs_fix: 'Perlu Perbaikan',
  rejected: 'Ditolak',
};

/**
 * Ditolak is Ditolak whoever said no (OPS or Finance). A finished request Finance left alone is Selesai, unless
 * its receipt is still missing — that is something PIC 1 has to do.
 */
export function requestGroup(tx: Pick<RequestViewRow, 'status' | 'imageUrl' | 'reviewOutcome'>): RequestGroup {
  if (tx.status === 'ops_rejected') return 'rejected';
  if (tx.status === 'pending_ops') return 'pending_ops';
  if (tx.status === 'ops_approved') return 'action';
  if (tx.reviewOutcome === 'rejected') return 'rejected';
  if (tx.reviewOutcome === 'needs_fix') return 'needs_fix';
  return tx.imageUrl ? 'done' : 'action';
}

/** What a filter chip shows: one group, every request, or the re-requests (a flag, across groups). */
export type RequestFilter = 'all' | RequestGroup | 're_request';

/** Chip order: what needs the employee comes first. */
export const FILTER_ORDER: RequestFilter[] = ['all', 'needs_fix', 'action', 'pending_ops', 'done', 'rejected', 're_request'];

export const FILTER_LABEL: Record<RequestFilter, string> = {
  all: 'Semua',
  ...GROUP_LABEL,
  re_request: 'Re-request',
};

export type RequestSort = 'attention' | 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

export const SORT_OPTIONS: { key: RequestSort; label: string }[] = [
  { key: 'attention', label: 'Prioritas' },
  { key: 'newest', label: 'Terbaru' },
  { key: 'oldest', label: 'Terlama' },
  { key: 'amount_desc', label: 'Nominal terbesar' },
  { key: 'amount_asc', label: 'Nominal terkecil' },
];

export interface RequestListState {
  query: string;
  filter: RequestFilter;
  /** 'all' or a petty cash period (YYYY-MM). */
  month: 'all' | string;
  sort: RequestSort;
}

export const DEFAULT_LIST_STATE: RequestListState = { query: '', filter: 'all', month: 'all', sort: 'attention' };

/** What the request cost, Rupiah. */
export const requestAmount = (tx: Pick<RequestViewRow, 'amount' | 'actualAmount'>): number =>
  Number(tx.actualAmount ?? tx.amount);

const digits = (v: string) => v.replace(/\D/g, '');

const MONTHS_ID = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];

/** "2026-11" → "november 2026" (lower-case, for matching only). */
const monthWords = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_ID[(m || 1) - 1] ?? ''} ${y}`;
};

/** True when every word of `query` is found in the request (category, Keterangan, #id, amount, month, state, comments). */
export function matchesSearch(tx: RequestViewRow, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const amount = requestAmount(tx);
  const hay = [
    tx.categoryName,
    tx.description,
    `#${tx.id}`,
    String(Math.round(amount)),
    Math.round(amount).toLocaleString('id-ID'),
    monthWords(tx.month),
    GROUP_LABEL[requestGroup(tx)],
    tx.isReRequest ? 'Re-request' : null,
    tx.financeComment,
    tx.rejectionReason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // "60.000" / "rp60000" typed as an amount match the digits too.
  return words.every((w) => hay.includes(w) || (digits(w).length >= 2 && hay.includes(digits(w))));
}

const inFilter = (tx: RequestViewRow, filter: RequestFilter) =>
  filter === 'all' ? true : filter === 're_request' ? tx.isReRequest : requestGroup(tx) === filter;

/** Search + month, but not the chip — so each chip can show how many requests it would give. */
export function filterExceptChip<T extends RequestViewRow>(rows: T[], s: Pick<RequestListState, 'query' | 'month'>): T[] {
  return rows.filter((r) => (s.month === 'all' || r.month === s.month) && matchesSearch(r, s.query));
}

export function filterRequests<T extends RequestViewRow>(rows: T[], s: RequestListState): T[] {
  return filterExceptChip(rows, s).filter((r) => inFilter(r, s.filter));
}

export function countByFilter(rows: RequestViewRow[]): Record<RequestFilter, number> {
  const out = Object.fromEntries(FILTER_ORDER.map((f) => [f, 0])) as Record<RequestFilter, number>;
  for (const r of rows) {
    out.all += 1;
    out[requestGroup(r)] += 1;
    if (r.isReRequest) out.re_request += 1;
  }
  return out;
}

/** What to look at first: Perlu Perbaikan, then what PIC 1 has to do, then waiting, finished, Ditolak. */
const ATTENTION: Record<RequestGroup, number> = { needs_fix: 0, action: 1, pending_ops: 2, done: 3, rejected: 4 };

const newestFirst = (a: RequestViewRow, b: RequestViewRow) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id;

export function sortRequests<T extends RequestViewRow>(rows: T[], sort: RequestSort): T[] {
  return [...rows].sort((a, b) => {
    switch (sort) {
      case 'attention':
        return ATTENTION[requestGroup(a)] - ATTENTION[requestGroup(b)] || newestFirst(a, b);
      case 'newest':
        return newestFirst(a, b);
      case 'oldest':
        return -newestFirst(a, b);
      case 'amount_desc':
        return requestAmount(b) - requestAmount(a) || newestFirst(a, b);
      case 'amount_asc':
        return requestAmount(a) - requestAmount(b) || newestFirst(a, b);
    }
  });
}

/** The periods the requests belong to, newest first — the month picker's options. */
export function listMonths(rows: Pick<RequestViewRow, 'month'>[]): string[] {
  return [...new Set(rows.map((r) => r.month))].sort().reverse();
}

/** True when the list is narrowed in any way (to show a "reset" link). */
export const isNarrowed = (s: RequestListState): boolean =>
  s.query.trim() !== '' || s.filter !== 'all' || s.month !== 'all';

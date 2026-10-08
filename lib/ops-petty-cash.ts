// lib/ops-petty-cash.ts
//
// Shapes + view logic for Ops' Petty Cash pages (client-safe, no DB imports):
//
//   /ops/petty-cash/requests  spending requests PIC 1 files — Ops approves / rejects
//   /ops/petty-cash/refills   top-up requests — Ops approves / rejects, and sees what
//                             the store used since its last refill
//
// Both pages and the Refills API share these types. Search, filter and sort are
// pure functions so the two pages behave the same way.

import { REFILL_STATE_LABEL, type RefillState } from '@/lib/petty-cash-report';
import { TX_STATUS_LABEL, TX_STATUS_ORDER, isTxStatus, type TxStatus } from '@/lib/petty-cash-transactions';

export type { RefillState, TxStatus };
export { REFILL_STATE_LABEL, TX_STATUS_LABEL, TX_STATUS_ORDER };

export const PAGE_SIZE = 50;

// ─── Month helpers ───────────────────────────────────────────────────────────

/** "2026-10" — a real YYYY-MM. */
export const isValidMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/**
 * [start, end) UTC instants of a Jakarta calendar month. Both pages file a
 * request under the month it was *made* in (what the Date column shows), not
 * under the petty cash period's own month, which lags behind for a store that
 * hasn't been refilled yet. Jakarta is UTC+7 with no DST.
 */
export function jakartaMonthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)); // month index `m` is the month after `month`
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    start: new Date(`${month}-01T00:00:00+07:00`),
    end: new Date(`${nextKey}-01T00:00:00+07:00`),
  };
}

// ─── Requests (spending) ─────────────────────────────────────────────────────

export interface OpsRequestRow {
  id: number;
  /** What the PIC asked for — an estimate, Rupiah. */
  amount: number;
  /** What was really spent; null until PIC 1 records it. */
  actualAmount: number | null;
  description: string;
  categoryName: string | null;
  status: string;
  imageUrl: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  /** When the PIC filed the request (ISO instant). */
  createdAt: string;

  storeId: number;
  storeNo: string;
  storeName: string;
  areaId: number;
  areaName: string;

  submittedById: string;
  submittedByName: string;
}

export interface OpsRequestsResponse {
  success: true;
  month: string;
  scope: 'area' | 'all_areas';
  areaId: number | null;
  data: OpsRequestRow[];
}

// ─── Refills (top-up) ────────────────────────────────────────────────────────

/** One completed spend — a line in a refill's "items used" list. */
export interface RefillItem {
  id: number;
  /** When PIC 1 filed it (ISO instant). */
  createdAt: string;
  categoryName: string | null;
  description: string;
  /** What was really spent. */
  amount: number;
  imageUrl: string | null;
}

export interface OpsRefillRow {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  areaId: number;
  areaName: string;

  requestedAt: string;
  requestedByName: string | null;
  notes: string | null;

  /** Where the request stands — the same words Finance uses (REFILL_STATE_LABEL). */
  state: RefillState;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;

  /** What is left in the store's petty cash, Rupiah. */
  balance: number;
  /** Total of `items`. */
  used: number;
  /** What it takes to bring the store back to the maximum: max − balance. */
  refill: number;
  /** The completed spending behind the refill, oldest first. */
  items: RefillItem[];
  /** When the store's previous refill landed (start of the window); null = since the store started. */
  sinceAt: string | null;
}

export interface OpsRefillsResponse {
  success: true;
  month: string;
  scope: 'area' | 'all_areas';
  areaId: number | null;
  /** The most a store's petty cash holds. */
  maxBalance: number;
  requests: OpsRefillRow[];
}

// ─── Status order / tone ─────────────────────────────────────────────────────

export const REFILL_STATE_ORDER: RefillState[] = ['pending', 'awaiting_finance', 'verified', 'received', 'rejected'];

export const isRefillState = (v: string): v is RefillState => (REFILL_STATE_ORDER as string[]).includes(v);

/** Chip-dot colour per status (OpsChipTabs tones). */
export const TX_STATUS_TONE: Record<TxStatus, 'amber' | 'indigo' | 'emerald' | 'rose'> = {
  pending_ops: 'amber',
  ops_approved: 'indigo',
  completed: 'emerald',
  ops_rejected: 'rose',
};

export const REFILL_STATE_TONE: Record<RefillState, 'amber' | 'slate' | 'indigo' | 'emerald' | 'rose'> = {
  pending: 'amber',
  awaiting_finance: 'slate',
  verified: 'indigo',
  received: 'emerald',
  rejected: 'rose',
};

/** Rows that still need Ops to decide — what "Needs action" sorts to the top. */
export const needsOpsAction = (status: string) => status === 'pending_ops' || status === 'pending';

const txRank = (s: string) => {
  const i = TX_STATUS_ORDER.indexOf(s as TxStatus);
  return i === -1 ? TX_STATUS_ORDER.length : i;
};
const refillRank = (s: RefillState) => REFILL_STATE_ORDER.indexOf(s);

// ─── Search / sort primitives ────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });

/** True when every word of `query` appears somewhere in `parts` (case-insensitive). */
export function matchesQuery(parts: (string | null | undefined)[], query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

const byDateDesc = (a: string, b: string) => new Date(b).getTime() - new Date(a).getTime();

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

// ─── Requests: filter + sort ─────────────────────────────────────────────────

export type RequestSortKey = 'priority' | 'date' | 'store' | 'amount';

export const REQUEST_SORT_OPTIONS: { key: RequestSortKey; label: string }[] = [
  { key: 'priority', label: 'Needs action' },
  { key: 'date', label: 'Date' },
  { key: 'store', label: 'Store' },
  { key: 'amount', label: 'Amount' },
];

/** The direction a key starts in when first picked. */
export function defaultSortDir(key: string): SortDir {
  return key === 'date' || key === 'amount' || key === 'used' || key === 'refill' ? 'desc' : 'asc';
}

export interface RequestFilters {
  query: string;
  /** 'all' or an area id. */
  area: 'all' | number;
  /** 'all' or a category name. */
  category: 'all' | string;
  status: 'all' | TxStatus;
}

/** Everything but the status — so each status chip can show how many rows it would give. */
export function filterRequestsExceptStatus(rows: OpsRequestRow[], f: Omit<RequestFilters, 'status'>): OpsRequestRow[] {
  return rows.filter((r) => {
    if (f.area !== 'all' && r.areaId !== f.area) return false;
    if (f.category !== 'all' && (r.categoryName ?? '') !== f.category) return false;
    return matchesQuery(
      [r.storeNo, r.storeName, r.areaName, r.categoryName, r.description, r.submittedByName],
      f.query,
    );
  });
}

export const requestAmount = (r: OpsRequestRow) => r.actualAmount ?? r.amount;

export function sortRequests(rows: OpsRequestRow[], key: RequestSortKey, dir: SortDir): OpsRequestRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'priority':
        return sign * (txRank(a.status) - txRank(b.status)) || byDateDesc(a.createdAt, b.createdAt);
      case 'date':
        return -sign * byDateDesc(a.createdAt, b.createdAt);
      case 'store':
        return sign * collator.compare(a.storeName, b.storeName) || byDateDesc(a.createdAt, b.createdAt);
      case 'amount':
        return sign * (a.amount - b.amount) || byDateDesc(a.createdAt, b.createdAt);
    }
  });
}

export interface RequestTotals {
  count: number;
  waiting: number;
  waitingAmount: number;
  awaitingActual: number;
  completed: number;
  rejected: number;
  /** Completed requests only, at the actual amount — what really left the cash boxes. */
  used: number;
}

export function totalsOfRequests(rows: OpsRequestRow[]): RequestTotals {
  const t: RequestTotals = { count: rows.length, waiting: 0, waitingAmount: 0, awaitingActual: 0, completed: 0, rejected: 0, used: 0 };
  for (const r of rows) {
    if (r.status === 'pending_ops') {
      t.waiting += 1;
      t.waitingAmount += r.amount;
    } else if (r.status === 'ops_approved') t.awaitingActual += 1;
    else if (r.status === 'completed') {
      t.completed += 1;
      t.used += requestAmount(r);
    } else if (r.status === 'ops_rejected') t.rejected += 1;
  }
  return t;
}

export function countRequestsByStatus(rows: OpsRequestRow[]): Record<TxStatus, number> {
  const out = { pending_ops: 0, ops_approved: 0, completed: 0, ops_rejected: 0 } as Record<TxStatus, number>;
  for (const r of rows) if (isTxStatus(r.status)) out[r.status] += 1;
  return out;
}

// ─── Refills: filter + sort ──────────────────────────────────────────────────

export type RefillSortKey = 'priority' | 'date' | 'store' | 'used' | 'refill';

export const REFILL_SORT_OPTIONS: { key: RefillSortKey; label: string }[] = [
  { key: 'priority', label: 'Needs action' },
  { key: 'date', label: 'Date' },
  { key: 'store', label: 'Store' },
  { key: 'used', label: 'Used' },
  { key: 'refill', label: 'Refill' },
];

export interface RefillFilters {
  query: string;
  area: 'all' | number;
  state: 'all' | RefillState;
}

export function filterRefillsExceptState(rows: OpsRefillRow[], f: Omit<RefillFilters, 'state'>): OpsRefillRow[] {
  return rows.filter((r) => {
    if (f.area !== 'all' && r.areaId !== f.area) return false;
    return matchesQuery([r.storeNo, r.storeName, r.areaName, r.requestedByName, r.notes], f.query);
  });
}

export function sortRefills(rows: OpsRefillRow[], key: RefillSortKey, dir: SortDir): OpsRefillRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'priority':
        return sign * (refillRank(a.state) - refillRank(b.state)) || byDateDesc(a.requestedAt, b.requestedAt);
      case 'date':
        return -sign * byDateDesc(a.requestedAt, b.requestedAt);
      case 'store':
        return sign * collator.compare(a.storeName, b.storeName) || byDateDesc(a.requestedAt, b.requestedAt);
      case 'used':
        return sign * (a.used - b.used) || byDateDesc(a.requestedAt, b.requestedAt);
      case 'refill':
        return sign * (a.refill - b.refill) || byDateDesc(a.requestedAt, b.requestedAt);
    }
  });
}

export interface RefillTotals {
  count: number;
  /** Waiting for Ops to decide. */
  waiting: number;
  waitingAmount: number;
  /** Approved by Ops, cash not confirmed received by the store yet (Finance still to send / verify). */
  inProgress: number;
  inProgressAmount: number;
  /** Cash received by the store. */
  received: number;
  receivedAmount: number;
  rejected: number;
  /** Refill money asked for in total: waiting + in progress + received (rejected ones need none). */
  refillAmount: number;
}

export function totalsOfRefills(rows: OpsRefillRow[]): RefillTotals {
  const t: RefillTotals = {
    count: rows.length,
    waiting: 0,
    waitingAmount: 0,
    inProgress: 0,
    inProgressAmount: 0,
    received: 0,
    receivedAmount: 0,
    rejected: 0,
    refillAmount: 0,
  };

  for (const r of rows) {
    if (r.state === 'rejected') {
      t.rejected += 1;
      continue;
    }
    t.refillAmount += r.refill;
    if (r.state === 'pending') {
      t.waiting += 1;
      t.waitingAmount += r.refill;
    } else if (r.state === 'received') {
      t.received += 1;
      t.receivedAmount += r.refill;
    } else {
      t.inProgress += 1;
      t.inProgressAmount += r.refill;
    }
  }
  return t;
}

export function countRefillsByState(rows: OpsRefillRow[]): Record<RefillState, number> {
  const out = { pending: 0, awaiting_finance: 0, verified: 0, received: 0, rejected: 0 } as Record<RefillState, number>;
  for (const r of rows) out[r.state] += 1;
  return out;
}

// ─── Summary (tab badges) ────────────────────────────────────────────────────

export interface PettyCashPending {
  /** Spending requests waiting for Ops, every month. */
  requests: number;
  /** Refill requests waiting for Ops, every month. */
  refills: number;
}

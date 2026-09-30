// lib/petty-cash-transactions.ts
// Shapes for Finance's Petty Cash Transactions list (client-safe, no DB
// imports) — shared by the page and its API.

import { isIsoDay, todayJakarta } from '@/lib/finance/dates';

/** petty_cash_transactions.status — see lib/db/schema/petty-cash.ts. */
export type TxStatus = 'pending_ops' | 'ops_approved' | 'completed' | 'ops_rejected';

export const TX_STATUS_ORDER: TxStatus[] = ['pending_ops', 'ops_approved', 'completed', 'ops_rejected'];

export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  pending_ops: 'Waiting OPS',
  ops_approved: 'Awaiting actual amount',
  completed: 'Completed',
  ops_rejected: 'Rejected',
};

export const isTxStatus = (v: string): v is TxStatus => (TX_STATUS_ORDER as string[]).includes(v);

export interface TransactionRow {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  categoryName: string | null;
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
}

export interface TransactionStoreOption {
  id: number;
  storeNo: string;
  name: string;
}

/** Numbers for the chosen store + period, regardless of the status filter. */
export interface TransactionSummary {
  count: number;
  /** Completed requests only — the amount actually deducted from balances. */
  totalUsed: number;
  byStatus: Record<TxStatus, number>;
}

export interface TransactionsPage {
  from: string;
  to: string;
  rows: TransactionRow[];
  summary: TransactionSummary;
  stores: TransactionStoreOption[];
  /** Rows matching every filter, status included. */
  matching: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** The filters both the list and its Excel export accept (query string → validated values). */
export interface TransactionQuery {
  from: string;
  to: string;
  storeId: number | null;
  status: TxStatus | null;
  page: number;
}

/** ?from&to[&storeId][&status][&page] — from/to default to this month so far. */
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

  const statusParam = q.get('status');
  if (statusParam && !isTxStatus(statusParam)) return { ok: false, error: 'Invalid status.' };

  return {
    ok: true,
    from,
    to,
    storeId,
    status: statusParam && isTxStatus(statusParam) ? statusParam : null,
    page: Math.max(1, Math.floor(Number(q.get('page'))) || 1),
  };
}

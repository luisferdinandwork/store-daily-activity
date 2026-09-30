// lib/db/utils/petty-cash-transactions.ts
//
// Data behind Finance's Petty Cash Transactions list: every request across all
// stores, filtered by store, period (the day the request was made) and status.
//
// The period is a range of Jakarta calendar days. Requests carry a real
// timestamp (createdAt), so the range is converted to the UTC instants those
// Jakarta days start and end at — independent of the server's timezone.

import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pettyCashTransactions as tx, stores, users } from '@/lib/db/schema';
import { jakartaRangeBounds } from '@/lib/finance/dates';
import {
  TX_STATUS_ORDER,
  isTxStatus,
  type TransactionRow,
  type TransactionsPage,
  type TxStatus,
} from '@/lib/petty-cash-transactions';

export const TX_PAGE_SIZE = 50;

export interface TransactionFilters {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  storeId: number | null;
  status: TxStatus | null;
  page: number;
}

/** Newest first; `limit` omitted = every matching row (the Excel export). */
async function selectTransactionRows(
  where: SQL | undefined,
  page?: { limit: number; offset: number },
): Promise<TransactionRow[]> {
  const query = db
    .select({
      id: tx.id,
      storeId: tx.storeId,
      storeNo: stores.storeNo,
      storeName: stores.name,
      categoryName: tx.categoryName,
      description: tx.description,
      submittedBy: sql<string>`COALESCE(${users.name}, 'Unknown')`,
      amount: tx.amount,
      actualAmount: tx.actualAmount,
      status: tx.status,
      imageUrl: tx.imageUrl,
      rejectionReason: tx.rejectionReason,
      createdAt: tx.createdAt,
    })
    .from(tx)
    .innerJoin(stores, eq(stores.id, tx.storeId))
    .leftJoin(users, eq(users.id, tx.userId))
    .where(where)
    .orderBy(desc(tx.createdAt), desc(tx.id));

  const rows = await (page ? query.limit(page.limit).offset(page.offset) : query);

  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    actualAmount: r.actualAmount == null ? null : Number(r.actualAmount),
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

/** Every request matching the filters (page ignored) — what the Excel export writes. */
export async function getPettyCashTransactionsForExport(
  f: Omit<TransactionFilters, 'page'>,
): Promise<TransactionRow[]> {
  const { start, end } = jakartaRangeBounds(f.from, f.to);
  return selectTransactionRows(
    and(
      gte(tx.createdAt, start),
      lt(tx.createdAt, end),
      f.storeId != null ? eq(tx.storeId, f.storeId) : undefined,
      f.status ? eq(tx.status, f.status) : undefined,
    ),
  );
}

export async function getPettyCashTransactions(f: TransactionFilters): Promise<TransactionsPage> {
  const { start, end } = jakartaRangeBounds(f.from, f.to);

  // Store + period drive the summary; status only narrows the rows below, so
  // the KPI strip keeps showing the whole breakdown while one status is picked.
  const scope = and(
    gte(tx.createdAt, start),
    lt(tx.createdAt, end),
    f.storeId != null ? eq(tx.storeId, f.storeId) : undefined,
  );

  const [storeOptions, statusRows] = await Promise.all([
    db
      .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
      .from(stores)
      .orderBy(stores.storeNo),
    db
      .select({
        status: tx.status,
        count: sql<number>`COUNT(*)::int`,
        // Completed requests are the ones actually deducted (see the monitoring view).
        used: sql<string>`COALESCE(SUM(COALESCE(${tx.actualAmount}, ${tx.amount})), 0)`,
      })
      .from(tx)
      .where(scope)
      .groupBy(tx.status),
  ]);

  const byStatus = Object.fromEntries(TX_STATUS_ORDER.map((s) => [s, 0])) as Record<TxStatus, number>;
  let count = 0;
  let totalUsed = 0;
  for (const r of statusRows) {
    count += r.count;
    if (isTxStatus(r.status)) byStatus[r.status] += r.count;
    if (r.status === 'completed') totalUsed += Number(r.used);
  }

  const matching = f.status ? byStatus[f.status] : count;
  const totalPages = Math.max(1, Math.ceil(matching / TX_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page), totalPages);

  const data =
    matching === 0
      ? []
      : await selectTransactionRows(and(scope, f.status ? eq(tx.status, f.status) : undefined), {
          limit: TX_PAGE_SIZE,
          offset: (page - 1) * TX_PAGE_SIZE,
        });

  return {
    from: f.from,
    to: f.to,
    rows: data,
    summary: { count, totalUsed, byStatus },
    stores: storeOptions,
    matching,
    page,
    pageSize: TX_PAGE_SIZE,
    totalPages,
  };
}

/** A store's code + name, for labelling an export of just that store. */
export async function getStoreOption(storeId: number) {
  const [row] = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  return row ?? null;
}

// lib/db/utils/petty-cash-transactions.ts
//
// Data behind Finance's Petty Cash Transactions list: every request across all
// stores, filtered by period (the day the request was made), store, area,
// category, status, Finance's decision, re-request, receipt photo, amount and a
// free-text search, and sorted by any column.
//
// The period is a range of Jakarta calendar days. Requests carry a real
// timestamp (createdAt), so the range is converted to the UTC instants those
// Jakarta days start and end at — independent of the server's timezone.
//
// Stores that are still getting ready to open have no petty cash and are left
// out of the pickers.

import { and, asc, desc, eq, gte, ilike, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { areas, pettyCashTransactions as tx, stores, users } from '@/lib/db/schema';
import { jakartaRangeBounds } from '@/lib/finance/dates';
import { jakartaDateKey } from '@/lib/day-bucket';
import { pettyCashDescription } from '@/lib/petty-cash-categories';
import { categoryIsCodeSql } from './petty-cash-categories';
import {
  TX_STATUS_ORDER,
  isTxStatus,
  type TransactionQuery,
  type TransactionRow,
  type TransactionsPage,
  type TxSortKey,
  type TxStatus,
} from '@/lib/petty-cash-transactions';

export const TX_PAGE_SIZE = 50;

/** Everything the list filters on — the query minus the page. */
export type TransactionFilters = Omit<TransactionQuery, 'page'>;

// A completed request Finance has decided on carries one of these (lib/petty-cash-review.ts).
const DECIDED = sql.raw(`'needs_fix', 'rejected', 'accepted'`);

/** Escapes LIKE wildcards so a typed `%` or `_` is searched literally. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** "#123" → the request id only; "1.250.000" / "Rp 1250000" / "123" → an id or an amount; anything else → null. */
function numericSearch(q: string): { idOnly: boolean; value: number } | null {
  const idOnly = q.startsWith('#');
  const cleaned = q.replace(/^#/, '').replace(/^rp\s*/i, '').replace(/[.\s]/g, '');
  if (!/^\d{1,12}$/.test(cleaned)) return null;
  return { idOnly, value: Number(cleaned) };
}

/** The amount that counts for a request: what was really spent, else what was asked for. */
const effectiveAmount = sql`COALESCE(${tx.actualAmount}, ${tx.amount})`;

/** The request's IS, from its category. */
const isCode = categoryIsCodeSql(tx.categoryId, tx.categoryName);

/**
 * The WHERE clauses of the filters. `withStatus: false` leaves the status out — the summary counts every status
 * under the other filters, so the status pills keep showing the whole breakdown while one is picked.
 */
function filterWhere(f: TransactionFilters, withStatus: boolean): SQL | undefined {
  const { start, end } = jakartaRangeBounds(f.from, f.to);
  const conditions: (SQL | undefined)[] = [
    gte(tx.createdAt, start),
    lt(tx.createdAt, end),
    f.storeId != null ? eq(tx.storeId, f.storeId) : undefined,
    f.areaId != null ? eq(stores.areaId, f.areaId) : undefined,
    withStatus && f.status ? eq(tx.status, f.status) : undefined,
    f.category ? eq(tx.categoryName, f.category) : undefined,
    f.reRequest ? eq(tx.isReRequest, true) : undefined,
    f.minAmount != null ? sql`${effectiveAmount} >= ${f.minAmount}` : undefined,
    f.maxAmount != null ? sql`${effectiveAmount} <= ${f.maxAmount}` : undefined,
  ];

  if (f.photo === 'with') conditions.push(sql`(${tx.imageUrl} IS NOT NULL AND ${tx.imageUrl} <> '')`);
  if (f.photo === 'without') conditions.push(sql`(${tx.imageUrl} IS NULL OR ${tx.imageUrl} = '')`);

  if (f.review === 'pending') {
    conditions.push(
      sql`(${tx.status} = 'completed' AND (${tx.financeReview} IS NULL OR ${tx.financeReview} NOT IN (${DECIDED})))`,
    );
  } else if (f.review) {
    conditions.push(eq(tx.financeReview, f.review));
  }

  if (f.q) {
    const like = likePattern(f.q);
    const num = numericSearch(f.q);
    conditions.push(
      or(
        ilike(stores.name, like),
        ilike(stores.storeNo, like),
        ilike(tx.description, like),
        ilike(tx.categoryName, like),
        sql`${isCode} ILIKE ${like}`,
        ilike(users.name, like),
        num ? eq(tx.id, num.value) : undefined,
        num && !num.idOnly ? sql`CAST(${tx.amount} AS numeric) = ${num.value}` : undefined,
        num && !num.idOnly ? sql`CAST(${tx.actualAmount} AS numeric) = ${num.value}` : undefined,
      ),
    );
  }

  return and(...conditions);
}

/** ORDER BY for the chosen column; ties (and nulls) fall back to newest first. */
function orderBy(sort: TxSortKey, dir: 'asc' | 'desc'): SQL[] {
  const column: Record<TxSortKey, SQL> = {
    date: sql`${tx.createdAt}`,
    store: sql`${stores.name}`,
    category: sql`${tx.categoryName}`,
    submitter: sql`${users.name}`,
    amount: sql`CAST(${tx.amount} AS numeric)`,
    actual: sql`CAST(${tx.actualAmount} AS numeric)`,
    status: sql`CASE ${tx.status} WHEN 'pending_ops' THEN 0 WHEN 'ops_approved' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END`,
  };
  const direction = dir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');
  return [sql`${column[sort]} ${direction} NULLS LAST`, desc(tx.createdAt), desc(tx.id)];
}

/** `limit` omitted = every matching row (the Excel export). */
async function selectTransactionRows(
  where: SQL | undefined,
  order: SQL[],
  page?: { limit: number; offset: number },
): Promise<TransactionRow[]> {
  const query = db
    .select({
      id: tx.id,
      storeId: tx.storeId,
      storeNo: stores.storeNo,
      storeName: stores.name,
      deptCode: stores.deptCode,
      categoryName: tx.categoryName,
      isCode,
      description: tx.description,
      submittedBy: sql<string>`COALESCE(${users.name}, 'Unknown')`,
      amount: tx.amount,
      actualAmount: tx.actualAmount,
      status: tx.status,
      imageUrl: tx.imageUrl,
      rejectionReason: tx.rejectionReason,
      createdAt: tx.createdAt,
      financeReview: tx.financeReview,
      financeComment: tx.financeComment,
      isReRequest: tx.isReRequest,
      requestDate: tx.requestDate,
    })
    .from(tx)
    .innerJoin(stores, eq(stores.id, tx.storeId))
    .leftJoin(users, eq(users.id, tx.userId))
    .where(where)
    .orderBy(...order);

  const rows = await (page ? query.limit(page.limit).offset(page.offset) : query);

  return rows.map((r) => ({
    ...r,
    description: pettyCashDescription(r.description),
    amount: Number(r.amount),
    actualAmount: r.actualAmount == null ? null : Number(r.actualAmount),
    createdAt: new Date(r.createdAt).toISOString(),
    requestDate: r.requestDate ? jakartaDateKey(r.requestDate) : null,
  }));
}

/** Every request matching the filters (page ignored) — what the Excel export writes. */
export async function getPettyCashTransactionsForExport(f: TransactionFilters): Promise<TransactionRow[]> {
  return selectTransactionRows(filterWhere(f, true), orderBy(f.sort, f.dir));
}

export async function getPettyCashTransactions(f: TransactionQuery): Promise<TransactionsPage> {
  // Every filter except the status drives the summary; the status only narrows the rows below.
  const scope = filterWhere(f, false);

  const [storeOptions, categoryRows, statusRows] = await Promise.all([
    db
      .select({
        id: stores.id,
        storeNo: stores.storeNo,
        name: stores.name,
        areaId: stores.areaId,
        areaName: areas.name,
      })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .where(ne(stores.status, 'ready_to_open'))
      .orderBy(stores.storeNo),
    db
      .selectDistinct({ name: tx.categoryName })
      .from(tx)
      .where(sql`${tx.categoryName} IS NOT NULL AND ${tx.categoryName} <> ''`)
      .orderBy(asc(tx.categoryName)),
    db
      .select({
        status: tx.status,
        count: sql<number>`COUNT(*)::int`,
        // "Used" = what Finance accepted (Diterima), at the actual amount — the same rule as Monitoring and the Report.
        used: sql<string>`COALESCE(SUM(${effectiveAmount}) FILTER (WHERE ${tx.financeReview} = 'accepted'), 0)`,
        // The table's Total line: Diajukan and Aktual added up.
        amountSum: sql<string>`COALESCE(SUM(CAST(${tx.amount} AS numeric)), 0)`,
        actualSum: sql<string>`COALESCE(SUM(CAST(${tx.actualAmount} AS numeric)), 0)`,
        reRequests: sql<number>`COUNT(*) FILTER (WHERE ${tx.isReRequest})::int`,
        pendingFinance: sql<number>`COUNT(*) FILTER (WHERE ${tx.status} = 'completed' AND (${tx.financeReview} IS NULL OR ${tx.financeReview} NOT IN (${DECIDED})))::int`,
      })
      .from(tx)
      .innerJoin(stores, eq(stores.id, tx.storeId))
      .leftJoin(users, eq(users.id, tx.userId))
      .where(scope)
      .groupBy(tx.status),
  ]);

  const byStatus = Object.fromEntries(TX_STATUS_ORDER.map((s) => [s, 0])) as Record<TxStatus, number>;
  // Sums of the rows the list shows — every filter, the status included.
  const totals = { amount: 0, actual: 0 };
  let count = 0;
  let totalUsed = 0;
  let reRequestCount = 0;
  let pendingFinance = 0;
  for (const r of statusRows) {
    count += r.count;
    reRequestCount += r.reRequests;
    pendingFinance += r.pendingFinance;
    if (isTxStatus(r.status)) byStatus[r.status] += r.count;
    if (r.status === 'completed') totalUsed += Number(r.used);
    if (!f.status || r.status === f.status) {
      totals.amount += Number(r.amountSum);
      totals.actual += Number(r.actualSum);
    }
  }

  const matching = f.status ? byStatus[f.status] : count;
  const totalPages = Math.max(1, Math.ceil(matching / TX_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page), totalPages);

  const data =
    matching === 0
      ? []
      : await selectTransactionRows(filterWhere(f, true), orderBy(f.sort, f.dir), {
          limit: TX_PAGE_SIZE,
          offset: (page - 1) * TX_PAGE_SIZE,
        });

  const areaOptions = [...new Map(storeOptions.map((s) => [s.areaId, s.areaName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    from: f.from,
    to: f.to,
    rows: data,
    summary: { count, totalUsed, byStatus, pendingFinance, reRequestCount },
    stores: storeOptions.map(({ id, storeNo, name, areaId }) => ({ id, storeNo, name, areaId })),
    areas: areaOptions,
    categories: categoryRows.flatMap((c) => (c.name ? [c.name] : [])),
    matching,
    totals: { amount: Math.round(totals.amount), actual: Math.round(totals.actual) },
    page,
    pageSize: TX_PAGE_SIZE,
    totalPages,
  };
}

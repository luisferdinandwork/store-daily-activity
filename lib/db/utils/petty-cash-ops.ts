// lib/db/utils/petty-cash-ops.ts
//
// Data behind Ops' Petty Cash pages (Requests + Refills) and their tab badges.
//
// A month here is the Jakarta calendar month a request was *filed* in — what the
// Date column shows. It is deliberately not petty_cash_transactions.year_month,
// which is the petty cash PERIOD's month and lags behind the calendar for a
// store that hasn't been refilled yet (see petty-cash-period.ts). Requests still
// waiting on Ops are listed whatever their month, so the queue never hides.
//
// Refills: every request is shown with what the store used. The spending behind
// a refill is the petty cash "envelope" the store was drawing from when it asked
// — its period. A refill that lands (both proof photos in) starts the next
// envelope: petty-cash-refill.ts tops up the month AFTER the request's month. So
// the envelope of a request is the period that follows the store's last
// received refill (or the store's first period if it never had one), and the
// refill it needs is max − what is left there.

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  PETTY_CASH_MAX_BALANCE,
  areas,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashTransactions,
  stores,
  users,
} from '@/lib/db/schema';
import {
  jakartaMonthBounds,
  type OpsRefillRow,
  type OpsRequestRow,
  type PettyCashPending,
  type RefillItem,
} from '@/lib/ops-petty-cash';
import { refillStateOf } from '@/lib/petty-cash-report';
import { addMonths } from './petty-cash-period';

const rupiah = (v: string | number | null | undefined) => Math.round(Number(v ?? 0));

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

// ─── Requests ────────────────────────────────────────────────────────────────

/** Spending requests filed in `month` (Jakarta) plus every one still waiting on Ops. */
export async function getOpsRequestRows(opts: { areaId: number | null; month: string }): Promise<OpsRequestRow[]> {
  const { start, end } = jakartaMonthBounds(opts.month);
  const tx = pettyCashTransactions;

  const rows = await db
    .select({
      id: tx.id,
      amount: tx.amount,
      actualAmount: tx.actualAmount,
      description: tx.description,
      categoryName: tx.categoryName,
      status: tx.status,
      imageUrl: tx.imageUrl,
      approvedAt: tx.approvedAt,
      rejectedAt: tx.rejectedAt,
      rejectionReason: tx.rejectionReason,
      createdAt: tx.createdAt,

      storeId: stores.id,
      storeNo: stores.storeNo,
      storeName: stores.name,
      areaId: areas.id,
      areaName: areas.name,

      submittedById: users.id,
      submittedByName: users.name,
    })
    .from(tx)
    .innerJoin(stores, eq(stores.id, tx.storeId))
    .innerJoin(areas, eq(areas.id, stores.areaId))
    .innerJoin(users, eq(users.id, tx.userId))
    .where(
      and(
        opts.areaId != null ? eq(stores.areaId, opts.areaId) : undefined,
        or(and(gte(tx.createdAt, start), lt(tx.createdAt, end)), eq(tx.status, 'pending_ops')),
      ),
    )
    .orderBy(desc(tx.createdAt), desc(tx.id));

  return rows.map((r) => ({
    id: r.id,
    amount: rupiah(r.amount),
    actualAmount: r.actualAmount == null ? null : rupiah(r.actualAmount),
    description: r.description,
    categoryName: r.categoryName,
    status: r.status,
    imageUrl: r.imageUrl,
    approvedAt: iso(r.approvedAt),
    rejectedAt: iso(r.rejectedAt),
    rejectionReason: r.rejectionReason,
    createdAt: new Date(r.createdAt).toISOString(),

    storeId: r.storeId,
    storeNo: r.storeNo,
    storeName: r.storeName,
    areaId: r.areaId,
    areaName: r.areaName,

    submittedById: r.submittedById,
    submittedByName: r.submittedByName,
  }));
}

// ─── Refills ─────────────────────────────────────────────────────────────────

export interface EnvelopePeriod {
  yearMonth: string;
}

export interface ReceivedRefill {
  /** The month the request was filed in (the next period is the one it topped up). */
  yearMonth: string;
  /** When both proof photos were in — the moment the new envelope started. */
  receivedAt: Date;
}

/**
 * The petty cash period a refill request was filed against, and when that
 * envelope began.
 *
 * The envelope in use at `requestedAt` is the one started by the store's latest
 * refill received before then — the period after that refill's month — or the
 * store's very first period if none had landed yet. If that period is somehow
 * missing, the store's latest one is the closest guess.
 */
export function envelopeFor<P extends EnvelopePeriod>(
  requestedAt: Date,
  periods: P[],
  received: ReceivedRefill[],
): { period: P | null; since: Date | null } {
  const sorted = [...periods].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  const prev =
    received
      .filter((r) => r.receivedAt.getTime() <= requestedAt.getTime())
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] ?? null;

  const wanted = prev ? addMonths(prev.yearMonth, 1) : null;
  const period = (wanted ? sorted.find((p) => p.yearMonth === wanted) : sorted[0]) ?? sorted[sorted.length - 1] ?? null;

  return { period, since: prev?.receivedAt ?? null };
}

/**
 * Refill requests filed in `month` (Jakarta) plus every one still waiting on
 * Ops, each with the balance left, what was used since the store's last refill,
 * the refill that takes it back to the maximum, and the items behind it.
 */
export async function getOpsRefillRows(opts: { areaId: number | null; month: string }): Promise<OpsRefillRow[]> {
  const { start, end } = jakartaMonthBounds(opts.month);
  const req = pettyCashRefillRequests;

  const requestRows = await db
    .select({
      request: req,
      storeNo: stores.storeNo,
      storeName: stores.name,
      areaId: areas.id,
      areaName: areas.name,
      requestedByName: users.name,
    })
    .from(req)
    .innerJoin(stores, eq(stores.id, req.storeId))
    .innerJoin(areas, eq(areas.id, stores.areaId))
    .leftJoin(users, eq(users.id, req.requestedBy))
    .where(
      and(
        opts.areaId != null ? eq(stores.areaId, opts.areaId) : undefined,
        or(and(gte(req.requestedAt, start), lt(req.requestedAt, end)), eq(req.status, 'pending')),
      ),
    )
    .orderBy(desc(req.requestedAt), desc(req.id));

  if (requestRows.length === 0) return [];

  const storeIds = [...new Set(requestRows.map((r) => r.request.storeId))];

  // Every period and every received refill of these stores — the chain that says
  // which envelope each request was drawn from (not just the ones in `month`).
  const [periodRows, receivedRows] = await Promise.all([
    db
      .select({
        storeId: pettyCashPeriods.storeId,
        yearMonth: pettyCashPeriods.yearMonth,
        currentBalance: pettyCashPeriods.currentBalance,
        closingBalance: pettyCashPeriods.closingBalance,
      })
      .from(pettyCashPeriods)
      .where(inArray(pettyCashPeriods.storeId, storeIds)),
    db
      .select({
        storeId: req.storeId,
        yearMonth: req.yearMonth,
        requestedAt: req.requestedAt,
        approvedAt: req.approvedAt,
        proofUploadedAt: req.proofUploadedAt,
      })
      .from(req)
      .where(and(inArray(req.storeId, storeIds), eq(req.status, 'approved'), isNotNull(req.balanceAfter))),
  ]);

  const periodsByStore = new Map<number, typeof periodRows>();
  for (const p of periodRows) {
    const list = periodsByStore.get(p.storeId);
    if (list) list.push(p);
    else periodsByStore.set(p.storeId, [p]);
  }

  const receivedByStore = new Map<number, ReceivedRefill[]>();
  for (const r of receivedRows) {
    const entry: ReceivedRefill = {
      yearMonth: r.yearMonth,
      receivedAt: r.proofUploadedAt ?? r.approvedAt ?? r.requestedAt,
    };
    const list = receivedByStore.get(r.storeId);
    if (list) list.push(entry);
    else receivedByStore.set(r.storeId, [entry]);
  }

  // Pair each request with its envelope, then fetch the completed spending of
  // exactly those (store, month) envelopes in one query.
  const resolved = requestRows.map((row) => ({
    row,
    ...envelopeFor(row.request.requestedAt, periodsByStore.get(row.request.storeId) ?? [], receivedByStore.get(row.request.storeId) ?? []),
  }));

  const months = [...new Set(resolved.flatMap((r) => (r.period ? [r.period.yearMonth] : [])))];

  const itemsByEnvelope = new Map<string, RefillItem[]>();
  if (months.length > 0) {
    const tx = pettyCashTransactions;
    const txRows = await db
      .select({
        id: tx.id,
        storeId: tx.storeId,
        yearMonth: tx.yearMonth,
        categoryName: tx.categoryName,
        description: tx.description,
        amount: tx.amount,
        actualAmount: tx.actualAmount,
        imageUrl: tx.imageUrl,
        createdAt: tx.createdAt,
      })
      .from(tx)
      // Only `completed` ones have actually been deducted from the balance.
      .where(and(inArray(tx.storeId, storeIds), inArray(tx.yearMonth, months), eq(tx.status, 'completed')))
      .orderBy(asc(tx.createdAt), asc(tx.id));

    for (const t of txRows) {
      const key = `${t.storeId}|${t.yearMonth}`;
      const item: RefillItem = {
        id: t.id,
        createdAt: new Date(t.createdAt).toISOString(),
        categoryName: t.categoryName,
        description: t.description,
        amount: rupiah(t.actualAmount ?? t.amount),
        imageUrl: t.imageUrl,
      };
      const list = itemsByEnvelope.get(key);
      if (list) list.push(item);
      else itemsByEnvelope.set(key, [item]);
    }
  }

  return resolved.map(({ row, period, since }): OpsRefillRow => {
    const r = row.request;
    const envelopeItems = period ? (itemsByEnvelope.get(`${r.storeId}|${period.yearMonth}`) ?? []) : [];

    // A rejected request is shown as it stood when Ops turned it down — what the
    // store had used by then — because the spending after that belongs to its next
    // request. Every other request is live: Finance sends what the cash box needs
    // at the time, and a received refill's envelope no longer moves anyway.
    const rejectedAt = r.status === 'rejected' ? new Date(r.rejectedAt ?? r.requestedAt) : null;
    const items = rejectedAt
      ? envelopeItems.filter((i) => new Date(i.createdAt).getTime() <= rejectedAt.getTime())
      : envelopeItems;
    const used = items.reduce((sum, i) => sum + i.amount, 0);

    // What is left in that envelope; a store with no petty cash history falls
    // back to the balance the request itself recorded.
    const balance = rejectedAt
      ? Math.max(0, PETTY_CASH_MAX_BALANCE - used)
      : period
        ? rupiah(period.closingBalance ?? period.currentBalance)
        : r.balanceBefore != null
          ? rupiah(r.balanceBefore)
          : PETTY_CASH_MAX_BALANCE;

    return {
      id: r.id,
      storeId: r.storeId,
      storeNo: row.storeNo,
      storeName: row.storeName,
      areaId: row.areaId,
      areaName: row.areaName,

      requestedAt: new Date(r.requestedAt).toISOString(),
      requestedByName: row.requestedByName,
      notes: r.notes,

      state: refillStateOf(r),
      approvedAt: iso(r.approvedAt),
      rejectedAt: iso(r.rejectedAt),
      rejectionReason: r.rejectionReason,

      balance,
      used,
      refill: Math.max(0, PETTY_CASH_MAX_BALANCE - balance),
      items,
      sinceAt: iso(since),
    };
  });
}

// ─── Tab badges ──────────────────────────────────────────────────────────────

/** Everything waiting on Ops right now, any month — the count on each tab. */
export async function countPendingForOps(areaId: number | null): Promise<PettyCashPending> {
  const inArea = areaId != null ? eq(stores.areaId, areaId) : undefined;

  const [[requests], [refills]] = await Promise.all([
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(pettyCashTransactions)
      .innerJoin(stores, eq(stores.id, pettyCashTransactions.storeId))
      .where(and(eq(pettyCashTransactions.status, 'pending_ops'), inArea)),
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(pettyCashRefillRequests)
      .innerJoin(stores, eq(stores.id, pettyCashRefillRequests.storeId))
      .where(and(eq(pettyCashRefillRequests.status, 'pending'), inArea)),
  ]);

  return { requests: requests?.n ?? 0, refills: refills?.n ?? 0 };
}

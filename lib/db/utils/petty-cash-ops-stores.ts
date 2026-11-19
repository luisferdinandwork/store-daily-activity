// lib/db/utils/petty-cash-ops-stores.ts
//
// Data behind Ops · Petty Cash · Stores (/ops/petty-cash/stores): every store in the Ops user's scope with where its
// petty cash stands right now. Shapes + view logic: lib/ops-petty-cash-stores.ts.
//
// READ-ONLY on purpose. The employee side moves a store to its next period on first access (getActivePeriod →
// rollForward, which writes); a list Ops opens many times a day must not do that for 50 stores. So the period in
// use is worked out the same way without writing (`usageMonthOf`), and a period that hasn't been created yet reads
// as a fresh Rp 1.000.000. The cash PIC 1 can spend mirrors getSpendable() (petty-cash-refill.ts) on rows read
// in one go — see `cashOwed` / `cashReceivedWithin` below, which follow getRefillOutstanding /
// getRefillReceivedWithin line for line. Change them together.

import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  PETTY_CASH_MAX_BALANCE,
  areas,
  employeeTypes,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashRefills,
  pettyCashTransactions,
  stores,
  users,
  type PettyCashPeriod,
} from '@/lib/db/schema';
import { jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import { pettyCashDescription } from '@/lib/petty-cash-categories';
import {
  REFILL_DEADLINE_FIRST_PERIOD,
  addMonths,
  deadlineStatus,
  isRefillLate,
  pickRefillPeriod,
  refillRequiredFirst,
  type RefillCandidate,
} from '@/lib/petty-cash-period';
import { refillStateOf } from '@/lib/petty-cash-report';
import type {
  PettyCashStoreRow,
  StoreDetailRefill,
  StoreDetailRequest,
  StoreRefill,
} from '@/lib/ops-petty-cash-stores';
import { countsAsUsed } from './petty-cash-used';
import { usageMonthOf } from './petty-cash-period';
import { getHiddenStores, notHiddenStore } from '@/lib/db/utils/it-only-stores';

/** From this many days before the 15th the Refill of the period in use shows as due (the employee app's reminder). */
const DUE_SOON_DAYS = 5;

const rupiah = (v: string | number | null | undefined) => Math.round(Number(v ?? 0));
const MAX = PETTY_CASH_MAX_BALANCE;

type RefillRequestRow = typeof pettyCashRefillRequests.$inferSelect;

/** Newest first — the order getRefillOutstanding & co. pick "the latest" by. */
const newestFirst = (a: RefillRequestRow, b: RefillRequestRow) =>
  b.requestedAt.getTime() - a.requestedAt.getTime() || b.id - a.id;

// ─── The cash in the box (mirrors petty-cash-refill.ts) ──────────────────────

interface StoreLedger {
  periods: PettyCashPeriod[];
  /** Every refill request of the store, newest first. */
  requests: RefillRequestRow[];
  /** Months Finance closed itself (the old month-end `petty_cash_refills`). */
  legacyMonths: Set<string>;
}

/** getRefillOutstanding(storeId, periodMonth) on prefetched rows: the previous period's Refill not received yet. */
export function cashOwed(ledger: StoreLedger, periodMonth: string): number {
  const prev = addMonths(periodMonth, -1);
  const request = ledger.requests.find((r) => r.yearMonth === prev) ?? null;

  if (request?.balanceAfter) return 0;
  if (request?.transferAmount != null) return Math.max(0, rupiah(request.transferAmount));

  const previous = ledger.periods.find((p) => p.yearMonth === prev) ?? null;

  if (!request) {
    if (!previous || prev < REFILL_DEADLINE_FIRST_PERIOD) return 0;
    if (ledger.legacyMonths.has(prev)) return 0;
  }

  const left = previous ? Number(previous.currentBalance) : Number(request?.balanceBefore ?? MAX);
  return Math.max(0, Math.round(MAX - left));
}

/** getRefillReceivedWithin(storeId, periodMonth) on prefetched rows: this period's own Refill once received. */
export function cashReceivedWithin(ledger: StoreLedger, periodMonth: string): number {
  const request = ledger.requests.find(
    (r) => r.yearMonth === periodMonth && r.status === 'approved' && r.balanceAfter != null,
  );
  return request?.transferAmount != null ? Math.max(0, rupiah(request.transferAmount)) : 0;
}

/** The latest month that has its Refill (latestRefilledMonth): a request not turned down by OPS, or a legacy close. */
function settledThrough(ledger: StoreLedger): string | null {
  const months = [
    ...ledger.requests.filter((r) => r.status !== 'rejected').map((r) => r.yearMonth),
    ...ledger.legacyMonths,
  ].sort();
  return months.pop() ?? null;
}

/** What the store's Refill column says. */
function refillOf(ledger: StoreLedger, usageMonth: string, today: string): StoreRefill {
  const amountOf = (r: RefillRequestRow) =>
    r.transferAmount != null ? rupiah(r.transferAmount) : Math.max(0, MAX - rupiah(r.balanceBefore ?? MAX));

  // On its way (getLiveRefillRequest): waiting on OPS, or approved and not received yet.
  const live = ledger.requests.find((r) => r.status === 'pending' || (r.status === 'approved' && r.balanceAfter == null));
  if (live) {
    return {
      kind: 'live',
      id: live.id,
      month: live.yearMonth,
      state: refillStateOf(live),
      amount: amountOf(live),
      requestedAt: live.requestedAt.toISOString(),
      late: isRefillLate(live.yearMonth, jakartaDateKey(live.requestedAt)),
    };
  }

  // Nothing on its way: which period would a Refill sent now settle (resolveSettlePeriod → pickRefillPeriod)?
  const settled = new Set([
    ...ledger.requests.filter((r) => r.status !== 'rejected').map((r) => r.yearMonth),
    ...ledger.legacyMonths,
  ]);
  const candidates: RefillCandidate[] = ledger.periods.map((p) => ({
    month: p.yearMonth,
    balance: Number(p.currentBalance),
    settled: settled.has(p.yearMonth),
  }));
  const settle = pickRefillPeriod(candidates, usageMonth);
  const settleBalance = (month: string) =>
    Number(ledger.periods.find((p) => p.yearMonth === month)?.currentBalance ?? MAX);

  const due = refillRequiredFirst(settle, usageMonth);
  if (due) return { kind: 'overdue', month: due, amount: Math.max(0, Math.round(MAX - settleBalance(due))) };

  if (settle === usageMonth) {
    const status = deadlineStatus(usageMonth, today);
    if (status.applies && status.daysLeft <= DUE_SOON_DAYS) {
      return {
        kind: 'due_soon',
        month: settle,
        amount: Math.max(0, Math.round(MAX - settleBalance(settle))),
        daysLeft: status.daysLeft,
      };
    }
  }

  const last = ledger.requests[0];
  if (last) {
    return {
      kind: 'last',
      id: last.id,
      month: last.yearMonth,
      state: refillStateOf(last),
      amount: amountOf(last),
      requestedAt: last.requestedAt.toISOString(),
    };
  }
  return { kind: 'none' };
}

// ─── Store list ──────────────────────────────────────────────────────────────

interface StoreBase {
  id: number;
  storeNo: string;
  name: string;
  areaId: number;
  areaName: string;
  status: string;
}

async function loadStores(where: ReturnType<typeof and>): Promise<StoreBase[]> {
  // IT-only test stores (DUMMY…) are hidden from non-IT viewers (list + detail).
  const hidden = await getHiddenStores();
  return db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
      areaId: areas.id,
      areaName: areas.name,
      status: stores.status,
    })
    .from(stores)
    .innerJoin(areas, eq(areas.id, stores.areaId))
    // A store still getting ready to open has no petty cash yet (same as Finance's tab).
    .where(and(ne(stores.status, 'ready_to_open'), where, notHiddenStore(stores.id, hidden.storeIds)))
    .orderBy(stores.name);
}

/** Everything the rows are built from, for a set of stores, in a handful of queries. */
async function buildRows(storeRows: StoreBase[], today: string): Promise<PettyCashStoreRow[]> {
  if (storeRows.length === 0) return [];
  const storeIds = storeRows.map((s) => s.id);
  const tx = pettyCashTransactions;

  const [periodRows, requestRows, legacyRows, pic1Rows, lastRows] = await Promise.all([
    db.select().from(pettyCashPeriods).where(inArray(pettyCashPeriods.storeId, storeIds)),
    db.select().from(pettyCashRefillRequests).where(inArray(pettyCashRefillRequests.storeId, storeIds)),
    db
      .select({ storeId: pettyCashRefills.storeId, yearMonth: pettyCashRefills.yearMonth })
      .from(pettyCashRefills)
      .where(inArray(pettyCashRefills.storeId, storeIds)),
    db
      .select({ storeId: users.homeStoreId, id: users.id, name: users.name, nik: users.nik })
      .from(users)
      .innerJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
      .where(
        and(
          inArray(users.homeStoreId, storeIds),
          eq(employeeTypes.code, 'pic_1'),
          eq(users.isActive, true),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.name),
    db
      // `.mapWith(column)`: a raw MAX() comes back from pg as an unparsed "YYYY-MM-DD HH:MM:SS" string; decoding it
      // with the column's own rule (UTC) keeps it the same instant as every other createdAt, whatever the server's TZ.
      .select({ storeId: tx.storeId, at: sql<Date | null>`MAX(${tx.createdAt})`.mapWith(tx.createdAt) })
      .from(tx)
      .where(inArray(tx.storeId, storeIds))
      .groupBy(tx.storeId),
  ]);

  const ledgers = new Map<number, StoreLedger>(
    storeIds.map((id) => [id, { periods: [], requests: [], legacyMonths: new Set<string>() }]),
  );
  for (const p of periodRows) ledgers.get(p.storeId)?.periods.push(p);
  for (const r of requestRows) ledgers.get(r.storeId)?.requests.push(r);
  for (const r of legacyRows) ledgers.get(r.storeId)?.legacyMonths.add(r.yearMonth);
  for (const l of ledgers.values()) l.requests.sort(newestFirst);

  const usageByStore = new Map<number, string>();
  for (const [id, l] of ledgers) usageByStore.set(id, usageMonthOf(l.periods, today, settledThrough(l)));

  // What each store has open (any period) and used in its period in use — one grouped query.
  const months = [...new Set(usageByStore.values())];
  const counts = await db
    .select({
      storeId: tx.storeId,
      yearMonth: tx.yearMonth,
      waitingOps: sql<number>`COUNT(*) FILTER (WHERE ${tx.status} = 'pending_ops')::int`,
      awaitingActual: sql<number>`COUNT(*) FILTER (WHERE ${tx.status} = 'ops_approved')::int`,
      fixing: sql<number>`COUNT(*) FILTER (WHERE ${tx.status} = 'draft')::int`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${tx.status} = 'completed')::int`,
      used: sql<string>`COALESCE(SUM(COALESCE(${tx.actualAmount}, ${tx.amount})) FILTER (WHERE ${tx.status} = 'completed' AND ${countsAsUsed(tx.financeReview)}), 0)`,
    })
    .from(tx)
    .where(
      and(
        inArray(tx.storeId, storeIds),
        or(inArray(tx.yearMonth, months), inArray(tx.status, ['pending_ops', 'ops_approved', 'draft'])),
      ),
    )
    .groupBy(tx.storeId, tx.yearMonth);

  const pic1ByStore = new Map<number, PettyCashStoreRow['pic1']>();
  for (const p of pic1Rows) {
    if (p.storeId == null) continue;
    const list = pic1ByStore.get(p.storeId) ?? [];
    list.push({ id: p.id, name: p.name, nik: p.nik });
    pic1ByStore.set(p.storeId, list);
  }
  const lastByStore = new Map(lastRows.map((r) => [r.storeId, r.at]));

  return storeRows.map((s): PettyCashStoreRow => {
    const ledger = ledgers.get(s.id)!;
    const usageMonth = usageByStore.get(s.id)!;
    const period = ledger.periods.find((p) => p.yearMonth === usageMonth);
    // Not created yet = the store hasn't been opened since its period changed: it starts at the maximum.
    const ledgerBalance = period ? rupiah(period.currentBalance) : MAX;
    const owed = cashOwed(ledger, usageMonth);
    const received = cashReceivedWithin(ledger, usageMonth);

    let waitingOps = 0;
    let awaitingActual = 0;
    let fixing = 0;
    let completedCount = 0;
    let used = 0;
    for (const c of counts) {
      if (c.storeId !== s.id) continue;
      waitingOps += c.waitingOps;
      awaitingActual += c.awaitingActual;
      fixing += c.fixing;
      if (c.yearMonth === usageMonth) {
        completedCount += c.completed;
        used += rupiah(c.used);
      }
    }

    const last = lastByStore.get(s.id);

    return {
      storeId: s.id,
      storeNo: s.storeNo,
      storeName: s.name,
      areaId: s.areaId,
      areaName: s.areaName,
      storeStatus: s.status === 'close' ? 'close' : 'active',
      pic1: pic1ByStore.get(s.id) ?? [],
      periodMonth: usageMonth,
      ledgerBalance,
      spendable: Math.max(0, ledgerBalance + received - owed),
      owed,
      used,
      completedCount,
      waitingOps,
      awaitingActual,
      fixing,
      refill: refillOf(ledger, usageMonth, today),
      lastRequestAt: last ? new Date(last).toISOString() : null,
    };
  });
}

/** Every store in scope (`areaId` null = all areas), as Ops' Stores page lists them. */
export async function getOpsPettyCashStores(opts: {
  areaId: number | null;
  today?: string;
}): Promise<PettyCashStoreRow[]> {
  const storeRows = await loadStores(opts.areaId != null ? eq(stores.areaId, opts.areaId) : undefined);
  return buildRows(storeRows, opts.today ?? jakartaTodayKey());
}

// ─── One store (the detail slide-over) ───────────────────────────────────────

/** How many requests / refills the slide-over lists at most. */
const DETAIL_REQUEST_LIMIT = 200;
const DETAIL_REFILL_LIMIT = 8;

export async function getOpsPettyCashStoreDetail(opts: {
  storeId: number;
  areaId: number | null;
  today?: string;
}): Promise<{ store: PettyCashStoreRow; requests: StoreDetailRequest[]; refills: StoreDetailRefill[] } | null> {
  const storeRows = await loadStores(
    and(eq(stores.id, opts.storeId), opts.areaId != null ? eq(stores.areaId, opts.areaId) : undefined),
  );
  if (storeRows.length === 0) return null;

  const [store] = await buildRows(storeRows, opts.today ?? jakartaTodayKey());
  const prevMonth = addMonths(store.periodMonth, -1);
  const tx = pettyCashTransactions;
  const req = pettyCashRefillRequests;

  const [requestRows, refillRows] = await Promise.all([
    db
      .select({
        id: tx.id,
        createdAt: tx.createdAt,
        submittedByName: users.name,
        categoryName: tx.categoryName,
        description: tx.description,
        amount: tx.amount,
        actualAmount: tx.actualAmount,
        status: tx.status,
        financeReview: tx.financeReview,
        isReRequest: tx.isReRequest,
        periodMonth: tx.yearMonth,
        imageUrl: tx.imageUrl,
      })
      .from(tx)
      .innerJoin(users, eq(users.id, tx.userId))
      .where(
        and(
          eq(tx.storeId, opts.storeId),
          or(
            inArray(tx.yearMonth, [store.periodMonth, prevMonth]),
            inArray(tx.status, ['pending_ops', 'ops_approved', 'draft']),
          ),
        ),
      )
      .orderBy(desc(tx.createdAt), desc(tx.id))
      .limit(DETAIL_REQUEST_LIMIT),
    db
      .select({ request: req, requestedByName: users.name })
      .from(req)
      .leftJoin(users, eq(users.id, req.requestedBy))
      .where(eq(req.storeId, opts.storeId))
      .orderBy(desc(req.requestedAt), desc(req.id))
      .limit(DETAIL_REFILL_LIMIT),
  ]);

  return {
    store,
    requests: requestRows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.createdAt).toISOString(),
      submittedByName: r.submittedByName,
      categoryName: r.categoryName,
      description: pettyCashDescription(r.description),
      amount: rupiah(r.amount),
      actualAmount: r.actualAmount == null ? null : rupiah(r.actualAmount),
      status: r.status,
      financeReview: r.financeReview,
      isReRequest: r.isReRequest,
      periodMonth: r.periodMonth,
      imageUrl: r.imageUrl,
    })),
    refills: refillRows.map(({ request: r, requestedByName }) => ({
      id: r.id,
      month: r.yearMonth,
      requestedAt: r.requestedAt.toISOString(),
      requestedByName,
      state: refillStateOf(r),
      amount: r.transferAmount != null ? rupiah(r.transferAmount) : Math.max(0, MAX - rupiah(r.balanceBefore ?? MAX)),
      late: isRefillLate(r.yearMonth, jakartaDateKey(r.requestedAt)),
    })),
  };
}

// lib/db/utils/petty-cash-reset.ts
//
// IT "Reset Petty Cash" (/it/petty-cash-reset) — wipes the petty cash ACTIVITY of one store, for ONE period or
// for ALL of them (shapes + wording: lib/petty-cash-reset.ts). IT-only; the API enforces it.
//
//   ONE PERIOD    deleted: the requests filed under that period, the refill request(s) that settle it, the legacy
//                 month-end refill of that month, and the notifications about them.
//                 kept:    the period row itself — same status, so the chain of periods (a closed one always has
//                 its successor) never breaks — put back to Rp 1.000.000 with no closing balance.
//   ALL PERIODS   deleted: everything above for the whole store, and its period rows. An ACTIVE store then gets
//                 one fresh open period for this Jakarta month at Rp 1.000.000 (stores.petty_cash_balance, the
//                 legacy column, follows); a ready_to_open / close store gets none — activation provisions it.
//
// Not touched: categories, users, the store, and the receipt / proof photos in object storage (petty cash photos
// are never deleted — they just stop being referenced; same as IT's single-request delete and the reset scripts).
//
// Everything runs in ONE transaction that first locks the store's periods (so a PIC filing a request at that
// moment waits) and rolls back unless the result is exactly what was promised. The preview is plain counting —
// it runs the same selection and changes nothing. `exportResetBackup` hands IT the rows as snake_case JSON (the
// same shape as the reset scripts' backups) before they go.

import { and, count, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { db } from '@/lib/db';
import {
  notifications,
  pettyCashPeriods,
  pettyCashRefillRequests,
  pettyCashRefills,
  pettyCashTransactions,
  stores,
  users,
  type PettyCashPeriod,
} from '@/lib/db/schema';
import { PETTY_CASH_MAX_BALANCE } from '@/lib/db/schema/petty-cash';
import { jakartaYearMonth } from '@/lib/day-bucket';
import { refillStateOf } from '@/lib/petty-cash-report';
import type { PeriodStatus } from '@/lib/petty-cash-period';
import type {
  ResetOverview,
  ResetPeriodRow,
  ResetPreview,
  ResetResult,
  ResetScope,
  ResetStoreRow,
} from '@/lib/petty-cash-reset';
import type { DbExecutor } from './petty-cash-period';

export type ResetOutcome<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: 400 | 404 };

const MAX = String(PETTY_CASH_MAX_BALANCE);
const NO_WAIT = ['pending_ops', 'ops_approved'];

type StoreInfo = ResetPreview['store'];

interface Resolved {
  store: StoreInfo;
  scope: ResetScope;
  /** The period a single-period reset is about (null for "all"). */
  period: PettyCashPeriod | null;
  txWhere: SQL;
  refillWhere: SQL;
  legacyWhere: SQL;
}

const must = (cond: SQL | undefined): SQL => {
  if (!cond) throw new Error('Empty reset condition.');
  return cond;
};

async function resolve(exec: DbExecutor, storeId: number, scope: ResetScope): Promise<ResetOutcome<Resolved>> {
  const [store] = await exec
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, status: stores.status })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return { success: false, error: 'Store not found.', status: 404 };

  if (scope.type === 'all') {
    return {
      success: true,
      data: {
        store,
        scope,
        period: null,
        txWhere: eq(pettyCashTransactions.storeId, storeId),
        refillWhere: eq(pettyCashRefillRequests.storeId, storeId),
        legacyWhere: eq(pettyCashRefills.storeId, storeId),
      },
    };
  }

  const [period] = await exec
    .select()
    .from(pettyCashPeriods)
    .where(and(eq(pettyCashPeriods.storeId, storeId), eq(pettyCashPeriods.yearMonth, scope.yearMonth)))
    .limit(1);
  if (!period) return { success: false, error: `${store.storeNo} has no period ${scope.yearMonth}.`, status: 404 };

  return {
    success: true,
    data: {
      store,
      scope,
      period,
      // Requests of the period — and any old row with no period link that carries its month.
      txWhere: must(
        and(
          eq(pettyCashTransactions.storeId, storeId),
          or(
            eq(pettyCashTransactions.periodId, period.id),
            and(isNull(pettyCashTransactions.periodId), eq(pettyCashTransactions.yearMonth, scope.yearMonth)),
          ),
        ),
      ),
      // A refill's yearMonth is the PERIOD it settles.
      refillWhere: must(
        and(eq(pettyCashRefillRequests.storeId, storeId), eq(pettyCashRefillRequests.yearMonth, scope.yearMonth)),
      ),
      legacyWhere: must(and(eq(pettyCashRefills.storeId, storeId), eq(pettyCashRefills.yearMonth, scope.yearMonth))),
    },
  };
}

async function collect(exec: DbExecutor, r: Resolved) {
  const txs = await exec
    .select({
      id: pettyCashTransactions.id,
      status: pettyCashTransactions.status,
      amount: pettyCashTransactions.amount,
      actualAmount: pettyCashTransactions.actualAmount,
    })
    .from(pettyCashTransactions)
    .where(r.txWhere);

  const refills = await exec
    .select({
      id: pettyCashRefillRequests.id,
      status: pettyCashRefillRequests.status,
      financeVerifiedAt: pettyCashRefillRequests.financeVerifiedAt,
      balanceAfter: pettyCashRefillRequests.balanceAfter,
      transferAmount: pettyCashRefillRequests.transferAmount,
    })
    .from(pettyCashRefillRequests)
    .where(r.refillWhere);

  const legacy = await exec.select({ id: pettyCashRefills.id }).from(pettyCashRefills).where(r.legacyWhere);

  return { txs, refills, legacy };
}

/**
 * The notifications about the deleted rows (they would point at nothing): by the request / refill they name — that
 * reaches Ops and Finance too — and, for "all periods", every petty_cash_* notification of the store's own staff.
 * Undefined = nothing to match (never run an unconditional delete).
 */
function notificationWhere(txIds: number[], refillIds: number[], staffOfStore: number | null): SQL | undefined {
  const parts: SQL[] = [];
  if (txIds.length) {
    const c = and(eq(notifications.relatedType, 'petty_cash_transaction'), inArray(notifications.relatedId, txIds));
    if (c) parts.push(c);
  }
  if (refillIds.length) {
    const c = and(eq(notifications.relatedType, 'petty_cash_refill_request'), inArray(notifications.relatedId, refillIds));
    if (c) parts.push(c);
  }
  if (staffOfStore != null) {
    const c = and(
      sql`left(${notifications.type}, 11) = 'petty_cash_'`,
      inArray(notifications.userId, db.select({ id: users.id }).from(users).where(eq(users.homeStoreId, staffOfStore))),
    );
    if (c) parts.push(c);
  }
  return parts.length ? or(...parts) : undefined;
}

const freshPeriodMonth = () => jakartaYearMonth(Date.now());

function afterState(r: Resolved): ResetPreview['after'] {
  if (r.scope.type === 'period' && r.period) {
    return { yearMonth: r.period.yearMonth, status: r.period.status as PeriodStatus, balance: PETTY_CASH_MAX_BALANCE };
  }
  if (r.store.status === 'active') {
    return { yearMonth: freshPeriodMonth(), status: 'open', balance: PETTY_CASH_MAX_BALANCE };
  }
  return { yearMonth: null, status: null, balance: null };
}

// ─── Stores + one store's periods ────────────────────────────────────────────

/** Every store with how much petty cash data it holds (the picker on the page). */
export async function listResetStores(): Promise<ResetStoreRow[]> {
  const [rows, periods, requests, refills] = await Promise.all([
    db.select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, status: stores.status }).from(stores).orderBy(stores.storeNo),
    db.select({ storeId: pettyCashPeriods.storeId, n: count() }).from(pettyCashPeriods).groupBy(pettyCashPeriods.storeId),
    db.select({ storeId: pettyCashTransactions.storeId, n: count() }).from(pettyCashTransactions).groupBy(pettyCashTransactions.storeId),
    db.select({ storeId: pettyCashRefillRequests.storeId, n: count() }).from(pettyCashRefillRequests).groupBy(pettyCashRefillRequests.storeId),
  ]);
  const by = (list: { storeId: number; n: number }[]) => new Map(list.map((x) => [x.storeId, Number(x.n)]));
  const p = by(periods);
  const t = by(requests);
  const f = by(refills);
  return rows.map((s) => ({
    ...s,
    periods: p.get(s.id) ?? 0,
    requests: t.get(s.id) ?? 0,
    refillRequests: f.get(s.id) ?? 0,
  }));
}

/** The store's periods, newest first, with what each holds — the rows IT picks "reset this period" from. */
export async function getResetOverview(storeId: number): Promise<ResetOutcome<ResetOverview>> {
  const [store] = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, status: stores.status })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return { success: false, error: 'Store not found.', status: 404 };

  const [periods, txs, refills] = await Promise.all([
    db.select().from(pettyCashPeriods).where(eq(pettyCashPeriods.storeId, storeId)),
    db
      .select({ periodId: pettyCashTransactions.periodId, yearMonth: pettyCashTransactions.yearMonth, status: pettyCashTransactions.status })
      .from(pettyCashTransactions)
      .where(eq(pettyCashTransactions.storeId, storeId)),
    db
      .select({
        id: pettyCashRefillRequests.id,
        yearMonth: pettyCashRefillRequests.yearMonth,
        status: pettyCashRefillRequests.status,
        financeVerifiedAt: pettyCashRefillRequests.financeVerifiedAt,
        balanceAfter: pettyCashRefillRequests.balanceAfter,
        requestedAt: pettyCashRefillRequests.requestedAt,
      })
      .from(pettyCashRefillRequests)
      .where(eq(pettyCashRefillRequests.storeId, storeId)),
  ]);

  const rows: ResetPeriodRow[] = periods
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .map((p) => {
      // A row with no period link is read by its month, as the reset itself does.
      const mine = txs.filter((t) => t.periodId === p.id || (t.periodId == null && t.yearMonth === p.yearMonth));
      const settling = refills
        .filter((r) => r.yearMonth === p.yearMonth)
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime() || b.id - a.id);
      return {
        yearMonth: p.yearMonth,
        status: p.status as PeriodStatus,
        balance: Number(p.currentBalance),
        requests: mine.length,
        waiting: mine.filter((t) => NO_WAIT.includes(t.status)).length,
        completed: mine.filter((t) => t.status === 'completed').length,
        refill: settling.length ? { state: refillStateOf(settling[0]), count: settling.length } : null,
      };
    });

  return {
    success: true,
    data: { store, periods: rows, totals: { requests: txs.length, refillRequests: refills.length } },
  };
}

// ─── Preview ─────────────────────────────────────────────────────────────────

export async function previewPettyCashReset(storeId: number, scope: ResetScope): Promise<ResetOutcome<ResetPreview>> {
  const resolved = await resolve(db, storeId, scope);
  if (!resolved.success) return resolved;
  const r = resolved.data;

  const { txs, refills, legacy } = await collect(db, r);
  const txIds = txs.map((t) => t.id);
  const refillIds = refills.map((x) => x.id);

  const requestsByStatus: Record<string, number> = {};
  let completedAmount = 0;
  for (const t of txs) {
    requestsByStatus[t.status] = (requestsByStatus[t.status] ?? 0) + 1;
    if (t.status === 'completed') completedAmount += Number(t.actualAmount ?? t.amount);
  }

  let verified = 0;
  let received = 0;
  let inFlight = 0;
  let transferred = 0;
  for (const x of refills) {
    const state = refillStateOf(x);
    if (x.financeVerifiedAt) {
      verified += 1;
      transferred += Number(x.transferAmount ?? 0);
    }
    if (state === 'received') received += 1;
    if (state === 'pending' || state === 'awaiting_finance' || state === 'verified') inFlight += 1;
  }

  const notifCond = notificationWhere(txIds, refillIds, scope.type === 'all' ? storeId : null);
  const notifCount = notifCond ? Number((await db.select({ n: count() }).from(notifications).where(notifCond))[0].n) : 0;

  // A Re-request of another period whose original is deleted here keeps its row but loses the link.
  let orphaned = 0;
  if (scope.type === 'period' && txIds.length) {
    const inScope = new Set(txIds);
    const pointing = await db
      .select({ id: pettyCashTransactions.id })
      .from(pettyCashTransactions)
      .where(inArray(pettyCashTransactions.reRequestOfId, txIds));
    orphaned = pointing.filter((p) => !inScope.has(p.id)).length;
  }

  const periodsRemoved =
    scope.type === 'all'
      ? Number((await db.select({ n: count() }).from(pettyCashPeriods).where(eq(pettyCashPeriods.storeId, storeId)))[0].n)
      : 0;

  return {
    success: true,
    data: {
      store: r.store,
      scope,
      requests: txs.length,
      requestsByStatus,
      completedAmount,
      refillRequests: refills.length,
      refillsVerified: verified,
      refillsReceived: received,
      transferredAmount: transferred,
      refillsInFlight: inFlight,
      legacyRefills: legacy.length,
      periodsRemoved,
      notifications: notifCount,
      orphanedReRequests: orphaned,
      after: afterState(r),
    },
  };
}

// ─── Reset ───────────────────────────────────────────────────────────────────

export async function resetPettyCash(storeId: number, scope: ResetScope): Promise<ResetOutcome<ResetResult>> {
  return db.transaction(async (trx): Promise<ResetOutcome<ResetResult>> => {
    // Lock the store's periods: a PIC filing a request (which updates its period) waits until this commits.
    await trx
      .select({ id: pettyCashPeriods.id })
      .from(pettyCashPeriods)
      .where(eq(pettyCashPeriods.storeId, storeId))
      .for('update');

    const resolved = await resolve(trx, storeId, scope);
    if (!resolved.success) return resolved;
    const r = resolved.data;

    const found = await collect(trx, r);
    const txIds = found.txs.map((t) => t.id);
    const refillIds = found.refills.map((x) => x.id);

    // Notifications first (they name the rows), then the rows. Re-request links inside the store are
    // ON DELETE SET NULL, so one statement removes the whole set.
    const notifCond = notificationWhere(txIds, refillIds, scope.type === 'all' ? storeId : null);
    const delNotifs = notifCond
      ? await trx.delete(notifications).where(notifCond).returning({ id: notifications.id })
      : [];
    const delTx = await trx.delete(pettyCashTransactions).where(r.txWhere).returning({ id: pettyCashTransactions.id });
    const delRefills = await trx
      .delete(pettyCashRefillRequests)
      .where(r.refillWhere)
      .returning({ id: pettyCashRefillRequests.id });
    const delLegacy = await trx.delete(pettyCashRefills).where(r.legacyWhere).returning({ id: pettyCashRefills.id });

    const now = new Date();
    let periodsDeleted = 0;

    if (scope.type === 'period' && r.period) {
      // The period stays where it is in the chain (status, closed by/at untouched); only its money starts over.
      await trx
        .update(pettyCashPeriods)
        .set({ openingBalance: MAX, currentBalance: MAX, closingBalance: null, updatedAt: now })
        .where(eq(pettyCashPeriods.id, r.period.id));
    } else {
      const gone = await trx
        .delete(pettyCashPeriods)
        .where(eq(pettyCashPeriods.storeId, storeId))
        .returning({ id: pettyCashPeriods.id });
      periodsDeleted = gone.length;

      if (r.store.status === 'active') {
        // Explicit timestamps (the app's convention) — DEFAULT NOW() reads back 7h off through Drizzle.
        await trx.insert(pettyCashPeriods).values({
          storeId,
          yearMonth: freshPeriodMonth(),
          openingBalance: MAX,
          currentBalance: MAX,
          status: 'open',
          createdAt: now,
          updatedAt: now,
        });
        await trx.update(stores).set({ pettyCashBalance: MAX }).where(eq(stores.id, storeId));
      }
    }

    // The result must be exactly what was promised, or nothing happens.
    const left = Number((await trx.select({ n: count() }).from(pettyCashTransactions).where(r.txWhere))[0].n);
    const leftRefills = Number((await trx.select({ n: count() }).from(pettyCashRefillRequests).where(r.refillWhere))[0].n);
    if (left !== 0 || leftRefills !== 0) {
      throw new Error(`Reset check failed: ${left} request(s) and ${leftRefills} refill(s) are still there.`);
    }
    if (scope.type === 'all') {
      const periods = Number((await trx.select({ n: count() }).from(pettyCashPeriods).where(eq(pettyCashPeriods.storeId, storeId)))[0].n);
      const expected = r.store.status === 'active' ? 1 : 0;
      if (periods !== expected) throw new Error(`Reset check failed: expected ${expected} period(s), found ${periods}.`);
    }

    return {
      success: true,
      data: {
        store: r.store,
        scope,
        deleted: {
          requests: delTx.length,
          refillRequests: delRefills.length,
          legacyRefills: delLegacy.length,
          periods: periodsDeleted,
          notifications: delNotifs.length,
        },
        after: afterState(r),
      },
    };
  });
}

// ─── Backup ──────────────────────────────────────────────────────────────────

/** A Drizzle row as the database names its columns (snake_case) — what json_populate_recordset reads back. */
function toSqlRow(table: PgTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) out[column.name] = row[key];
  return out;
}

/** Every row a reset of this scope deletes (and the period it resets), for IT to keep before it goes. */
export async function exportResetBackup(
  storeId: number,
  scope: ResetScope,
): Promise<ResetOutcome<{ filename: string; body: Record<string, unknown> }>> {
  const resolved = await resolve(db, storeId, scope);
  if (!resolved.success) return resolved;
  const r = resolved.data;

  const [txs, refills, legacy, periods] = await Promise.all([
    db.select().from(pettyCashTransactions).where(r.txWhere),
    db.select().from(pettyCashRefillRequests).where(r.refillWhere),
    db.select().from(pettyCashRefills).where(r.legacyWhere),
    scope.type === 'period' && r.period
      ? Promise.resolve([r.period])
      : db.select().from(pettyCashPeriods).where(eq(pettyCashPeriods.storeId, storeId)),
  ]);

  const notifCond = notificationWhere(
    txs.map((t) => t.id),
    refills.map((x) => x.id),
    scope.type === 'all' ? storeId : null,
  );
  const notifs = notifCond ? await db.select().from(notifications).where(notifCond) : [];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const what = scope.type === 'all' ? 'all' : scope.yearMonth;
  const rows = (table: PgTable, list: object[]) => list.map((x) => toSqlRow(table, x as Record<string, unknown>));

  return {
    success: true,
    data: {
      filename: `petty-cash-backup-${r.store.storeNo}-${what}-${stamp}.json`,
      body: {
        takenAt: new Date().toISOString(),
        store: r.store,
        scope,
        petty_cash_transactions: rows(pettyCashTransactions, txs),
        petty_cash_refill_requests: rows(pettyCashRefillRequests, refills),
        petty_cash_refills: rows(pettyCashRefills, legacy),
        petty_cash_periods: rows(pettyCashPeriods, periods),
        notifications: rows(notifications, notifs),
      },
    },
  };
}

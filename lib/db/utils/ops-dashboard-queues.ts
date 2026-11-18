// lib/db/utils/ops-dashboard-queues.ts
//
// Data behind the Ops Dashboard's "waiting on Ops" lists (GET /api/ops/dashboard/queues).
// Every list is the few items that have waited the LONGEST, plus how many there are in all.
//
//   petty cash   status pending_ops requests + pending refills, any month (same as the tab badges)
//   issues       status 'reported' and routed to Ops — the same rule the Issues inbox uses
//   transfers    open BC transfer orders by phase (lib/transfer-order-phase.ts — the Ops
//                Transfer Order page's own definition); database only, the 5-minute cron keeps
//                it fresh, so the dashboard never calls Business Central
//   visits       Ops HO / IT only: stores whose visit cycle still owes a visit and ends this
//                week (same cycle maths as Visit Toko ▸ Upcoming Visit)
//
// Scope: Ops Area sees only its own area's stores, Ops HO / IT see every area.

import { and, asc, eq, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import { addDaysKey, jakartaDayStart, jakartaTodayKey } from '@/lib/day-bucket';
import {
  areas,
  employeeTypes,
  issueRoleAssignments,
  issues,
  itemTransferOrders,
  pettyCashTransactions,
  storeVisitPolicies,
  storeVisits,
  stores,
  userRoles,
  users,
} from '@/lib/db/schema';
import { ensureWarehouseCodes, isWarehouseCode } from '@/lib/db/utils/item-transfers';
import { getOpsRefillRows } from '@/lib/db/utils/petty-cash-ops';
import type { OpsScope } from '@/lib/performance/ops-scope';
import {
  QUEUE_LIMIT,
  VISIT_QUEUE_LIMIT,
  dueThisWeek,
  weekOf,
  type DashboardQueues,
  type IssueWaitingRow,
  type PettyCashWaitingRow,
  type QueueList,
  type QueueStore,
  type TransferWaitingRow,
  type VisitWaitingRow,
} from '@/lib/ops-dashboard-queues';
import { pettyCashDescription } from '@/lib/petty-cash-categories';
import { effectiveToCreatedAt } from '@/lib/transfer-order-metrics';
import { resolveTransferPhase } from '@/lib/transfer-order-phase';
import { visitCycleView } from '@/lib/store-visit/cycles';
import { dueTone } from '@/lib/store-visit/upcoming';

type Scope = Extract<OpsScope, { ok: true }>;

interface StoreRow {
  id: number;
  storeNo: string;
  name: string;
  areaId: number;
  areaName: string;
}

const byAge = (a: { since: string | null }, b: { since: string | null }) =>
  // Oldest first; a row with no start time goes last (nothing to rank it by).
  (a.since ? new Date(a.since).getTime() : Infinity) - (b.since ? new Date(b.since).getTime() : Infinity);

const monthName = (yearMonth: string) =>
  new Date(`${yearMonth}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', timeZone: 'UTC' });

/** The active Ops Area user(s) of every area — "who looks after this store". */
async function areaOpsNames(): Promise<Map<number, string[]>> {
  const rows = await db
    .select({ name: users.name, areaId: users.areaId })
    .from(users)
    .innerJoin(userRoles, eq(users.roleId, userRoles.id))
    .innerJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(
      and(
        eq(userRoles.code, 'ops'),
        eq(employeeTypes.code, 'ops_area'),
        eq(users.isActive, true),
        isNull(users.deletedAt),
        isNotNull(users.areaId),
      ),
    )
    .orderBy(asc(users.name));
  const map = new Map<number, string[]>();
  for (const r of rows) {
    if (r.areaId == null) continue;
    map.set(r.areaId, [...(map.get(r.areaId) ?? []), r.name]);
  }
  return map;
}

// ─── Petty cash ──────────────────────────────────────────────────────────────

// getOpsRefillRows returns the refills filed in `month` plus every one still pending; a month
// nothing was ever filed in leaves exactly the pending ones — which is all this list wants.
const NO_MONTH = '2000-01';

async function pettyCashQueue(
  areaId: number | null,
  qs: (r: StoreRow) => QueueStore,
): Promise<DashboardQueues['pettyCash']> {
  const tx = pettyCashTransactions;
  const [requests, refills] = await Promise.all([
    db
      .select({
        id: tx.id,
        amount: tx.amount,
        description: tx.description,
        createdAt: tx.createdAt,
        storeId: stores.id,
        storeNo: stores.storeNo,
        storeName: stores.name,
        areaId: areas.id,
        areaName: areas.name,
      })
      .from(tx)
      .innerJoin(stores, eq(stores.id, tx.storeId))
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .where(and(eq(tx.status, 'pending_ops'), areaId != null ? eq(stores.areaId, areaId) : undefined))
      .orderBy(asc(tx.createdAt), asc(tx.id)),
    getOpsRefillRows({ areaId, month: NO_MONTH }),
  ]);

  const rows: PettyCashWaitingRow[] = [
    ...requests.map((r): PettyCashWaitingRow => ({
      key: `request-${r.id}`,
      kind: 'request',
      store: qs({ id: r.storeId, storeNo: r.storeNo, name: r.storeName, areaId: r.areaId, areaName: r.areaName }),
      amount: Math.round(Number(r.amount ?? 0)),
      note: pettyCashDescription(r.description),
      since: new Date(r.createdAt).toISOString(),
      late: false,
    })),
    ...refills
      .filter((r) => r.state === 'pending')
      .map((r): PettyCashWaitingRow => ({
        key: `refill-${r.id}`,
        kind: 'refill',
        store: qs({ id: r.storeId, storeNo: r.storeNo, name: r.storeName, areaId: r.areaId, areaName: r.areaName }),
        amount: r.refill,
        note: `Periode ${monthName(r.periodMonth)}`,
        since: r.requestedAt,
        late: r.late,
      })),
  ].sort(byAge);

  return {
    total: rows.length,
    requests: requests.length,
    refills: rows.length - requests.length,
    items: rows.slice(0, QUEUE_LIMIT),
  };
}

// ─── Issues ──────────────────────────────────────────────────────────────────

async function issueQueue(areaId: number | null, qs: (r: StoreRow) => QueueStore): Promise<QueueList<IssueWaitingRow>> {
  const [opsRole] = await db.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.code, 'ops')).limit(1);
  if (!opsRole) return { total: 0, items: [] };

  const assigned = await db
    .select({ issueId: issueRoleAssignments.issueId })
    .from(issueRoleAssignments)
    .where(eq(issueRoleAssignments.roleId, opsRole.id));
  const assignedIds = [...new Set(assigned.map((r) => r.issueId).filter((id): id is number => Number.isFinite(id)))];

  const routing = [eq(issues.assignedToRoleId, opsRole.id)];
  if (assignedIds.length) routing.push(inArray(issues.id, assignedIds));

  const rows = await db
    .select({
      id: issues.id,
      title: issues.title,
      createdAt: issues.createdAt,
      reporterName: users.name,
      storeId: stores.id,
      storeNo: stores.storeNo,
      storeName: stores.name,
      areaId: areas.id,
      areaName: areas.name,
    })
    .from(issues)
    .innerJoin(stores, eq(issues.storeId, stores.id))
    .innerJoin(areas, eq(areas.id, stores.areaId))
    .innerJoin(users, eq(issues.userId, users.id))
    .where(and(eq(issues.status, 'reported'), or(...routing), areaId != null ? eq(stores.areaId, areaId) : undefined))
    .orderBy(asc(issues.createdAt), asc(issues.id));

  return {
    total: rows.length,
    items: rows.slice(0, QUEUE_LIMIT).map((r) => ({
      id: String(r.id),
      title: r.title,
      store: qs({ id: r.storeId, storeNo: r.storeNo, name: r.storeName, areaId: r.areaId, areaName: r.areaName }),
      reporterName: r.reporterName,
      since: r.createdAt.toISOString(),
    })),
  };
}

// ─── Transfer orders ─────────────────────────────────────────────────────────

async function transferQueues(
  areaId: number | null,
  qs: (r: StoreRow) => QueueStore,
): Promise<DashboardQueues['transfers']> {
  await ensureWarehouseCodes();

  const t = itemTransferOrders;
  const open = await db
    .select({
      id: t.id,
      toaNo: t.toaNo,
      transferFromCode: t.transferFromCode,
      transferToCode: t.transferToCode,
      fromStoreId: t.fromStoreId,
      toStoreId: t.toStoreId,
      qtyOrdered: t.qtyOrdered,
      whseShipmentNo: t.whseShipmentNo,
      returnDetectedAt: t.returnDetectedAt,
      returnSubmittedAt: t.returnSubmittedAt,
      droppingDetectedAt: t.droppingDetectedAt,
      droppingSubmittedAt: t.droppingSubmittedAt,
      receivedAt: t.receivedAt,
      createdAt: t.createdAt,
    })
    .from(t)
    .where(and(isNull(t.receivedAt), or(isNotNull(t.fromStoreId), isNotNull(t.toStoreId))));

  // A "DM…" (or IT-listed) code is a warehouse, never a store — whatever a store row says.
  const ends = open.map((r) => ({
    ...r,
    fromStoreId: isWarehouseCode(r.transferFromCode) ? null : r.fromStoreId,
    toStoreId: isWarehouseCode(r.transferToCode) ? null : r.toStoreId,
  }));

  const storeIds = [...new Set(ends.flatMap((r) => [r.fromStoreId, r.toStoreId]).filter((v): v is number => v != null))];
  const storeRows = storeIds.length
    ? await db
        .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId, areaName: areas.name })
        .from(stores)
        .innerJoin(areas, eq(areas.id, stores.areaId))
        .where(inArray(stores.id, storeIds))
    : [];
  const storeById = new Map(storeRows.map((s) => [s.id, s]));

  const endLabel = (code: string, storeId: number | null) => {
    const s = storeId != null ? storeById.get(storeId) : undefined;
    if (s) return s.storeNo;
    return isWarehouseCode(code) ? `Gudang (${code})` : code;
  };

  const lists: Record<'return' | 'shipping' | 'receiving', TransferWaitingRow[]> = { return: [], shipping: [], receiving: [] };

  for (const r of ends) {
    const phase = resolveTransferPhase(r, isWarehouseCode);
    if (phase !== 'return' && phase !== 'shipping' && phase !== 'receiving') continue;

    // The store the wait is at: the pickup at the origin store; otherwise the store the goods are for.
    const primaryId = phase === 'return' ? r.fromStoreId : r.toStoreId;
    const primary = primaryId != null ? storeById.get(primaryId) : undefined;
    if (!primary) continue;
    if (areaId != null && primary.areaId !== areaId) continue;

    const since =
      phase === 'return'
        ? (effectiveToCreatedAt(r.returnDetectedAt, r.droppingDetectedAt, r.returnSubmittedAt) ?? r.droppingDetectedAt ?? r.createdAt)
        : phase === 'shipping'
          ? (r.returnSubmittedAt ?? r.droppingDetectedAt ?? r.createdAt)
          : r.droppingSubmittedAt;

    lists[phase].push({
      id: String(r.id),
      toaNo: r.toaNo,
      store: qs(primary),
      otherEnd:
        phase === 'return'
          ? `Ke ${endLabel(r.transferToCode, r.toStoreId)}`
          : `Dari ${endLabel(r.transferFromCode, r.fromStoreId)}`,
      qty: r.qtyOrdered,
      since: since ? since.toISOString() : null,
    });
  }

  const cut = (rows: TransferWaitingRow[]): QueueList<TransferWaitingRow> => ({
    total: rows.length,
    items: [...rows].sort(byAge).slice(0, QUEUE_LIMIT),
  });
  return { return: cut(lists.return), shipping: cut(lists.shipping), receiving: cut(lists.receiving) };
}

// ─── Store visits (Ops HO / IT) ──────────────────────────────────────────────

async function visitQueue(qs: (r: StoreRow) => QueueStore): Promise<NonNullable<DashboardQueues['visits']>> {
  const today = jakartaTodayKey();
  const week = weekOf(today);

  // Every store with a visit rule. The longest cycle is 365 days, but only the CURRENT cycle matters
  // here, so the visits are read from the start of the oldest cycle that can still be running.
  const policyRows = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
      areaId: stores.areaId,
      areaName: areas.name,
      intervalDays: storeVisitPolicies.intervalDays,
      minimumVisits: storeVisitPolicies.minimumVisits,
    })
    .from(stores)
    .innerJoin(areas, eq(areas.id, stores.areaId))
    .innerJoin(storeVisitPolicies, eq(storeVisitPolicies.storeNo, stores.storeNo))
    .where(eq(stores.status, 'active'));

  const horizon = Math.max(7, ...policyRows.map((p) => p.intervalDays));
  const visitRows = policyRows.length
    ? await db
        .select({ storeId: storeVisits.storeId, at: storeVisits.visitedAt })
        .from(storeVisits)
        .where(gte(storeVisits.visitedAt, jakartaDayStart(addDaysKey(today, -(horizon + 7)))))
    : [];
  const visitsByStore = new Map<number, Date[]>();
  for (const v of visitRows) visitsByStore.set(v.storeId, [...(visitsByStore.get(v.storeId) ?? []), v.at]);

  const rows: VisitWaitingRow[] = [];
  for (const p of policyRows) {
    const { current } = visitCycleView(
      { intervalDays: p.intervalDays, minimumVisits: p.minimumVisits },
      visitsByStore.get(p.id) ?? [],
      today,
    );
    if (current.met || !dueThisWeek(current.end, week.end)) continue;
    rows.push({
      store: qs(p),
      daysLeft: current.daysLeft,
      deadline: current.end,
      remaining: current.remaining,
      intervalDays: p.intervalDays,
      tone: dueTone(current.daysLeft),
    });
  }
  // Nearest deadline first; within a deadline keep an area's stores together.
  rows.sort(
    (a, b) =>
      a.daysLeft - b.daysLeft || a.store.areaName.localeCompare(b.store.areaName) || a.store.storeNo.localeCompare(b.store.storeNo),
  );

  return { weekStart: week.start, weekEnd: week.end, total: rows.length, items: rows.slice(0, VISIT_QUEUE_LIMIT) };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function getDashboardQueues(scope: Scope): Promise<DashboardQueues> {
  const areaId = scope.scope === 'area' ? scope.areaId : null;

  // Area + Ops Area are only shown to HO (an Ops Area user is looking at their own area already).
  const opsByArea = scope.scope === 'all_areas' ? await areaOpsNames() : new Map<number, string[]>();
  const qs = (r: StoreRow): QueueStore => ({
    id: r.id,
    storeNo: r.storeNo,
    name: r.name,
    areaName: r.areaName,
    opsNames: opsByArea.get(r.areaId) ?? [],
  });

  const [pettyCash, issueList, transfers, visits] = await Promise.all([
    pettyCashQueue(areaId, qs),
    issueQueue(areaId, qs),
    transferQueues(areaId, qs),
    scope.scope === 'all_areas' ? visitQueue(qs) : Promise.resolve(null),
  ]);

  return { success: true, scope: scope.scope, pettyCash, issues: issueList, transfers, visits };
}

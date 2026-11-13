// lib/db/utils/petty-cash-report.ts
//
// Data behind Finance's Petty Cash Report: for every store, how much petty
// cash it used in a month and which bank account its PIC 1 gave for the
// refill.
//
// Only store-months whose refill PIC 1 has sent are listed (a refill request
// for the month that OPS did not turn down) — without one nothing shows. A
// listed month is finished (isStoreMonthComplete) once nothing waits on OPS, on
// PIC 1's actual amount or a fix after Perlu Perbaikan and nothing is Pending
// Finance; only then can Finance VERIFY its refill here (the only place it
// can). An unfinished one is still listed (`complete: false`, with what is
// still `open`) — the page draws it in light red.
// Stores that are still getting ready to open have no petty cash and are
// never listed.

import { db } from '@/lib/db';
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  areas,
  employeeTypes,
  pettyCashRefillRequests,
  pettyCashTransactions,
  stores,
  users,
} from '@/lib/db/schema';
import {
  isStoreMonthComplete,
  refillStateOf,
  storeCodeOf,
  type PettyCashReport,
  type PettyCashReportRow,
  type ReportRefill,
} from '@/lib/petty-cash-report';
import { LEFT_OUT_REVIEWS } from '@/lib/petty-cash-review';
import { getRefillRowsByIds } from './petty-cash-ops';

const decided = sql.raw([...LEFT_OUT_REVIEWS, 'accepted'].map((r) => `'${r}'`).join(', '));

/** A completed request nobody at Finance has decided on yet (Pending Finance). */
const pendingFinance = sql`(${pettyCashTransactions.status} = 'completed' AND (${pettyCashTransactions.financeReview} IS NULL OR ${pettyCashTransactions.financeReview} NOT IN (${decided})))`;

export async function getPettyCashReport(month: string): Promise<PettyCashReport> {
  const storeRows = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
      areaName: areas.name,
      deptCode: stores.deptCode,
      status: stores.status,
    })
    .from(stores)
    .innerJoin(areas, eq(stores.areaId, areas.id))
    .where(ne(stores.status, 'ready_to_open'));

  if (storeRows.length === 0) return { rows: [], incompleteCount: 0 };

  // One pass over the month's requests per store: what was used and what is still waiting. "Used" (Total Terpakai)
  // adds up only the completed requests Finance ACCEPTED (Diterima) — the same rule as Monitoring's Used; a request
  // still Pending Finance, Perlu Perbaikan or Ditolak is not in it.
  const usedCompleted = sql`${pettyCashTransactions.status} = 'completed'`;
  const accepted = sql`${usedCompleted} AND ${pettyCashTransactions.financeReview} = 'accepted'`;
  const usedRows = await db
    .select({
      storeId: pettyCashTransactions.storeId,
      total: sql<string>`COALESCE(SUM(COALESCE(${pettyCashTransactions.actualAmount}, ${pettyCashTransactions.amount})) FILTER (WHERE ${accepted}), 0)`,
      count: sql<number>`COUNT(*) FILTER (WHERE ${accepted})::int`,
      anyCount: sql<number>`COUNT(*)::int`,
      pendingOps: sql<number>`COUNT(*) FILTER (WHERE ${pettyCashTransactions.status} = 'pending_ops')::int`,
      awaitingActual: sql<number>`COUNT(*) FILTER (WHERE ${pettyCashTransactions.status} = 'ops_approved')::int`,
      fixing: sql<number>`COUNT(*) FILTER (WHERE ${pettyCashTransactions.status} = 'draft')::int`,
      pendingFinance: sql<number>`COUNT(*) FILTER (WHERE ${pendingFinance})::int`,
    })
    .from(pettyCashTransactions)
    .where(eq(pettyCashTransactions.yearMonth, month))
    .groupBy(pettyCashTransactions.storeId);

  const usedByStore = new Map(usedRows.map((r) => [r.storeId, r]));

  // Newest first, so the first row seen per store is the account PIC 1 most
  // recently gave. Requests from before bank details were required have none
  // and are skipped.
  const bankRows = await db
    .select({
      storeId: pettyCashRefillRequests.storeId,
      bankName: pettyCashRefillRequests.bankName,
      accountNumber: pettyCashRefillRequests.accountNumber,
      accountHolderName: pettyCashRefillRequests.accountHolderName,
      requesterName: users.name,
    })
    .from(pettyCashRefillRequests)
    .leftJoin(users, eq(pettyCashRefillRequests.requestedBy, users.id))
    .where(isNotNull(pettyCashRefillRequests.accountNumber))
    .orderBy(desc(pettyCashRefillRequests.requestedAt));

  const bankByStore = new Map<number, (typeof bankRows)[number]>();
  for (const row of bankRows) {
    if (!bankByStore.has(row.storeId)) bankByStore.set(row.storeId, row);
  }

  // Stores with no bank details yet fall back to their current PIC 1(s), so
  // Finance knows who to chase.
  const pic1Rows = await db
    .select({ storeId: users.homeStoreId, name: users.name })
    .from(users)
    .innerJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(and(eq(employeeTypes.code, 'pic_1'), eq(users.isActive, true), isNotNull(users.homeStoreId)))
    .orderBy(users.name);

  const pic1ByStore = new Map<number, string[]>();
  for (const row of pic1Rows) {
    if (row.storeId == null) continue;
    const names = pic1ByStore.get(row.storeId);
    if (names) names.push(row.name);
    else pic1ByStore.set(row.storeId, [row.name]);
  }

  // The refill that settles THIS month (its yearMonth = the period), newest request first — any state but turned
  // down by OPS (waiting on OPS, waiting for Finance's Verifikasi, verified, received). The verifier is a second
  // join onto users.
  const verifier = alias(users, 'refill_verifier');
  const requestRows = await db
    .select({
      request: pettyCashRefillRequests,
      verifiedByName: verifier.name,
    })
    .from(pettyCashRefillRequests)
    .leftJoin(verifier, eq(pettyCashRefillRequests.financeVerifiedBy, verifier.id))
    .where(eq(pettyCashRefillRequests.yearMonth, month))
    .orderBy(desc(pettyCashRefillRequests.requestedAt));

  const verifierByRequest = new Map(requestRows.map((r) => [r.request.id, r.verifiedByName]));
  const askedByStore = new Map<number, (typeof requestRows)[number]['request']>();
  for (const { request } of requestRows) {
    if (request.status !== 'rejected' && !askedByStore.has(request.storeId)) askedByStore.set(request.storeId, request);
  }
  // What each one sends: the refill (frozen once Finance verified it) — the same figure Ops and Finance see elsewhere.
  const transferById = new Map(
    (await getRefillRowsByIds([...askedByStore.values()].map((r) => r.id))).map((r) => [r.id, r.transfer]),
  );

  const rows: PettyCashReportRow[] = [];
  let incompleteCount = 0;

  for (const store of storeRows) {
    const used = usedByStore.get(store.id);
    const request = askedByStore.get(store.id) ?? null;

    const complete = isStoreMonthComplete({
      pendingOpsCount: used?.pendingOps ?? 0,
      awaitingActualCount: used?.awaitingActual ?? 0,
      fixingCount: used?.fixing ?? 0,
      pendingFinanceCount: used?.pendingFinance ?? 0,
      refillAsked: request != null,
    });
    // No refill sent for the month yet: not listed at all (2026-11-13, by request).
    if (request == null) continue;
    if (!complete) incompleteCount += 1;

    // The account on the request being paid beats the store's latest one.
    const bank = request?.accountNumber ? request : bankByStore.get(store.id);

    const refill: ReportRefill | null = request
      ? {
          id: request.id,
          yearMonth: request.yearMonth,
          state: refillStateOf(request),
          requestedAt: request.requestedAt.toISOString(),
          approvedAt: request.approvedAt?.toISOString() ?? null,
          verifiedAt: request.financeVerifiedAt?.toISOString() ?? null,
          verifiedByName: verifierByRequest.get(request.id) ?? null,
          receivedAt: request.balanceAfter ? request.proofUploadedAt?.toISOString() ?? null : null,
          proofCount: [request.drawerPhotoUrl, request.signaturePhotoUrl].filter(Boolean).length,
          transfer: transferById.get(request.id)?.transfer ?? null,
          transferFrozen: transferById.get(request.id)?.frozen ?? false,
        }
      : null;

    rows.push({
      storeId: store.id,
      storeNo: store.storeNo,
      storeName: store.name,
      areaName: store.areaName,
      code: storeCodeOf(store.storeNo),
      deptCode: store.deptCode,
      storeStatus: store.status,

      totalUsed: Math.round(Number(used?.total ?? 0)),
      txCount: used?.count ?? 0,

      complete,
      open: {
        pendingOps: used?.pendingOps ?? 0,
        awaitingActual: used?.awaitingActual ?? 0,
        fixing: used?.fixing ?? 0,
        pendingFinance: used?.pendingFinance ?? 0,
      },

      pic1Name: bankByStore.get(store.id)?.requesterName ?? pic1ByStore.get(store.id)?.join(', ') ?? null,
      bankName: bank?.bankName ?? null,
      accountNumber: bank?.accountNumber ?? null,
      accountHolderName: bank?.accountHolderName ?? null,

      refill,
    });
  }

  rows.sort((a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }));
  return { rows, incompleteCount };
}

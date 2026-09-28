// lib/db/utils/petty-cash-report.ts
//
// Data behind Finance's Petty Cash Report: for every store, how much petty
// cash it used in a month and which bank account its PIC 1 gave for the
// refill. Unlike the monitoring view this lists ALL stores — a store that
// spent nothing (or never filed a refill request) still gets a row, so
// Finance can see who is missing bank details.

import { db } from '@/lib/db';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  areas,
  employeeTypes,
  pettyCashRefillRequests,
  pettyCashTransactions,
  stores,
  users,
} from '@/lib/db/schema';
import { storeCodeOf, type PettyCashReportRow } from '@/lib/petty-cash-report';

export async function getPettyCashReport(month: string): Promise<PettyCashReportRow[]> {
  const storeRows = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
      areaName: areas.name,
    })
    .from(stores)
    .innerJoin(areas, eq(stores.areaId, areas.id));

  if (storeRows.length === 0) return [];

  // Only 'completed' requests have actually been deducted — same rule as the
  // monitoring view (ops_approved ones are still waiting on the actual amount).
  const usedRows = await db
    .select({
      storeId: pettyCashTransactions.storeId,
      total: sql<string>`COALESCE(SUM(COALESCE(${pettyCashTransactions.actualAmount}, ${pettyCashTransactions.amount})), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(pettyCashTransactions)
    .where(and(eq(pettyCashTransactions.yearMonth, month), eq(pettyCashTransactions.status, 'completed')))
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

  return storeRows
    .map((store): PettyCashReportRow => {
      const used = usedByStore.get(store.id);
      const bank = bankByStore.get(store.id);

      return {
        storeId: store.id,
        storeNo: store.storeNo,
        storeName: store.name,
        areaName: store.areaName,
        code: storeCodeOf(store.storeNo),

        totalUsed: Math.round(Number(used?.total ?? 0)),
        txCount: used?.count ?? 0,

        pic1Name: bank?.requesterName ?? pic1ByStore.get(store.id)?.join(', ') ?? null,
        bankName: bank?.bankName ?? null,
        accountNumber: bank?.accountNumber ?? null,
        accountHolderName: bank?.accountHolderName ?? null,
      };
    })
    .sort((a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }));
}

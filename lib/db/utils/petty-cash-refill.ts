// lib/db/utils/petty-cash-refill.ts
//
// PIC-initiated "top me back up" requests — distinct from Finance's own
// month-end close-and-reset (pettyCashRefills in lib/db/schema/petty-cash.ts).
// Approval bumps the CURRENT open period's balance directly; it does not
// close the period or roll to next month.

import { db } from '@/lib/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefillRequests,
  stores,
  users,
  type PettyCashRefillRequest,
} from '@/lib/db/schema';
import { createNotificationsForUsers, getOpsUserIdsForArea } from './notifications';

export function currentYearMonthJakarta(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

async function ensurePeriod(storeId: number, yearMonth: string) {
  await db
    .insert(pettyCashPeriods)
    .values({
      storeId,
      yearMonth,
      openingBalance: String(PETTY_CASH_MAX_BALANCE),
      currentBalance: String(PETTY_CASH_MAX_BALANCE),
      status: 'open',
    })
    .onConflictDoNothing({ target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth] });

  const [period] = await db
    .select()
    .from(pettyCashPeriods)
    .where(and(eq(pettyCashPeriods.storeId, storeId), eq(pettyCashPeriods.yearMonth, yearMonth)))
    .limit(1);

  return period ?? null;
}

async function notifyOps(storeId: number, input: { type: string; title: string; body: string }) {
  const [storeRow] = await db
    .select({ areaId: stores.areaId, name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  const opsUserIds = await getOpsUserIdsForArea(storeRow?.areaId ?? null);
  await createNotificationsForUsers(opsUserIds, { ...input, link: '/ops/petty-cash' });
}

/** A request still "in play" for the month — blocks a new request. Rejected ones don't count. */
export async function getActiveRefillRequest(
  storeId: number,
  yearMonth: string,
): Promise<PettyCashRefillRequest | null> {
  const [row] = await db
    .select()
    .from(pettyCashRefillRequests)
    .where(
      and(
        eq(pettyCashRefillRequests.storeId, storeId),
        eq(pettyCashRefillRequests.yearMonth, yearMonth),
        or(eq(pettyCashRefillRequests.status, 'pending'), eq(pettyCashRefillRequests.status, 'approved')),
      ),
    )
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(1);

  return row ?? null;
}

export async function getLatestRefillRequest(
  storeId: number,
  yearMonth: string,
): Promise<PettyCashRefillRequest | null> {
  const [row] = await db
    .select()
    .from(pettyCashRefillRequests)
    .where(and(eq(pettyCashRefillRequests.storeId, storeId), eq(pettyCashRefillRequests.yearMonth, yearMonth)))
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(1);

  return row ?? null;
}

export type RefillRequestResult =
  | { success: true; request: PettyCashRefillRequest }
  | { success: false; error: string };

export async function createRefillRequest(
  storeId: number,
  userId: string,
  notes?: string,
): Promise<RefillRequestResult> {
  const yearMonth = currentYearMonthJakarta();

  const active = await getActiveRefillRequest(storeId, yearMonth);
  if (active) {
    return {
      success: false,
      error:
        active.status === 'pending'
          ? 'A refill request for this month is already pending Finance approval.'
          : 'This month\'s refill has already been approved.',
    };
  }

  const period = await ensurePeriod(storeId, yearMonth);

  const [request] = await db
    .insert(pettyCashRefillRequests)
    .values({
      storeId,
      yearMonth,
      requestedBy: userId,
      notes,
      balanceBefore: period?.currentBalance ?? String(PETTY_CASH_MAX_BALANCE),
    })
    .returning();

  const [storeRow] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1);
  await notifyOps(storeId, {
    type: 'petty_cash_refill_requested',
    title: `Petty cash refill requested — ${storeRow?.name ?? `Store ${storeId}`}`,
    body: `Requested for ${yearMonth}.${notes ? ` Note: ${notes}` : ''}`,
  });

  return { success: true, request };
}

export async function approveRefillRequest(id: number, financeUserId: string): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.status !== 'pending') return { success: false, error: 'Request has already been processed.' };

  const period = await ensurePeriod(existing.storeId, existing.yearMonth);
  if (!period || period.status !== 'open') {
    return { success: false, error: 'This store\'s month is already closed — cannot refill.' };
  }

  const balanceBefore = period.currentBalance;

  const updated = await db
    .update(pettyCashPeriods)
    .set({ currentBalance: String(PETTY_CASH_MAX_BALANCE), updatedAt: new Date() })
    .where(and(eq(pettyCashPeriods.id, period.id), eq(pettyCashPeriods.status, 'open')))
    .returning({ id: pettyCashPeriods.id });

  if (!updated.length) {
    return { success: false, error: 'This store\'s month was closed just now — cannot refill.' };
  }

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({
      status: 'approved',
      approvedBy: financeUserId,
      approvedAt: new Date(),
      balanceBefore,
      balanceAfter: String(PETTY_CASH_MAX_BALANCE),
    })
    .where(eq(pettyCashRefillRequests.id, id))
    .returning();

  const [storeRow] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, existing.storeId)).limit(1);
  await notifyOps(existing.storeId, {
    type: 'petty_cash_refill_approved',
    title: `Petty cash refill approved — ${storeRow?.name ?? `Store ${existing.storeId}`}`,
    body: `${existing.yearMonth} balance topped up to Rp ${PETTY_CASH_MAX_BALANCE.toLocaleString('id-ID')}.`,
  });

  return { success: true, request };
}

export async function rejectRefillRequest(
  id: number,
  financeUserId: string,
  reason?: string,
): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.status !== 'pending') return { success: false, error: 'Request has already been processed.' };

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({ status: 'rejected', rejectedBy: financeUserId, rejectedAt: new Date(), rejectionReason: reason })
    .where(eq(pettyCashRefillRequests.id, id))
    .returning();

  return { success: true, request };
}

export interface RefillRequestWithContext extends PettyCashRefillRequest {
  storeName: string;
  storeAreaId: number | null;
  requestedByName: string | null;
}

export async function listRefillRequestsForFinance(limit = 50): Promise<RefillRequestWithContext[]> {
  const rows = await db
    .select({
      request: pettyCashRefillRequests,
      storeName: stores.name,
      storeAreaId: stores.areaId,
      requestedByName: users.name,
    })
    .from(pettyCashRefillRequests)
    .innerJoin(stores, eq(pettyCashRefillRequests.storeId, stores.id))
    .leftJoin(users, eq(pettyCashRefillRequests.requestedBy, users.id))
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(limit);

  return rows.map((r) => ({ ...r.request, storeName: r.storeName, storeAreaId: r.storeAreaId, requestedByName: r.requestedByName }));
}

export async function listRefillRequestsForAreas(areaIds: number[] | null, limit = 50): Promise<RefillRequestWithContext[]> {
  const rows = await db
    .select({
      request: pettyCashRefillRequests,
      storeName: stores.name,
      storeAreaId: stores.areaId,
      requestedByName: users.name,
    })
    .from(pettyCashRefillRequests)
    .innerJoin(stores, eq(pettyCashRefillRequests.storeId, stores.id))
    .leftJoin(users, eq(pettyCashRefillRequests.requestedBy, users.id))
    .where(areaIds ? inArray(stores.areaId, areaIds) : undefined)
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(limit);

  return rows.map((r) => ({ ...r.request, storeName: r.storeName, storeAreaId: r.storeAreaId, requestedByName: r.requestedByName }));
}

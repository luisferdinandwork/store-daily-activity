// lib/db/utils/store-status.ts
//
// DB side of the store lifecycle (see lib/store-status.ts for the rules).
//
//   • getStoreStatus / assertStoreOperational — the gate the employee-facing
//     routes (attendance, tasks, petty cash, item transfers) call.
//   • changeStoreStatus — the single place a status is changed: validates the
//     transition, applies the petty-cash side effects, writes the history row.
//   • checkStoreCloseReadiness — the seam the Audit phase plugs into.

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores, storeStatusHistory } from '@/lib/db/schema/core';
import { PETTY_CASH_MAX_BALANCE } from '@/lib/db/schema/petty-cash';
import { topUpPeriodToMax } from '@/lib/db/utils/petty-cash-period';
import { todayJakarta } from '@/lib/finance/dates';
import {
  canTransitionStoreStatus,
  isStoreOperational,
  STORE_STATUS_LABEL,
  storeInactiveMessage,
  type StoreStatus,
} from '@/lib/store-status';

export async function getStoreStatus(storeId: number): Promise<StoreStatus | null> {
  const [row] = await db
    .select({ status: stores.status })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  return row?.status ?? null;
}

/**
 * Null when the store is `active`; otherwise the Indonesian message to show the
 * employee. A missing store is left to the caller's own 404 handling (null).
 */
export async function assertStoreOperational(storeId: number): Promise<string | null> {
  const status = await getStoreStatus(storeId);
  if (status === null) return null;
  return isStoreOperational(status) ? null : storeInactiveMessage(status);
}

/** Subset of `storeIds` that are `active` — for rollups that must skip prep/closed stores. */
export async function filterActiveStoreIds(storeIds: number[]): Promise<number[]> {
  if (storeIds.length === 0) return [];
  const rows = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(inArray(stores.id, storeIds), eq(stores.status, 'active')));
  return rows.map((r) => r.id);
}

// ─── Close-out seam (Audit, next phase) ───────────────────────────────────────

export type CloseReadiness = { ok: true } | { ok: false; reason: string };

/**
 * Called before a store is moved to `close`. Today nothing blocks a close; the
 * Audit phase will put its clearance here (e.g. a signed-off stock count and
 * petty-cash reconciliation for the store) and return `{ ok: false, reason }`
 * until it's done — changeStoreStatus already refuses on a not-ok result.
 */
export async function checkStoreCloseReadiness(_storeId: number): Promise<CloseReadiness> {
  return { ok: true };
}

// ─── Transition ───────────────────────────────────────────────────────────────

export type ChangeStoreStatusResult =
  | { success: true; data: { storeId: number; from: StoreStatus; to: StoreStatus } }
  | { success: false; error: string };

export async function changeStoreStatus(params: {
  storeId: number;
  to: StoreStatus;
  actorId: string | null;
  note?: string | null;
}): Promise<ChangeStoreStatusResult> {
  const { storeId, to, actorId } = params;
  const note = params.note?.trim() || null;

  const [store] = await db
    .select({ id: stores.id, status: stores.status, storeNo: stores.storeNo })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return { success: false, error: 'Store not found.' };

  const from = store.status;
  if (from === to) {
    return { success: false, error: `${store.storeNo} is already ${STORE_STATUS_LABEL[to]}.` };
  }
  if (!canTransitionStoreStatus(from, to)) {
    return {
      success: false,
      error: `A store can't move from ${STORE_STATUS_LABEL[from]} to ${STORE_STATUS_LABEL[to]}.`,
    };
  }

  if (to === 'close') {
    const readiness = await checkStoreCloseReadiness(storeId);
    if (!readiness.ok) return { success: false, error: readiness.reason };
  }

  const now = new Date();

  await db
    .update(stores)
    .set({
      status: to,
      statusChangedAt: now,
      closedAt: to === 'close' ? now : null,
      closeReason: to === 'close' ? note : null,
      updatedAt: now,
    })
    .where(eq(stores.id, storeId));

  // Activation is the "trigger the petty cash" moment: a prep store carries
  // Rp 0, and going live provisions the standard float and opens this month's
  // period so Finance sees it. Reopening a closed store keeps whatever balance
  // the close left behind (it is not a fresh provision).
  if (from === 'ready_to_open' && to === 'active') {
    await db
      .update(stores)
      .set({ pettyCashBalance: String(PETTY_CASH_MAX_BALANCE) })
      .where(eq(stores.id, storeId));
    await topUpPeriodToMax(storeId, todayJakarta().slice(0, 7));
  }

  await db.insert(storeStatusHistory).values({
    storeId,
    fromStatus: from,
    toStatus: to,
    changedBy: actorId,
    note,
  });

  return { success: true, data: { storeId, from, to } };
}

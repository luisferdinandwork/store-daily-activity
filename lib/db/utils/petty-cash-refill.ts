// lib/db/utils/petty-cash-refill.ts
//
// PIC-initiated "top me back up" requests — distinct from Finance's own
// month-end close-and-reset (pettyCashRefills in lib/db/schema/petty-cash.ts).
//
// Flow: PIC 1 requests -> OPS approves/rejects the request (Finance is still
// the one who will hand over the physical cash, but approval alone does NOT
// move the balance yet — the store hasn't actually received the cash at
// this point) -> Finance sends the cash and verifies the refill on its
// Petty Cash pages (financeVerifiedAt; PIC 1 can't confirm receipt before
// this) -> PIC 1 uploads two proof-of-receipt photos
// (the petty cash drawer and the Surat Terima Petty Cash) as evidence the
// cash was physically handed over. Only once BOTH photos are in does the
// balance actually top back up to the max — that's the real "the store now
// has the money" moment, not Finance's approval.
//
// A completed refill also pre-creates NEXT month's period at max balance
// (see petty-cash-period.ts), so once the calendar rolls over the store
// already has a fresh envelope waiting. A store that never gets refilled
// gets no such row — it just keeps carrying its current balance forward
// across month boundaries until it eventually does get refilled.

import { db } from '@/lib/db';
import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import {
  pettyCashRefillRequests,
  stores,
  users,
  type PettyCashRefillRequest,
} from '@/lib/db/schema';
import { createNotificationsForUsers, getOpsUserIdsForArea } from './notifications';
import { addMonths, getActivePeriod, topUpPeriodToMax } from './petty-cash-period';
import { PETTY_CASH_MAX_BALANCE } from '@/lib/db/schema/petty-cash';
import type { BankDetails } from '@/lib/petty-cash-bank';

/**
 * PIC 1 is the store's petty cash holder: only they request usage, confirm
 * the actual amount spent, upload receipts, request a refill and upload its
 * proof photos. Everyone else at the store (PIC 2, SA) can only view.
 */
export function isPettyCashHolder(empType: unknown): boolean {
  return empType === 'pic_1';
}

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
        or(
          eq(pettyCashRefillRequests.status, 'pending'),
          eq(pettyCashRefillRequests.status, 'approved'),
        ),
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

/**
 * The account this PIC used on their most recent refill request — pre-fills
 * the form so they don't retype it every month (they can still change it).
 */
export async function getLastBankDetails(userId: string): Promise<BankDetails | null> {
  const [row] = await db
    .select({
      bankName: pettyCashRefillRequests.bankName,
      accountNumber: pettyCashRefillRequests.accountNumber,
      accountHolderName: pettyCashRefillRequests.accountHolderName,
    })
    .from(pettyCashRefillRequests)
    .where(and(eq(pettyCashRefillRequests.requestedBy, userId), isNotNull(pettyCashRefillRequests.accountNumber)))
    .orderBy(desc(pettyCashRefillRequests.requestedAt))
    .limit(1);

  if (!row?.bankName || !row.accountNumber || !row.accountHolderName) return null;
  return { bankName: row.bankName, accountNumber: row.accountNumber, accountHolderName: row.accountHolderName };
}

/**
 * PIC 1 must say where Finance should send the cash at the moment they ask
 * for the refill, so `bank` is required (already validated/normalised by
 * normalizeBankDetails in the route).
 */
export async function createRefillRequest(
  storeId: number,
  userId: string,
  bank: BankDetails,
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

  const period = await getActivePeriod(storeId, yearMonth);

  const [request] = await db
    .insert(pettyCashRefillRequests)
    .values({
      storeId,
      yearMonth,
      requestedBy: userId,
      notes,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountHolderName: bank.accountHolderName,
      balanceBefore: period.currentBalance,
      // Explicit app-clock timestamp — see the same fix/comment in
      // app/api/employee/petty-cash/route.ts for why DEFAULT NOW() is wrong here.
      requestedAt: new Date(),
    })
    .returning();

  const [storeRow] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1);
  await notifyOps(storeId, {
    type: 'petty_cash_refill_requested',
    title: `Petty cash refill requested — ${storeRow?.name ?? `Store ${storeId}`}`,
    body: `Requested for ${yearMonth}. Transfer to ${bank.bankName} ${bank.accountNumber} a.n. ${bank.accountHolderName}.${notes ? ` Note: ${notes}` : ''}`,
  });

  return { success: true, request };
}

/**
 * OPS approves — this only marks the request approved and snapshots the
 * balance at the time of approval. It does NOT touch the period's balance:
 * the store hasn't received the cash yet (Finance still needs to physically
 * hand it over), so the dashboard shouldn't show it as available yet either.
 * The balance only tops up once proof photos are in (see attachRefillProof
 * below).
 */
export async function approveRefillRequest(id: number, actorUserId: string): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.status !== 'pending') return { success: false, error: 'Request has already been processed.' };

  const period = await getActivePeriod(existing.storeId, existing.yearMonth);
  if (period.status !== 'open') {
    return { success: false, error: 'This store\'s month is already closed — cannot refill.' };
  }

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({
      status: 'approved',
      approvedBy: actorUserId,
      approvedAt: new Date(),
      balanceBefore: period.currentBalance,
    })
    .where(and(eq(pettyCashRefillRequests.id, id), eq(pettyCashRefillRequests.status, 'pending')))
    .returning();

  if (!request) {
    return { success: false, error: 'Approval failed. Request may already be processed.' };
  }

  return { success: true, request };
}

export async function rejectRefillRequest(
  id: number,
  actorUserId: string,
  reason?: string,
): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.status !== 'pending') return { success: false, error: 'Request has already been processed.' };

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({ status: 'rejected', rejectedBy: actorUserId, rejectedAt: new Date(), rejectionReason: reason })
    .where(and(eq(pettyCashRefillRequests.id, id), eq(pettyCashRefillRequests.status, 'pending')))
    .returning();

  if (!request) return { success: false, error: 'Reject failed. Please refresh and try again.' };

  return { success: true, request };
}

export interface RefillVerifyResult {
  /** Ids that actually changed. */
  changedIds: number[];
  /** Ids left alone (already in that state, wrong status, or proof already uploaded). */
  skipped: number;
}

/**
 * Finance verifies that it has refilled the store for an OPS-approved request.
 * This is what unlocks PIC 1's "receive" step (proof photos) on the employee
 * page — see attachRefillProof. The status guard lives in the UPDATE itself, so
 * two Finance users racing can't both claim the same request. PIC 1 is
 * notified for each one that actually changed.
 */
export async function verifyRefillRequests(ids: number[], actorUserId: string): Promise<RefillVerifyResult> {
  if (ids.length === 0) return { changedIds: [], skipped: 0 };
  const now = new Date();

  const rows = await db
    .update(pettyCashRefillRequests)
    .set({ financeVerifiedBy: actorUserId, financeVerifiedAt: now })
    .where(
      and(
        inArray(pettyCashRefillRequests.id, ids),
        eq(pettyCashRefillRequests.status, 'approved'),
        isNull(pettyCashRefillRequests.financeVerifiedAt),
      ),
    )
    .returning({
      id: pettyCashRefillRequests.id,
      storeId: pettyCashRefillRequests.storeId,
      requestedBy: pettyCashRefillRequests.requestedBy,
    });

  await Promise.all(
    rows.map((r) =>
      createNotificationsForUsers([r.requestedBy], {
        type: 'petty_cash_refill_verified',
        title: 'Refill petty cash sudah diproses Finance',
        body: 'Finance sudah memverifikasi Refill toko kamu. Setelah uangnya diterima, unggah foto laci petty cash dan Surat Terima.',
        link: '/employee/pettycash',
        relatedType: 'petty_cash_refill_request',
        relatedId: r.id,
      }),
    ),
  );

  return { changedIds: rows.map((r) => r.id), skipped: ids.length - rows.length };
}

/**
 * Finance takes a verification back (a mis-click, or the transfer bounced).
 * Only allowed while PIC 1 hasn't uploaded any proof photo — once they've
 * started confirming receipt the cash is already in their hands.
 */
export async function unverifyRefillRequests(ids: number[]): Promise<RefillVerifyResult> {
  if (ids.length === 0) return { changedIds: [], skipped: 0 };

  const rows = await db
    .update(pettyCashRefillRequests)
    .set({ financeVerifiedBy: null, financeVerifiedAt: null })
    .where(
      and(
        inArray(pettyCashRefillRequests.id, ids),
        eq(pettyCashRefillRequests.status, 'approved'),
        isNotNull(pettyCashRefillRequests.financeVerifiedAt),
        isNull(pettyCashRefillRequests.drawerPhotoUrl),
        isNull(pettyCashRefillRequests.signaturePhotoUrl),
      ),
    )
    .returning({ id: pettyCashRefillRequests.id });

  return { changedIds: rows.map((r) => r.id), skipped: ids.length - rows.length };
}

export type ProofPhotoKind = 'drawer' | 'signature';

/**
 * Any store employee attaches one of the two proof photos once OPS has
 * approved. Once BOTH the drawer photo and the Surat Terima Petty Cash photo
 * are in, this is the moment the cash is considered actually received — the
 * period's balance tops back up to the max right here, not at approval time.
 */
export async function attachRefillProof(
  id: number,
  storeId: number,
  userId: string,
  kind: ProofPhotoKind,
  imageUrl: string,
): Promise<RefillRequestResult> {
  const [existing] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Request not found.' };
  if (existing.storeId !== storeId) return { success: false, error: 'This request belongs to a different store.' };
  if (existing.status !== 'approved') {
    return { success: false, error: 'Proof photos can only be uploaded after OPS approves the refill.' };
  }
  // The store can only confirm receiving cash Finance has actually sent.
  if (!existing.financeVerifiedAt) {
    return {
      success: false,
      error: 'Finance belum memverifikasi Refill ini. Foto bukti bisa diunggah setelah Finance memprosesnya.',
    };
  }

  const columnKey = kind === 'drawer' ? 'drawerPhotoUrl' : 'signaturePhotoUrl';

  const [request] = await db
    .update(pettyCashRefillRequests)
    .set({
      [columnKey]: imageUrl,
      proofUploadedBy: userId,
      proofUploadedAt: new Date(),
    })
    .where(eq(pettyCashRefillRequests.id, id))
    .returning();

  if (!request) return { success: false, error: 'Failed to attach photo.' };

  const bothUploaded = Boolean(request.drawerPhotoUrl) && Boolean(request.signaturePhotoUrl);

  // Guard on balanceAfter still being unset so a retaken photo after the
  // top-up already happened doesn't add the money a second time.
  if (bothUploaded && !request.balanceAfter) {
    const currentPeriod = await getActivePeriod(existing.storeId, existing.yearMonth);

    if (currentPeriod.status === 'open') {
      const [updated] = await db
        .update(pettyCashRefillRequests)
        .set({ balanceAfter: String(PETTY_CASH_MAX_BALANCE), updatedAt: new Date() })
        .where(eq(pettyCashRefillRequests.id, id))
        .returning();

      // A refill received mid-month does NOT add money to the current
      // month — the current period's balance is left untouched so it keeps
      // reflecting what's actually been spent. The refill instead pre-loads
      // NEXT month's envelope at the max balance, so once the calendar rolls
      // over the store already has a fresh, full amount waiting.
      await topUpPeriodToMax(existing.storeId, addMonths(existing.yearMonth, 1));

      if (updated) {
        return { success: true, request: updated };
      }
    }
  }

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

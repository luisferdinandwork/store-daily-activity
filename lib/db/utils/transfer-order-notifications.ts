// lib/db/utils/transfer-order-notifications.ts
// ─────────────────────────────────────────────────────────────────────────────
// The "push" for Transfer Orders: when a store has a transfer order waiting on
// it, tell the staff who are scheduled there today — through the employee
// app's notification bell, which polls every minute.
//
//   Item Return   → the ORIGIN store: "ada TO menunggu diserahkan ke kurir"
//   Item Receiving→ the DESTINATION store: "ada kiriman menuju toko kamu"
//                   (announced when BC's Warehouse Shipment appears)
//
// Efficiency / correctness rules:
//  • One sweep for the whole company — a handful of queries, no per-store or
//    per-user loops against the DB beyond the (rare) stores that actually
//    have something new.
//  • Announced exactly once per leg: item_transfer_orders.return_notified_at /
//    dropping_notified_at are claimed with an atomic UPDATE ... WHERE NULL
//    before anything is sent, so two overlapping sweeps (cron + a page open)
//    can't double-send. If sending fails the claim is released.
//  • Grouped: several new orders for one store become ONE notification per
//    person (the first three are named), not a flood.
//  • A store nobody is scheduled at today is skipped and left un-announced —
//    the next sweep that finds somebody on the schedule delivers it. The
//    header badge (always on) covers the gap.
//  • Only recent orders are announced (TRANSFER_NOTIFY_MAX_AGE_MS): the badge
//    already shows an old backlog; re-announcing it as "new" would be noise.
//  • IT can stop it instantly: the `transfer_order_notifications` feature switch
//    (/it/feature-switches). A run may also be limited to given stores
//    (`storeIds`) — used to test against a dummy store without touching real ones.
//  • Same "still open" predicates as the badge and the entry backfill
//    (returnOpenWhere / droppingOpenWhere), so a notification never points at
//    something the page would not show as open.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { and, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { itemTransferOrders, notifications, schedules, stores, users } from '@/lib/db/schema';
import { jakartaDayRange, jakartaTodayKey } from '@/lib/day-bucket';
import { droppingOpenWhere, returnOpenWhere } from '@/lib/db/utils/item-transfers';
import { isFeatureEnabled } from '@/lib/db/utils/feature-switches';

export const TRANSFER_NOTIFY_MAX_AGE_MS = 3 * 86_400_000;

const EMPLOYEE_LINK = '/employee/item-transfers';
const MAX_NAMED = 3;

export type TransferLeg = 'return' | 'dropping';

export interface TransferNoticeItem {
  toaNo: string;
  /** The other end of the transfer: destination (return) or origin (dropping). */
  otherCode: string;
  qty: number;
}

export interface TransferNotice {
  type: string;
  title: string;
  body: string;
}

function named(items: TransferNoticeItem[], describe: (i: TransferNoticeItem) => string): string {
  const shown = items.slice(0, MAX_NAMED).map(describe).join(', ');
  return items.length > MAX_NAMED ? `${shown}, +${items.length - MAX_NAMED} lainnya` : shown;
}

/** Employee-facing copy (Indonesian, like the rest of the staff app). */
export function buildTransferNotice(leg: TransferLeg, items: TransferNoticeItem[]): TransferNotice {
  const n = items.length;
  if (leg === 'return') {
    return {
      type: 'transfer_order_return',
      title: n === 1 ? 'Transfer Order baru menunggu diambil kurir' : `${n} Transfer Order menunggu diambil kurir`,
      body: `${named(items, (i) => `${i.toaNo} → ${i.otherCode}`)}. Serahkan ke kurir lalu konfirmasi dengan foto di menu Transfer Order.`,
    };
  }
  return {
    type: 'transfer_order_dropping',
    title: n === 1 ? 'Ada kiriman menuju toko kamu' : `${n} kiriman menuju toko kamu`,
    body: `${named(items, (i) => `${i.toaNo} dari ${i.otherCode} (${i.qty} pcs)`)}. Konfirmasi saat barang diterima dari kurir.`,
  };
}

export interface TransferNotifyResult {
  /** Transfer-order legs announced this sweep. */
  transferOrders: number;
  /** Notification rows written (one per person per store per leg). */
  notifications: number;
  /** Stores that were told something. */
  stores: number;
}

interface Candidate extends TransferNoticeItem {
  id: number;
  storeId: number;
}

async function loadCandidates(leg: TransferLeg, cutoff: Date, onlyStores?: number[]): Promise<Candidate[]> {
  // BC's posting date (a plain date) must be recent too: the first sweep after
  // go-live "detects" every order already open in the look-back window right
  // now, and a fortnight-old transfer is not news — the badge covers it.
  const cutoffDay = new Date(cutoff.toISOString().slice(0, 10));
  const postedRecently = or(isNull(itemTransferOrders.postingDate), gte(itemTransferOrders.postingDate, cutoffDay));

  if (leg === 'return') {
    const rows = await db
      .select({
        id: itemTransferOrders.id,
        toaNo: itemTransferOrders.toaNo,
        storeId: itemTransferOrders.fromStoreId,
        otherCode: itemTransferOrders.transferToCode,
        qty: itemTransferOrders.qtyOrdered,
      })
      .from(itemTransferOrders)
      .where(and(
        returnOpenWhere(),
        onlyStores ? inArray(itemTransferOrders.fromStoreId, onlyStores) : undefined,
        isNull(itemTransferOrders.returnNotifiedAt),
        gte(itemTransferOrders.returnDetectedAt, cutoff),
        postedRecently,
      ))
      // Newest first: the notice names the first few, and those should be the
      // ones that just arrived.
      .orderBy(desc(itemTransferOrders.returnDetectedAt));
    return rows.filter((r): r is typeof r & { storeId: number } => r.storeId != null);
  }

  const rows = await db
    .select({
      id: itemTransferOrders.id,
      toaNo: itemTransferOrders.toaNo,
      storeId: itemTransferOrders.toStoreId,
      otherCode: itemTransferOrders.transferFromCode,
      qty: itemTransferOrders.qtyOrdered,
    })
    .from(itemTransferOrders)
    .where(and(
      droppingOpenWhere(),
      onlyStores ? inArray(itemTransferOrders.toStoreId, onlyStores) : undefined,
      isNull(itemTransferOrders.droppingNotifiedAt),
      gte(itemTransferOrders.droppingDetectedAt, cutoff),
      postedRecently,
    ))
    .orderBy(desc(itemTransferOrders.droppingDetectedAt));
  return rows.filter((r): r is typeof r & { storeId: number } => r.storeId != null);
}

/** Atomically takes the "announce" stamp; returns the ids this caller won. */
async function claim(leg: TransferLeg, ids: number[], at: Date): Promise<Set<number>> {
  const won = leg === 'return'
    ? await db.update(itemTransferOrders)
        .set({ returnNotifiedAt: at })
        .where(and(inArray(itemTransferOrders.id, ids), isNull(itemTransferOrders.returnNotifiedAt)))
        .returning({ id: itemTransferOrders.id })
    : await db.update(itemTransferOrders)
        .set({ droppingNotifiedAt: at })
        .where(and(inArray(itemTransferOrders.id, ids), isNull(itemTransferOrders.droppingNotifiedAt)))
        .returning({ id: itemTransferOrders.id });
  return new Set(won.map((r) => r.id));
}

async function release(leg: TransferLeg, ids: number[]): Promise<void> {
  if (leg === 'return') {
    await db.update(itemTransferOrders).set({ returnNotifiedAt: null }).where(inArray(itemTransferOrders.id, ids));
  } else {
    await db.update(itemTransferOrders).set({ droppingNotifiedAt: null }).where(inArray(itemTransferOrders.id, ids));
  }
}

/**
 * Announces every not-yet-announced open transfer order to the staff
 * scheduled today at the store that has to act on it. Safe to call as often
 * as you like — it does nothing when there is nothing new.
 */
export async function notifyStoresOfOpenTransfers(
  opts: { storeIds?: number[] } = {},
): Promise<TransferNotifyResult> {
  const result: TransferNotifyResult = { transferOrders: 0, notifications: 0, stores: 0 };
  // IT's kill switch (fails to its default — on — if it can't be read).
  if (!(await isFeatureEnabled('transfer_order_notifications'))) return result;
  if (opts.storeIds && opts.storeIds.length === 0) return result;

  const cutoff = new Date(Date.now() - TRANSFER_NOTIFY_MAX_AGE_MS);

  const [returnRows, droppingRows] = await Promise.all([
    loadCandidates('return', cutoff, opts.storeIds),
    loadCandidates('dropping', cutoff, opts.storeIds),
  ]);
  if (returnRows.length === 0 && droppingRows.length === 0) return result;

  // Who is on today's schedule at those stores. `schedules.date` holds Jakarta
  // days in two encodings — a [start, end) range of the Jakarta day catches both.
  const storeIds = [...new Set([...returnRows, ...droppingRows].map((r) => r.storeId))];
  const { start, end } = jakartaDayRange(jakartaTodayKey());
  const staffRows = await db
    .selectDistinct({ storeId: schedules.storeId, userId: schedules.userId })
    .from(schedules)
    .innerJoin(stores, eq(stores.id, schedules.storeId))
    .innerJoin(users, eq(users.id, schedules.userId))
    .where(and(
      inArray(schedules.storeId, storeIds),
      eq(stores.status, 'active'),
      eq(schedules.isHoliday, false),
      gte(schedules.date, start),
      lt(schedules.date, end),
      eq(users.isActive, true),
      isNull(users.deletedAt),
    ));

  const staffByStore = new Map<number, string[]>();
  for (const { storeId, userId } of staffRows) {
    const list = staffByStore.get(storeId) ?? [];
    list.push(userId);
    staffByStore.set(storeId, list);
  }

  const now = new Date();
  const told = new Set<number>();

  for (const leg of ['return', 'dropping'] as const) {
    const rows = leg === 'return' ? returnRows : droppingRows;

    const byStore = new Map<number, Candidate[]>();
    for (const r of rows) {
      const list = byStore.get(r.storeId) ?? [];
      list.push(r);
      byStore.set(r.storeId, list);
    }

    for (const [storeId, items] of byStore) {
      const recipients = staffByStore.get(storeId);
      if (!recipients?.length) continue; // nobody scheduled — try again next sweep

      const won = await claim(leg, items.map((i) => i.id), now);
      const claimed = items.filter((i) => won.has(i.id));
      if (claimed.length === 0) continue; // a concurrent sweep already told them

      const notice = buildTransferNotice(leg, claimed);
      try {
        await db.insert(notifications).values(recipients.map((userId) => ({
          userId,
          type: notice.type,
          title: notice.title,
          body: notice.body,
          link: EMPLOYEE_LINK,
          relatedType: 'transfer_order_store',
          relatedId: storeId,
          // Explicit: defaultNow() would read back 7h ahead (see the note in
          // lib/db/utils/notifications.ts), pinning "just now" for 7 hours.
          createdAt: now,
        })));
      } catch (err) {
        await release(leg, claimed.map((i) => i.id)).catch(() => {});
        throw err;
      }

      result.transferOrders += claimed.length;
      result.notifications += recipients.length;
      told.add(storeId);
    }
  }

  result.stores = told.size;
  return result;
}

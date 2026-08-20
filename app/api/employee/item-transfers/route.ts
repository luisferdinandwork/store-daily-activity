// app/api/employee/item-transfers/route.ts
//
// Standalone, on-demand Item Dropping (Receiving) + Item Return view — no
// longer tied to the daily task checklist (see lib/shift-tasks.ts for why:
// both are BC-driven with no manual completion path, so they used to sit
// "pending" forever whenever Business Central had nothing for a store that
// day). This resolves the employee's own schedule for today, ensures the
// container rows exist (created lazily here instead of via the old daily
// materialization), live-syncs Business Central, and returns both flows'
// entries in one payload.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { schedules, stores } from '@/lib/db/schema';
import { todayInStoreTimezone } from '@/lib/schedule-utils';
import { getOrCreateItemDroppingForSchedule } from '@/lib/db/utils/item-dropping';
import { getOrCreateItemReturnForSchedule } from '@/lib/db/utils/item-return';
import {
  syncItemDroppingForStore,
  syncItemReturnForStore,
  getItemDroppingEntriesWithTransferOrder,
  getItemReturnEntriesWithTransferOrder,
} from '@/lib/db/utils/item-transfers';

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function parseWhseShipmentLines(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  const today = todayInStoreTimezone();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  // A cross-store employee could have more than one schedule today — this
  // view focuses on the primary (first) one, same scope a single BC-driven
  // task page always had.
  const [schedule] = await db
    .select({ id: schedules.id, storeId: schedules.storeId, shiftId: schedules.shiftId })
    .from(schedules)
    .where(and(
      eq(schedules.userId, userId),
      eq(schedules.isHoliday, false),
      gte(schedules.date, dayStart),
      lte(schedules.date, dayEnd),
    ))
    .limit(1);

  if (!schedule) {
    return NextResponse.json({
      success: true,
      scheduleId: null,
      storeId: null,
      dropping: { entries: [], syncWarning: null },
      return: { entries: [], syncWarning: null },
    });
  }

  const [droppingRows, returnRows] = await Promise.all([
    getOrCreateItemDroppingForSchedule(schedule.id, userId, schedule.storeId, schedule.shiftId, today),
    getOrCreateItemReturnForSchedule(schedule.id, userId, schedule.storeId, schedule.shiftId, today),
  ]);

  const [droppingSyncResults, returnSyncResults] = await Promise.all([
    Promise.all(droppingRows.map((row) =>
      syncItemDroppingForStore(schedule.storeId, {
        scheduleId: schedule.id,
        userId,
        date: today,
        shiftId: row.shiftId,
      }),
    )),
    Promise.all(returnRows.map((row) =>
      syncItemReturnForStore(schedule.storeId, {
        scheduleId: schedule.id,
        userId,
        date: today,
        shiftId: row.shiftId,
      }),
    )),
  ]);

  const droppingSyncWarning = droppingSyncResults.find((r) => !r.success)?.error ?? null;
  const returnSyncWarning = returnSyncResults.find((r) => !r.success)?.error ?? null;

  const [droppingEntryGroups, returnEntryGroups] = await Promise.all([
    Promise.all(droppingRows.map((row) => getItemDroppingEntriesWithTransferOrder(row.id))),
    Promise.all(returnRows.map((row) => getItemReturnEntriesWithTransferOrder(row.id))),
  ]);

  const droppingRaw = droppingEntryGroups.flat();
  const returnRaw = returnEntryGroups.flat();

  const storeIds = [...new Set(
    [...droppingRaw, ...returnRaw]
      .flatMap((r) => [r.transferOrder?.fromStoreId, r.transferOrder?.toStoreId])
      .filter((v): v is number => v != null),
  )];

  const storeRows = storeIds.length
    ? await db.select({ id: stores.id, name: stores.name, storeNo: stores.storeNo })
        .from(stores).where(inArray(stores.id, storeIds))
    : [];
  const storeById = new Map(storeRows.map((s) => [s.id, s]));

  const droppingEntries = droppingRaw.map(({ entry, transferOrder }) => ({
    id: String(entry.id),
    toaNo: entry.toNumber,
    qtyOrdered: entry.qtyOrdered ?? entry.quantity,
    qtyCounted: entry.qtyCounted,
    courierSignPhoto: entry.courierSignPhoto,
    submittedAt: entry.submittedAt?.toISOString() ?? null,
    fromStore: transferOrder?.fromStoreId ? storeById.get(transferOrder.fromStoreId) ?? null : null,
    toStore: transferOrder?.toStoreId ? storeById.get(transferOrder.toStoreId) ?? null : null,
    transferFromCode: transferOrder?.transferFromCode ?? null,
    transferToCode: transferOrder?.transferToCode ?? null,
    bcStatus: transferOrder?.bcStatus ?? null,
    whseShipmentNo: transferOrder?.whseShipmentNo ?? null,
    whseShipmentLines: parseWhseShipmentLines(transferOrder?.whseShipmentLines ?? null),
    // Start = when the origin store actually submitted the Item Return on
    // this website (returnSubmittedAt) — NOT when our sync first fetched/
    // detected the shipment from BC. End = when BC's Posted Whse Receipts
    // confirms the warehouse actually posted the receipt (receivedAt), not
    // when this store's employee locally taps "confirm receiving" (that's
    // just the physical hand-off scan, not the system-of-record event).
    inTransitSince: transferOrder?.returnSubmittedAt?.toISOString() ?? null,
    receivedAt: transferOrder?.receivedAt?.toISOString() ?? null,
  }));

  const returnEntries = returnRaw.map(({ entry, transferOrder }) => ({
    id: String(entry.id),
    toaNo: entry.returnNumber,
    qtyOrdered: entry.qtyOrdered ?? entry.quantity,
    qtyCounted: entry.qtyCounted,
    courierSignPhoto: entry.courierSignPhoto,
    submittedAt: entry.submittedAt?.toISOString() ?? null,
    fromStore: transferOrder?.fromStoreId ? storeById.get(transferOrder.fromStoreId) ?? null : null,
    toStore: transferOrder?.toStoreId ? storeById.get(transferOrder.toStoreId) ?? null : null,
    transferFromCode: transferOrder?.transferFromCode ?? null,
    transferToCode: transferOrder?.transferToCode ?? null,
    bcStatus: transferOrder?.bcStatus ?? null,
    returnDetectedAt: (transferOrder?.returnDetectedAt ?? entry.createdAt)?.toISOString() ?? null,
  }));

  return NextResponse.json({
    success: true,
    scheduleId: schedule.id,
    storeId: schedule.storeId,
    dropping: { entries: droppingEntries, syncWarning: droppingSyncWarning },
    return: { entries: returnEntries, syncWarning: returnSyncWarning },
  });
}

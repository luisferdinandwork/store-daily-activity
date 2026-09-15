// app/api/employee/item-transfers/pending-count/route.ts
//
// Lightweight, DB-only count for the header badge — deliberately does NOT
// trigger a live Business Central sync (see app/api/employee/item-transfers
// for that), so it's cheap enough to poll every minute. Reads straight off
// the store-agnostic item_transfer_orders registry (kept warm by the OPS
// dashboard's own sync) rather than the employee's own container rows, so a
// fresh delivery still shows up here even before the employee has opened
// the Item Transfers page for the first time today.
//
// Uses the exact same getOpenTransferOrdersForStore query the sync functions
// backfill entries from (lib/db/utils/item-transfers.ts) — this count and
// what actually shows up as an open entry on the employee's own page can no
// longer drift apart, because they're the same query, not two independently
// maintained ones.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { and, eq, gte, lte } from 'drizzle-orm';
import { schedules } from '@/lib/db/schema';
import { todayInStoreTimezone } from '@/lib/schedule-utils';
import { getOpenTransferOrdersForStore } from '@/lib/db/utils/item-transfers';

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, count: 0 }, { status: 401 });
  }
  const userId = session.user.id as string;

  const today = todayInStoreTimezone();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  const [schedule] = await db
    .select({ storeId: schedules.storeId })
    .from(schedules)
    .where(and(
      eq(schedules.userId, userId),
      eq(schedules.isHoliday, false),
      gte(schedules.date, dayStart),
      lte(schedules.date, dayEnd),
    ))
    .limit(1);

  if (!schedule) {
    return NextResponse.json({ success: true, count: 0 });
  }

  const { returnOpen, droppingOpen } = await getOpenTransferOrdersForStore(schedule.storeId);

  return NextResponse.json({ success: true, count: returnOpen.length + droppingOpen.length });
}

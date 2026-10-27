// app/api/employee/item-transfers/pending-count/route.ts
//
// Lightweight count for the header badge, polled by every employee with the
// app open — so it must stay cheap: two `count(*)` queries against the
// registry (no Business Central call, no row payloads).
//
// It uses the same predicates the entry backfill and the "new transfer order"
// notification use (returnOpenWhere / droppingOpenWhere in
// lib/db/utils/item-transfers.ts), so the number here, the list on the page
// and the notification can never disagree.
//
// The registry itself is kept warm by /api/cron/transfer-orders. As a safety
// net — cron not installed yet, or the server just restarted — a poll that
// finds the registry stale kicks off the same throttled, single-flight refresh
// in the background (never awaited: the response stays instant, and however
// many employees poll, BC is swept at most once per window).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { and, eq, gte, lt } from 'drizzle-orm';
import { schedules, stores } from '@/lib/db/schema';
import { jakartaDayRange, jakartaTodayKey } from '@/lib/day-bucket';
import { countOpenTransferOrdersForStore } from '@/lib/db/utils/item-transfers';
import { refreshTransferRegistry } from '@/lib/db/utils/transfer-order-refresh';

const LAZY_REFRESH_MAX_AGE_MS = 5 * 60_000;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, count: 0 }, { status: 401 });
  }
  const userId = session.user.id as string;

  // Jakarta calendar day, whatever zone the server runs in.
  const { start, end } = jakartaDayRange(jakartaTodayKey());

  const [schedule] = await db
    .select({ storeId: schedules.storeId })
    .from(schedules)
    .innerJoin(stores, eq(stores.id, schedules.storeId))
    .where(and(
      eq(schedules.userId, userId),
      eq(schedules.isHoliday, false),
      // Same scope as the page (GET /api/employee/item-transfers): prep /
      // closed stores have no Transfer Orders page, so no badge either.
      eq(stores.status, 'active'),
      gte(schedules.date, start),
      lt(schedules.date, end),
    ))
    .limit(1);

  if (!schedule) {
    return NextResponse.json({ success: true, count: 0, returnCount: 0, droppingCount: 0 });
  }

  void refreshTransferRegistry({ maxAgeMs: LAZY_REFRESH_MAX_AGE_MS });

  const { returnOpen, droppingOpen } = await countOpenTransferOrdersForStore(schedule.storeId);

  return NextResponse.json({
    success: true,
    count: returnOpen + droppingOpen,
    returnCount: returnOpen,
    droppingCount: droppingOpen,
  });
}

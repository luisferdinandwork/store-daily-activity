// app/api/ops/tasks/progress/range/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpsActor, parseDate } from '../../_helpers';
import { getStoreSummariesForRange } from '@/lib/db/utils/tasks';
import { db } from '@/lib/db';
import { stores, areas } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { users } from '@/lib/db/schema';

// GET /api/ops/tasks/progress/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Optional: &storeIds=1,2,3  (HO only; area actors always get their own stores)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const actor = await getOpsActor(session.user.id);
  if (!actor) {
    return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;

  const startParsed = parseDate(sp.get('startDate') ?? '');
  const endParsed   = parseDate(sp.get('endDate') ?? '');

  if (!startParsed.ok) return NextResponse.json({ success: false, error: startParsed.error }, { status: 400 });
  if (!endParsed.ok)   return NextResponse.json({ success: false, error: endParsed.error },   { status: 400 });

  // Resolve which stores this actor can see
  let allowedStoreIds: number[];

  if (actor.isOpsHo) {
    const rawIds = sp.get('storeIds');
    if (rawIds) {
      allowedStoreIds = rawIds.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0);
    } else {
      const rows = await db.select({ id: stores.id }).from(stores);
      allowedStoreIds = rows.map(r => r.id);
    }
  } else {
    const [opsUser] = await db
      .select({ areaId: users.areaId })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);

    if (!opsUser?.areaId) {
      return NextResponse.json({ success: true, summaries: [], stores: [] });
    }

    const areaStores = await db
      .select({ id: stores.id, name: stores.name, address: stores.address, areaId: stores.areaId })
      .from(stores)
      .where(eq(stores.areaId, opsUser.areaId));

    allowedStoreIds = areaStores.map(s => s.id);
  }

  if (!allowedStoreIds.length) {
    return NextResponse.json({ success: true, summaries: [], stores: [] });
  }

  // Fetch store metadata + range summaries in parallel
  const [storeRows, summaries] = await Promise.all([
    db
      .select({ id: stores.id, name: stores.name, address: stores.address, areaId: stores.areaId, areaName: areas.name })
      .from(stores)
      .leftJoin(areas, eq(stores.areaId, areas.id))
      .where(inArray(stores.id, allowedStoreIds)),
    getStoreSummariesForRange(allowedStoreIds, startParsed.date, endParsed.date),
  ]);

  return NextResponse.json({
    success: true,
    startDate: sp.get('startDate'),
    endDate:   sp.get('endDate'),
    stores: storeRows.map(s => ({
      id:       String(s.id),
      name:     s.name,
      address:  s.address,
      areaId:   s.areaId   != null ? String(s.areaId)   : null,
      areaName: s.areaName ?? null,
    })),
    summaries: summaries.map(s => ({
      storeId:     String(s.storeId),
      date:        s.date,
      pending:     s.pending,
      inProgress:  s.inProgress,
      completed:   s.completed,
      discrepancy: s.discrepancy,
      verified:    'verified' in s ? Number((s as { verified?: number }).verified ?? 0) : 0,
      rejected:    'rejected' in s ? Number((s as { rejected?: number }).rejected ?? 0) : 0,
      total:       s.total,
    })),
  });
}

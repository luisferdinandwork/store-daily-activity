// app/api/ops/tasks/stores/route.ts
import { NextRequest, NextResponse }  from 'next/server';
import { getServerSession }           from 'next-auth';
import { authOptions }                from '@/lib/auth';
import { db }                         from '@/lib/db';
import { users, stores, areas, userRoles,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, receivingTasks, briefingTasks,
  edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { and, eq, gte, lte, sql }     from 'drizzle-orm';

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

async function resolveOpsActor(userId: string) {
  const [row] = await db
    .select({ roleCode: userRoles.code, areaId: users.areaId })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  if (row.roleCode !== 'ops') return null;
  return { areaId: row.areaId };
}

// GET /api/ops/tasks/stores?date=YYYY-MM-DD
// Returns stores in OPS area + per-store task completion summary for the day.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = (session.user as any).id as string;
    const actor  = await resolveOpsActor(userId);
    if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
    if (!actor.areaId) return NextResponse.json({ success: false, error: 'No area assigned.' }, { status: 400 });

    const dateParam = req.nextUrl.searchParams.get('date');
    let targetDate: Date;
    if (dateParam) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
      targetDate = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
        : new Date();
    } else {
      targetDate = new Date();
    }
    const dayStart = startOfDay(targetDate);
    const dayEnd   = endOfDay(targetDate);

    // Get area info
    const [area] = await db
      .select({ id: areas.id, name: areas.name })
      .from(areas)
      .where(eq(areas.id, actor.areaId))
      .limit(1);

    // Get stores in area
    const areaStores = await db
      .select({ id: stores.id, name: stores.name, address: stores.address })
      .from(stores)
      .where(eq(stores.areaId, actor.areaId))
      .orderBy(stores.name);

    if (!areaStores.length) {
      return NextResponse.json({ success: true, stores: [], area: area ?? null });
    }

    const storeIds = areaStores.map(s => s.id);

    // For each store, count task statuses for this day
    // We count across all task tables: completed + verified = "done", pending + in_progress = "pending"
    // We use raw SQL aggregation per store for efficiency
    const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11] = await Promise.all([
      db.select({ storeId: storeOpeningTasks.storeId, status: storeOpeningTasks.status, count: sql<number>`count(*)::int` }).from(storeOpeningTasks).where(and(gte(storeOpeningTasks.date, dayStart), lte(storeOpeningTasks.date, dayEnd))).groupBy(storeOpeningTasks.storeId, storeOpeningTasks.status),
      db.select({ storeId: setoranTasks.storeId, status: setoranTasks.status, count: sql<number>`count(*)::int` }).from(setoranTasks).where(and(gte(setoranTasks.date, dayStart), lte(setoranTasks.date, dayEnd))).groupBy(setoranTasks.storeId, setoranTasks.status),
      db.select({ storeId: cekBinTasks.storeId, status: cekBinTasks.status, count: sql<number>`count(*)::int` }).from(cekBinTasks).where(and(gte(cekBinTasks.date, dayStart), lte(cekBinTasks.date, dayEnd))).groupBy(cekBinTasks.storeId, cekBinTasks.status),
      db.select({ storeId: productCheckTasks.storeId, status: productCheckTasks.status, count: sql<number>`count(*)::int` }).from(productCheckTasks).where(and(gte(productCheckTasks.date, dayStart), lte(productCheckTasks.date, dayEnd))).groupBy(productCheckTasks.storeId, productCheckTasks.status),
      db.select({ storeId: receivingTasks.storeId, status: receivingTasks.status, count: sql<number>`count(*)::int` }).from(receivingTasks).where(and(gte(receivingTasks.date, dayStart), lte(receivingTasks.date, dayEnd))).groupBy(receivingTasks.storeId, receivingTasks.status),
      db.select({ storeId: briefingTasks.storeId, status: briefingTasks.status, count: sql<number>`count(*)::int` }).from(briefingTasks).where(and(gte(briefingTasks.date, dayStart), lte(briefingTasks.date, dayEnd))).groupBy(briefingTasks.storeId, briefingTasks.status),
      db.select({ storeId: edcSummaryTasks.storeId, status: edcSummaryTasks.status, count: sql<number>`count(*)::int` }).from(edcSummaryTasks).where(and(gte(edcSummaryTasks.date, dayStart), lte(edcSummaryTasks.date, dayEnd))).groupBy(edcSummaryTasks.storeId, edcSummaryTasks.status),
      db.select({ storeId: edcSettlementTasks.storeId, status: edcSettlementTasks.status, count: sql<number>`count(*)::int` }).from(edcSettlementTasks).where(and(gte(edcSettlementTasks.date, dayStart), lte(edcSettlementTasks.date, dayEnd))).groupBy(edcSettlementTasks.storeId, edcSettlementTasks.status),
      db.select({ storeId: eodZReportTasks.storeId, status: eodZReportTasks.status, count: sql<number>`count(*)::int` }).from(eodZReportTasks).where(and(gte(eodZReportTasks.date, dayStart), lte(eodZReportTasks.date, dayEnd))).groupBy(eodZReportTasks.storeId, eodZReportTasks.status),
      db.select({ storeId: openStatementTasks.storeId, status: openStatementTasks.status, count: sql<number>`count(*)::int` }).from(openStatementTasks).where(and(gte(openStatementTasks.date, dayStart), lte(openStatementTasks.date, dayEnd))).groupBy(openStatementTasks.storeId, openStatementTasks.status),
      db.select({ storeId: groomingTasks.storeId, status: groomingTasks.status, count: sql<number>`count(*)::int` }).from(groomingTasks).where(and(gte(groomingTasks.date, dayStart), lte(groomingTasks.date, dayEnd))).groupBy(groomingTasks.storeId, groomingTasks.status),
    ]);

    // Aggregate per store
    const allCounts = [...r1, ...r2, ...r3, ...r4, ...r5, ...r6, ...r7, ...r8, ...r9, ...r10, ...r11];

    type StoreSummary = {
      pending: number; inProgress: number; completed: number;
      verified: number; rejected: number; total: number;
    };
    const summaryMap: Record<number, StoreSummary> = {};
    for (const s of storeIds) {
      summaryMap[s] = { pending: 0, inProgress: 0, completed: 0, verified: 0, rejected: 0, total: 0 };
    }
    for (const row of allCounts) {
      if (!storeIds.includes(row.storeId)) continue;
      const m = summaryMap[row.storeId];
      const c = row.count ?? 0;
      m.total += c;
      if (row.status === 'pending')     m.pending    += c;
      if (row.status === 'in_progress') m.inProgress += c;
      if (row.status === 'completed')   m.completed  += c;
      if (row.status === 'verified')    m.verified   += c;
      if (row.status === 'rejected')    m.rejected   += c;
    }

    const result = areaStores.map(s => ({
      ...s,
      id:      String(s.id),
      summary: summaryMap[s.id],
    }));

    return NextResponse.json({ success: true, stores: result, area: area ?? null });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
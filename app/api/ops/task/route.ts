// app/api/ops/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import {
  stores, users, schedules, userRoles, shifts,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, receivingTasks, briefingTasks,
  edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { and, eq, gte, lte, inArray } from 'drizzle-orm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Verify actor is OPS and return their areaId */
async function resolveOpsActor(userId: string): Promise<{ areaId: number | null; error?: string }> {
  const [row] = await db
    .select({ roleCode: userRoles.code, areaId: users.areaId })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return { areaId: null, error: 'User not found.' };
  if (row.roleCode !== 'ops') return { areaId: null, error: 'Only OPS users can access this resource.' };
  if (!row.areaId) return { areaId: null, error: 'OPS user has no area assigned.' };
  return { areaId: row.areaId };
}

// ─── GET /api/ops/tasks ───────────────────────────────────────────────────────
// Query params: storeId (required), date (optional, YYYY-MM-DD, defaults today)
// Returns all tasks across all employees for that store on that date.

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = (session.user as any).id as string;
    const { areaId, error: actorError } = await resolveOpsActor(userId);
    if (actorError) return NextResponse.json({ success: false, error: actorError }, { status: 403 });

    const storeId   = Number(req.nextUrl.searchParams.get('storeId'));
    const dateParam = req.nextUrl.searchParams.get('date');

    if (!storeId || isNaN(storeId)) {
      return NextResponse.json({ success: false, error: 'storeId required.' }, { status: 400 });
    }

    // Confirm this store is in the OPS user's area
    const [store] = await db
      .select({ areaId: stores.areaId, name: stores.name })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (!store) return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
    if (store.areaId !== areaId) {
      return NextResponse.json({ success: false, error: 'Store is not in your area.' }, { status: 403 });
    }

    // Parse target date
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

    // Build shift code map
    const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
    const shiftCodeMap = Object.fromEntries(shiftRows.map(r => [r.id, r.code])) as Record<number, string>;

    // Fetch all task types in parallel for this store + date
    const [
      openingRows, setoranRows, cekBinRows, productCheckRows, receivingRows,
      briefingRows, edcSummaryRows, edcSettlementRows, eodZReportRows, openStatementRows,
      groomingRows,
    ] = await Promise.all([
      db.select().from(storeOpeningTasks) .where(and(eq(storeOpeningTasks.storeId,  storeId), gte(storeOpeningTasks.date,  dayStart), lte(storeOpeningTasks.date,  dayEnd))),
      db.select().from(setoranTasks)      .where(and(eq(setoranTasks.storeId,       storeId), gte(setoranTasks.date,       dayStart), lte(setoranTasks.date,       dayEnd))),
      db.select().from(cekBinTasks)       .where(and(eq(cekBinTasks.storeId,        storeId), gte(cekBinTasks.date,        dayStart), lte(cekBinTasks.date,        dayEnd))),
      db.select().from(productCheckTasks) .where(and(eq(productCheckTasks.storeId,  storeId), gte(productCheckTasks.date,  dayStart), lte(productCheckTasks.date,  dayEnd))),
      db.select().from(receivingTasks)    .where(and(eq(receivingTasks.storeId,     storeId), gte(receivingTasks.date,     dayStart), lte(receivingTasks.date,     dayEnd))),
      db.select().from(briefingTasks)     .where(and(eq(briefingTasks.storeId,      storeId), gte(briefingTasks.date,      dayStart), lte(briefingTasks.date,      dayEnd))),
      db.select().from(edcSummaryTasks)   .where(and(eq(edcSummaryTasks.storeId,    storeId), gte(edcSummaryTasks.date,    dayStart), lte(edcSummaryTasks.date,    dayEnd))),
      db.select().from(edcSettlementTasks).where(and(eq(edcSettlementTasks.storeId, storeId), gte(edcSettlementTasks.date, dayStart), lte(edcSettlementTasks.date, dayEnd))),
      db.select().from(eodZReportTasks)   .where(and(eq(eodZReportTasks.storeId,    storeId), gte(eodZReportTasks.date,    dayStart), lte(eodZReportTasks.date,    dayEnd))),
      db.select().from(openStatementTasks).where(and(eq(openStatementTasks.storeId, storeId), gte(openStatementTasks.date, dayStart), lte(openStatementTasks.date, dayEnd))),
      db.select().from(groomingTasks)     .where(and(eq(groomingTasks.storeId,      storeId), gte(groomingTasks.date,      dayStart), lte(groomingTasks.date,      dayEnd))),
    ]);

    // Collect all unique userIds for a single batch name lookup
    const allUserIds = new Set<string>();
    const allRows = [
      ...openingRows, ...setoranRows, ...cekBinRows, ...productCheckRows, ...receivingRows,
      ...briefingRows, ...edcSummaryRows, ...edcSettlementRows, ...eodZReportRows, ...openStatementRows,
      ...groomingRows,
    ];
    for (const r of allRows) allUserIds.add(r.userId);

    const userNameMap: Record<string, string> = {};
    if (allUserIds.size > 0) {
      const userRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, [...allUserIds]));
      for (const u of userRows) userNameMap[u.id] = u.name;
    }

    // Shape tasks
    function base(t: { id: number; scheduleId: number; userId: string; storeId: number; shiftId: number; date: Date; status: string | null; notes: string | null; completedAt: Date | null; verifiedBy: string | null; verifiedAt: Date | null }) {
      return {
        id:          String(t.id),
        scheduleId:  String(t.scheduleId),
        userId:      t.userId,
        userName:    userNameMap[t.userId] ?? t.userId,
        storeId:     String(t.storeId),
        shift:       shiftCodeMap[t.shiftId] ?? null,
        date:        t.date.toISOString(),
        status:      t.status,
        notes:       t.notes,
        completedAt: toIso(t.completedAt),
        verifiedBy:  t.verifiedBy,
        verifiedAt:  toIso(t.verifiedAt),
      };
    }

    const tasks = [
      ...openingRows.map(t => ({
        type: 'store_opening' as const,
        ...base(t),
        extra: {
          loginPos: t.loginPos, checkAbsenSunfish: t.checkAbsenSunfish,
          tarikSohSales: t.tarikSohSales, fiveR: t.fiveR,
          cekLamp: t.cekLamp, cekSoundSystem: t.cekSoundSystem,
          storeFrontPhotos: parsePhotos(t.storeFrontPhotos),
          cashDrawerPhotos: parsePhotos(t.cashDrawerPhotos),
        },
      })),
      ...setoranRows.map(t => ({
        type: 'setoran' as const,
        ...base(t),
        extra: { amount: t.amount, linkSetoran: t.linkSetoran, moneyPhotos: parsePhotos(t.moneyPhotos) },
      })),
      ...cekBinRows.map(t => ({ type: 'cek_bin' as const, ...base(t), extra: {} })),
      ...productCheckRows.map(t => ({
        type: 'product_check' as const,
        ...base(t),
        extra: { display: t.display, price: t.price, saleTag: t.saleTag, shoeFiller: t.shoeFiller, labelIndo: t.labelIndo, barcode: t.barcode },
      })),
      ...receivingRows.map(t => ({
        type: 'receiving' as const,
        ...base(t),
        extra: { hasReceiving: t.hasReceiving, receivingPhotos: parsePhotos(t.receivingPhotos) },
      })),
      ...briefingRows.map(t => ({ type: 'briefing' as const, ...base(t), extra: { done: t.done } })),
      ...edcSummaryRows.map(t => ({ type: 'edc_summary' as const, ...base(t), extra: { photos: parsePhotos(t.edcSummaryPhotos) } })),
      ...edcSettlementRows.map(t => ({ type: 'edc_settlement' as const, ...base(t), extra: { photos: parsePhotos(t.edcSettlementPhotos) } })),
      ...eodZReportRows.map(t => ({ type: 'eod_z_report' as const, ...base(t), extra: { photos: parsePhotos(t.zReportPhotos) } })),
      ...openStatementRows.map(t => ({ type: 'open_statement' as const, ...base(t), extra: { photos: parsePhotos(t.openStatementPhotos) } })),
      ...groomingRows.map(t => ({
        type: 'grooming' as const,
        ...base(t),
        extra: {
          uniformActive: t.uniformActive, hairActive: t.hairActive, nailsActive: t.nailsActive,
          accessoriesActive: t.accessoriesActive, shoeActive: t.shoeActive,
          uniformComplete: t.uniformComplete, hairGroomed: t.hairGroomed, nailsClean: t.nailsClean,
          accessoriesCompliant: t.accessoriesCompliant, shoeCompliant: t.shoeCompliant,
          selfiePhotos: parsePhotos(t.selfiePhotos),
        },
      })),
    ];

    // Summary counts
    const summary = {
      total:      tasks.length,
      pending:    tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      completed:  tasks.filter(t => t.status === 'completed').length,
      verified:   tasks.filter(t => t.status === 'verified').length,
      rejected:   tasks.filter(t => t.status === 'rejected').length,
    };

    return NextResponse.json({ success: true, tasks, summary, storeName: store.name });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PATCH /api/ops/tasks ─────────────────────────────────────────────────────
// Body: { taskId, taskType, action: 'verify' | 'reject', notes? }

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = (session.user as any).id as string;
    const { areaId, error: actorError } = await resolveOpsActor(userId);
    if (actorError) return NextResponse.json({ success: false, error: actorError }, { status: 403 });

    const body = await req.json() as {
      taskId:   string;
      taskType: string;
      storeId:  number;
      action:   'verify' | 'reject';
      notes?:   string;
    };

    const { taskId, taskType, storeId, action, notes } = body;
    if (!taskId || !taskType || !storeId || !action) {
      return NextResponse.json({ success: false, error: 'taskId, taskType, storeId, and action are required.' }, { status: 400 });
    }

    // Confirm store is in actor's area
    const [store] = await db
      .select({ areaId: stores.areaId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (!store) return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
    if (store.areaId !== areaId) return NextResponse.json({ success: false, error: 'Store is not in your area.' }, { status: 403 });

    const id        = Number(taskId);
    const newStatus = action === 'verify' ? 'verified' : 'rejected';
    const patch     = { status: newStatus as any, verifiedBy: userId, verifiedAt: new Date(), notes: notes ?? null, updatedAt: new Date() };

    // Map taskType → table update
    const TABLE_MAP: Record<string, () => Promise<void>> = {
      store_opening:  () => db.update(storeOpeningTasks) .set(patch).where(eq(storeOpeningTasks.id,  id)).then(() => {}),
      setoran:        () => db.update(setoranTasks)      .set(patch).where(eq(setoranTasks.id,       id)).then(() => {}),
      cek_bin:        () => db.update(cekBinTasks)       .set(patch).where(eq(cekBinTasks.id,        id)).then(() => {}),
      product_check:  () => db.update(productCheckTasks) .set(patch).where(eq(productCheckTasks.id,  id)).then(() => {}),
      receiving:      () => db.update(receivingTasks)    .set(patch).where(eq(receivingTasks.id,     id)).then(() => {}),
      briefing:       () => db.update(briefingTasks)     .set(patch).where(eq(briefingTasks.id,      id)).then(() => {}),
      edc_summary:    () => db.update(edcSummaryTasks)   .set(patch).where(eq(edcSummaryTasks.id,    id)).then(() => {}),
      edc_settlement: () => db.update(edcSettlementTasks).set(patch).where(eq(edcSettlementTasks.id, id)).then(() => {}),
      eod_z_report:   () => db.update(eodZReportTasks)   .set(patch).where(eq(eodZReportTasks.id,    id)).then(() => {}),
      open_statement: () => db.update(openStatementTasks).set(patch).where(eq(openStatementTasks.id, id)).then(() => {}),
      grooming:       () => db.update(groomingTasks)     .set(patch).where(eq(groomingTasks.id,      id)).then(() => {}),
    };

    const handler = TABLE_MAP[taskType];
    if (!handler) return NextResponse.json({ success: false, error: `Unknown taskType: ${taskType}` }, { status: 400 });

    await handler();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
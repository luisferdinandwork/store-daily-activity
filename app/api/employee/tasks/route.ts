// app/api/employee/tasks/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/employee/tasks
//   Returns every task for the authenticated employee for today (or ?date=).
//   Tasks are grouped by the employee's schedule shift (morning / evening).
//   Shared tasks (store-level) are visible to all employees on that shift.
//   Personal tasks (grooming) are returned only for the requesting user.
//
// PATCH /api/employee/tasks
//   Advances a task from pending → in_progress when the employee opens it.
//   Only grooming and store_opening are eligible (shared tasks are set
//   in_progress implicitly by the first employee to open them).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import {
  schedules,
  shifts,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, receivingTasks, briefingTasks,
  edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

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

/** Cache shift id→code map */
let _shiftCodeCache: Record<number, string> | null = null;
async function getShiftCodeMap(): Promise<Record<number, string>> {
  if (_shiftCodeCache) return _shiftCodeCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  _shiftCodeCache = Object.fromEntries(rows.map(r => [r.id, r.code]));
  return _shiftCodeCache!;
}

/** Cache shift code→id map */
let _shiftIdCache: Record<string, number> | null = null;
async function getShiftIdMap(): Promise<Record<string, number>> {
  if (_shiftIdCache) return _shiftIdCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  _shiftIdCache = Object.fromEntries(rows.map(r => [r.code, r.id]));
  return _shiftIdCache!;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const dateParam  = searchParams.get('date');
  const targetDate = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
  const dayStart   = startOfDay(targetDate);
  const dayEnd     = endOfDay(targetDate);

  // ── 1. Find the employee's schedule(s) for today ───────────────────────────
  const todaySchedules = await db
    .select({ id: schedules.id, shiftId: schedules.shiftId, storeId: schedules.storeId })
    .from(schedules)
    .where(
      and(
        eq(schedules.userId,    userId),
        eq(schedules.isHoliday, false),
        gte(schedules.date,     dayStart),
        lte(schedules.date,     dayEnd),
      ),
    );

  if (!todaySchedules.length) {
    return NextResponse.json({ success: true, tasks: [], shift: null });
  }

  // Resolve shift codes from the lookup table
  const shiftCodeMap = await getShiftCodeMap();

  const scheduleIds  = todaySchedules.map(s => s.id);
  const storeIds     = [...new Set(todaySchedules.map(s => s.storeId))];
  const shiftCodes   = [...new Set(todaySchedules.map(s => shiftCodeMap[s.shiftId] ?? ''))]
                         .filter(Boolean) as ('morning' | 'evening')[];
  const primaryShift = shiftCodes[0] ?? null;

  const hasShift = (s: 'morning' | 'evening') => shiftCodes.includes(s);

  // ── 2. Fetch all relevant tasks in parallel ────────────────────────────────

  const [
    openingRows,
    setoranRows,
    cekBinRows,
    productCheckRows,
    receivingRows,
    briefingRows,
    edcSummaryRows,
    edcSettlementRows,
    eodZReportRows,
    openStatementRows,
    groomingRows,
  ] = await Promise.all([
    hasShift('morning')
      ? db.select().from(storeOpeningTasks)
          .where(and(gte(storeOpeningTasks.date, dayStart), lte(storeOpeningTasks.date, dayEnd)))
          .orderBy(desc(storeOpeningTasks.date))
      : Promise.resolve([]),

    hasShift('morning')
      ? db.select().from(setoranTasks)
          .where(and(gte(setoranTasks.date, dayStart), lte(setoranTasks.date, dayEnd)))
          .orderBy(desc(setoranTasks.date))
      : Promise.resolve([]),

    hasShift('morning')
      ? db.select().from(cekBinTasks)
          .where(and(gte(cekBinTasks.date, dayStart), lte(cekBinTasks.date, dayEnd)))
          .orderBy(desc(cekBinTasks.date))
      : Promise.resolve([]),

    hasShift('morning')
      ? db.select().from(productCheckTasks)
          .where(and(gte(productCheckTasks.date, dayStart), lte(productCheckTasks.date, dayEnd)))
          .orderBy(desc(productCheckTasks.date))
      : Promise.resolve([]),

    hasShift('morning')
      ? db.select().from(receivingTasks)
          .where(and(gte(receivingTasks.date, dayStart), lte(receivingTasks.date, dayEnd)))
          .orderBy(desc(receivingTasks.date))
      : Promise.resolve([]),

    hasShift('evening')
      ? db.select().from(briefingTasks)
          .where(and(gte(briefingTasks.date, dayStart), lte(briefingTasks.date, dayEnd)))
          .orderBy(desc(briefingTasks.date))
      : Promise.resolve([]),

    hasShift('evening')
      ? db.select().from(edcSummaryTasks)
          .where(and(gte(edcSummaryTasks.date, dayStart), lte(edcSummaryTasks.date, dayEnd)))
          .orderBy(desc(edcSummaryTasks.date))
      : Promise.resolve([]),

    hasShift('evening')
      ? db.select().from(edcSettlementTasks)
          .where(and(gte(edcSettlementTasks.date, dayStart), lte(edcSettlementTasks.date, dayEnd)))
          .orderBy(desc(edcSettlementTasks.date))
      : Promise.resolve([]),

    hasShift('evening')
      ? db.select().from(eodZReportTasks)
          .where(and(gte(eodZReportTasks.date, dayStart), lte(eodZReportTasks.date, dayEnd)))
          .orderBy(desc(eodZReportTasks.date))
      : Promise.resolve([]),

    hasShift('evening')
      ? db.select().from(openStatementTasks)
          .where(and(gte(openStatementTasks.date, dayStart), lte(openStatementTasks.date, dayEnd)))
          .orderBy(desc(openStatementTasks.date))
      : Promise.resolve([]),

    scheduleIds.length
      ? db.select().from(groomingTasks)
          .where(and(
            gte(groomingTasks.date, dayStart),
            lte(groomingTasks.date, dayEnd),
            eq(groomingTasks.userId, userId),
          ))
          .orderBy(desc(groomingTasks.date))
      : Promise.resolve([]),
  ]);

  const inStore = (storeId: number) => storeIds.includes(storeId);

  // ── 3. Shape into typed task items ────────────────────────────────────────

  const tasks = [
    // ── Morning ──────────────────────────────────────────────────────────────
    ...openingRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'store_opening' as const,
      shift: 'morning' as const,
      data: {
        id:                String(t.id),
        scheduleId:        String(t.scheduleId),
        userId:            t.userId,
        storeId:           String(t.storeId),
        shift:             'morning' as const,
        date:              t.date.toISOString(),
        loginPos:          t.loginPos,
        checkAbsenSunfish: t.checkAbsenSunfish,
        tarikSohSales:     t.tarikSohSales,
        fiveR:             t.fiveR,
        cekLamp:           t.cekLamp,
        cekSoundSystem:    t.cekSoundSystem,
        storeFrontPhotos:  parsePhotos(t.storeFrontPhotos),
        cashDrawerPhotos:  parsePhotos(t.cashDrawerPhotos),
        status:            t.status,
        notes:             t.notes,
        completedAt:       toIso(t.completedAt),
        verifiedBy:        t.verifiedBy,
        verifiedAt:        toIso(t.verifiedAt),
      },
    })),

    ...setoranRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'setoran' as const,
      shift: 'morning' as const,
      data: {
        id:          String(t.id),
        scheduleId:  String(t.scheduleId),
        userId:      t.userId,
        storeId:     String(t.storeId),
        shift:       'morning' as const,
        date:        t.date.toISOString(),
        amount:      t.amount,
        linkSetoran: t.linkSetoran,
        moneyPhotos: parsePhotos(t.moneyPhotos),
        status:      t.status,
        notes:       t.notes,
        completedAt: toIso(t.completedAt),
        verifiedBy:  t.verifiedBy,
        verifiedAt:  toIso(t.verifiedAt),
      },
    })),

    ...cekBinRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'cek_bin' as const,
      shift: 'morning' as const,
      data: {
        id:          String(t.id),
        scheduleId:  String(t.scheduleId),
        userId:      t.userId,
        storeId:     String(t.storeId),
        shift:       'morning' as const,
        date:        t.date.toISOString(),
        status:      t.status,
        notes:       t.notes,
        completedAt: toIso(t.completedAt),
        verifiedBy:  t.verifiedBy,
        verifiedAt:  toIso(t.verifiedAt),
      },
    })),

    ...productCheckRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'product_check' as const,
      shift: 'morning' as const,
      data: {
        id:          String(t.id),
        scheduleId:  String(t.scheduleId),
        userId:      t.userId,
        storeId:     String(t.storeId),
        shift:       'morning' as const,
        date:        t.date.toISOString(),
        display:     t.display,
        price:       t.price,
        saleTag:     t.saleTag,
        shoeFiller:  t.shoeFiller,
        labelIndo:   t.labelIndo,
        barcode:     t.barcode,
        status:      t.status,
        notes:       t.notes,
        completedAt: toIso(t.completedAt),
        verifiedBy:  t.verifiedBy,
        verifiedAt:  toIso(t.verifiedAt),
      },
    })),

    ...receivingRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'receiving' as const,
      shift: 'morning' as const,
      data: {
        id:              String(t.id),
        scheduleId:      String(t.scheduleId),
        userId:          t.userId,
        storeId:         String(t.storeId),
        shift:           'morning' as const,
        date:            t.date.toISOString(),
        hasReceiving:    t.hasReceiving,
        receivingPhotos: parsePhotos(t.receivingPhotos),
        status:          t.status,
        notes:           t.notes,
        completedAt:     toIso(t.completedAt),
        verifiedBy:      t.verifiedBy,
        verifiedAt:      toIso(t.verifiedAt),
      },
    })),

    // ── Evening ───────────────────────────────────────────────────────────────
    ...briefingRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'briefing' as const,
      shift: 'evening' as const,
      data: {
        id:          String(t.id),
        scheduleId:  String(t.scheduleId),
        userId:      t.userId,
        storeId:     String(t.storeId),
        shift:       'evening' as const,
        date:        t.date.toISOString(),
        done:        t.done,
        status:      t.status,
        notes:       t.notes,
        completedAt: toIso(t.completedAt),
        verifiedBy:  t.verifiedBy,
        verifiedAt:  toIso(t.verifiedAt),
      },
    })),

    ...edcSummaryRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'edc_summary' as const,
      shift: 'evening' as const,
      data: {
        id:               String(t.id),
        scheduleId:       String(t.scheduleId),
        userId:           t.userId,
        storeId:          String(t.storeId),
        shift:            'evening' as const,
        date:             t.date.toISOString(),
        edcSummaryPhotos: parsePhotos(t.edcSummaryPhotos),
        status:           t.status,
        notes:            t.notes,
        completedAt:      toIso(t.completedAt),
        verifiedBy:       t.verifiedBy,
        verifiedAt:       toIso(t.verifiedAt),
      },
    })),

    ...edcSettlementRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'edc_settlement' as const,
      shift: 'evening' as const,
      data: {
        id:                  String(t.id),
        scheduleId:          String(t.scheduleId),
        userId:              t.userId,
        storeId:             String(t.storeId),
        shift:               'evening' as const,
        date:                t.date.toISOString(),
        edcSettlementPhotos: parsePhotos(t.edcSettlementPhotos),
        status:              t.status,
        notes:               t.notes,
        completedAt:         toIso(t.completedAt),
        verifiedBy:          t.verifiedBy,
        verifiedAt:          toIso(t.verifiedAt),
      },
    })),

    ...eodZReportRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'eod_z_report' as const,
      shift: 'evening' as const,
      data: {
        id:            String(t.id),
        scheduleId:    String(t.scheduleId),
        userId:        t.userId,
        storeId:       String(t.storeId),
        shift:         'evening' as const,
        date:          t.date.toISOString(),
        zReportPhotos: parsePhotos(t.zReportPhotos),
        status:        t.status,
        notes:         t.notes,
        completedAt:   toIso(t.completedAt),
        verifiedBy:    t.verifiedBy,
        verifiedAt:    toIso(t.verifiedAt),
      },
    })),

    ...openStatementRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'open_statement' as const,
      shift: 'evening' as const,
      data: {
        id:                  String(t.id),
        scheduleId:          String(t.scheduleId),
        userId:              t.userId,
        storeId:             String(t.storeId),
        shift:               'evening' as const,
        date:                t.date.toISOString(),
        openStatementPhotos: parsePhotos(t.openStatementPhotos),
        status:              t.status,
        notes:               t.notes,
        completedAt:         toIso(t.completedAt),
        verifiedBy:          t.verifiedBy,
        verifiedAt:          toIso(t.verifiedAt),
      },
    })),

    // ── Personal (both shifts) ────────────────────────────────────────────────
    ...groomingRows.map(t => {
      // Resolve shift code from shiftId
      const groomingShiftCode = (shiftCodeMap[t.shiftId] ?? 'morning') as 'morning' | 'evening';
      return {
        type: 'grooming' as const,
        shift: groomingShiftCode,
        data: {
          id:                   String(t.id),
          scheduleId:           String(t.scheduleId),
          userId:               t.userId,
          storeId:              String(t.storeId),
          shift:                groomingShiftCode,
          date:                 t.date.toISOString(),
          uniformActive:        t.uniformActive,
          hairActive:           t.hairActive,
          nailsActive:          t.nailsActive,
          accessoriesActive:    t.accessoriesActive,
          shoeActive:           t.shoeActive,
          uniformComplete:      t.uniformComplete,
          hairGroomed:          t.hairGroomed,
          nailsClean:           t.nailsClean,
          accessoriesCompliant: t.accessoriesCompliant,
          shoeCompliant:        t.shoeCompliant,
          selfiePhotos:         parsePhotos(t.selfiePhotos),
          status:               t.status,
          notes:                t.notes,
          completedAt:          toIso(t.completedAt),
          verifiedBy:           t.verifiedBy,
          verifiedAt:           toIso(t.verifiedAt),
        },
      };
    }),
  ];

  // Sort: pending first, in_progress, completed last; within group by shift
  const STATUS_ORDER: Record<string, number> = {
    pending: 0, in_progress: 1, completed: 2, verified: 3, rejected: 4,
  };
  tasks.sort((a, b) => {
    const s = (STATUS_ORDER[a.data.status] ?? 9) - (STATUS_ORDER[b.data.status] ?? 9);
    if (s !== 0) return s;
    return (a.shift === 'morning' ? 0 : 1) - (b.shift === 'morning' ? 0 : 1);
  });

  return NextResponse.json({ success: true, tasks, shift: primaryShift, scheduleIds });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — advance task to in_progress
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const { taskId, taskType, status } = await request.json() as {
    taskId:   string;
    taskType: string;
    status:   string;
  };

  if (!taskId || !taskType || status !== 'in_progress') {
    return NextResponse.json(
      { error: 'taskId, taskType, and status=in_progress are required' },
      { status: 400 },
    );
  }

  const id = parseInt(taskId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: 'taskId must be a number' }, { status: 400 });
  }

  const SHARED_TABLES: Record<string, {
    getRow: (id: number) => Promise<{ status: string | null } | undefined>;
    update: (id: number) => Promise<void>;
  }> = {
    store_opening: {
      getRow: async id => (await db.select({ status: storeOpeningTasks.status }).from(storeOpeningTasks).where(eq(storeOpeningTasks.id, id)).limit(1))[0],
      update: id => db.update(storeOpeningTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(storeOpeningTasks.id, id)).then(() => {}),
    },
    setoran: {
      getRow: async id => (await db.select({ status: setoranTasks.status }).from(setoranTasks).where(eq(setoranTasks.id, id)).limit(1))[0],
      update: id => db.update(setoranTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(setoranTasks.id, id)).then(() => {}),
    },
    cek_bin: {
      getRow: async id => (await db.select({ status: cekBinTasks.status }).from(cekBinTasks).where(eq(cekBinTasks.id, id)).limit(1))[0],
      update: id => db.update(cekBinTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(cekBinTasks.id, id)).then(() => {}),
    },
    product_check: {
      getRow: async id => (await db.select({ status: productCheckTasks.status }).from(productCheckTasks).where(eq(productCheckTasks.id, id)).limit(1))[0],
      update: id => db.update(productCheckTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(productCheckTasks.id, id)).then(() => {}),
    },
    receiving: {
      getRow: async id => (await db.select({ status: receivingTasks.status }).from(receivingTasks).where(eq(receivingTasks.id, id)).limit(1))[0],
      update: id => db.update(receivingTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(receivingTasks.id, id)).then(() => {}),
    },
    briefing: {
      getRow: async id => (await db.select({ status: briefingTasks.status }).from(briefingTasks).where(eq(briefingTasks.id, id)).limit(1))[0],
      update: id => db.update(briefingTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(briefingTasks.id, id)).then(() => {}),
    },
    edc_summary: {
      getRow: async id => (await db.select({ status: edcSummaryTasks.status }).from(edcSummaryTasks).where(eq(edcSummaryTasks.id, id)).limit(1))[0],
      update: id => db.update(edcSummaryTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(edcSummaryTasks.id, id)).then(() => {}),
    },
    edc_settlement: {
      getRow: async id => (await db.select({ status: edcSettlementTasks.status }).from(edcSettlementTasks).where(eq(edcSettlementTasks.id, id)).limit(1))[0],
      update: id => db.update(edcSettlementTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(edcSettlementTasks.id, id)).then(() => {}),
    },
    eod_z_report: {
      getRow: async id => (await db.select({ status: eodZReportTasks.status }).from(eodZReportTasks).where(eq(eodZReportTasks.id, id)).limit(1))[0],
      update: id => db.update(eodZReportTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(eodZReportTasks.id, id)).then(() => {}),
    },
    open_statement: {
      getRow: async id => (await db.select({ status: openStatementTasks.status }).from(openStatementTasks).where(eq(openStatementTasks.id, id)).limit(1))[0],
      update: id => db.update(openStatementTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(openStatementTasks.id, id)).then(() => {}),
    },
  };

  if (taskType === 'grooming') {
    const [row] = await db
      .select({ userId: groomingTasks.userId, status: groomingTasks.status })
      .from(groomingTasks)
      .where(eq(groomingTasks.id, id))
      .limit(1);

    if (!row)                  return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (row.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (row.status !== 'pending') return NextResponse.json({ success: true });

    await db.update(groomingTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(groomingTasks.id, id));
    return NextResponse.json({ success: true });
  }

  const handler = SHARED_TABLES[taskType];
  if (!handler) {
    return NextResponse.json({ error: `Unknown taskType: ${taskType}` }, { status: 400 });
  }

  const row = await handler.getRow(id);
  if (!row)                     return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (row.status !== 'pending') return NextResponse.json({ success: true });

  await handler.update(id);
  return NextResponse.json({ success: true });
}
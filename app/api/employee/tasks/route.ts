// app/api/employee/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import {
  schedules, shifts,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, briefingTasks,
  edcReconciliationTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
  itemDroppingTasks, itemDroppingEntries,
} from '@/lib/db/schema';
import { eq, and, gte, lte, desc, inArray } from 'drizzle-orm';
import { getOrCreateSetoranForSchedule }      from '@/lib/db/utils/setoran';
import { getOrCreateStoreOpeningForSchedule } from '@/lib/db/utils/store-opening';
import { getOrCreateItemDroppingForSchedule } from '@/lib/db/utils/item-dropping';
import { getOrCreateGroomingForSchedule }     from '@/lib/db/utils/grooming';

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

type ShiftCode = 'morning' | 'evening' | 'full_day';

let _shiftCodeCache: Record<number, string> | null = null;
async function getShiftCodeMap(): Promise<Record<number, string>> {
  if (_shiftCodeCache) return _shiftCodeCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  _shiftCodeCache = Object.fromEntries(rows.map(r => [r.id, r.code]));
  return _shiftCodeCache!;
}

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

  const todaySchedules = await db
    .select({ id: schedules.id, shiftId: schedules.shiftId, storeId: schedules.storeId })
    .from(schedules)
    .where(and(
      eq(schedules.userId,    userId),
      eq(schedules.isHoliday, false),
      gte(schedules.date,     dayStart),
      lte(schedules.date,     dayEnd),
    ));

  if (!todaySchedules.length) {
    return NextResponse.json({ success: true, tasks: [], shift: null });
  }

  const shiftCodeMap = await getShiftCodeMap();

  const scheduleIds = todaySchedules.map(s => s.id);
  const storeIds    = [...new Set(todaySchedules.map(s => s.storeId))];

  const shiftCodesRaw = [...new Set(todaySchedules.map(s => shiftCodeMap[s.shiftId] ?? ''))]
    .filter(Boolean) as ShiftCode[];

  const hasMorningTasks = shiftCodesRaw.some(c => c === 'morning'  || c === 'full_day');
  const hasEveningTasks = shiftCodesRaw.some(c => c === 'evening'  || c === 'full_day');

  const primaryShift: ShiftCode | null = shiftCodesRaw[0] ?? null;

  const inStore = (storeId: number) => storeIds.includes(storeId);

  const [
    openingRows,
    setoranRows,
    cekBinRows,
    productCheckRows,
    itemDroppingRows,
    itemDroppingEntryRows,
    edcReconciliationRows,
    briefingRows,
    eodZReportRows,
    openStatementRows,
    groomingRows,
  ] = await Promise.all([

    hasMorningTasks
      ? (async () => {
          const morningSchedules = todaySchedules.filter(s => {
            const code = shiftCodeMap[s.shiftId];
            return code === 'morning' || code === 'full_day';
          });
          await Promise.all(
            morningSchedules.map(s =>
              getOrCreateStoreOpeningForSchedule(s.id, userId, s.storeId, targetDate),
            ),
          );
          return db
            .select()
            .from(storeOpeningTasks)
            .where(and(
              inArray(storeOpeningTasks.storeId, storeIds),
              gte(storeOpeningTasks.date, dayStart),
              lte(storeOpeningTasks.date, dayEnd),
            ))
            .orderBy(desc(storeOpeningTasks.date));
        })()
      : Promise.resolve([]),

    hasMorningTasks
      ? (async () => {
          const morningSchedules = todaySchedules.filter(s => {
            const code = shiftCodeMap[s.shiftId];
            return code === 'morning' || code === 'full_day';
          });
          await Promise.all(morningSchedules.map(s => getOrCreateSetoranForSchedule(s.id)));
          return db
            .select()
            .from(setoranTasks)
            .where(and(
              inArray(setoranTasks.storeId, storeIds),
              gte(setoranTasks.date, dayStart),
              lte(setoranTasks.date, dayEnd),
            ))
            .orderBy(desc(setoranTasks.date));
        })()
      : Promise.resolve([]),

    hasMorningTasks
      ? db.select().from(cekBinTasks)
          .where(and(gte(cekBinTasks.date, dayStart), lte(cekBinTasks.date, dayEnd)))
          .orderBy(desc(cekBinTasks.date))
      : Promise.resolve([]),

    hasMorningTasks
      ? db.select().from(productCheckTasks)
          .where(and(gte(productCheckTasks.date, dayStart), lte(productCheckTasks.date, dayEnd)))
          .orderBy(desc(productCheckTasks.date))
      : Promise.resolve([]),

    (async () => {
      await Promise.all(
        todaySchedules.map(s =>
          getOrCreateItemDroppingForSchedule(s.id, userId, s.storeId, s.shiftId, targetDate),
        ),
      );
      return db
        .select()
        .from(itemDroppingTasks)
        .where(and(
          inArray(itemDroppingTasks.storeId, storeIds),
          gte(itemDroppingTasks.date, dayStart),
          lte(itemDroppingTasks.date, dayEnd),
        ))
        .orderBy(desc(itemDroppingTasks.date));
    })(),

    (async () => {
      const taskIds = await db
        .select({ id: itemDroppingTasks.id })
        .from(itemDroppingTasks)
        .where(and(
          inArray(itemDroppingTasks.storeId, storeIds),
          gte(itemDroppingTasks.date, dayStart),
          lte(itemDroppingTasks.date, dayEnd),
        ));
      if (!taskIds.length) return [];
      return db
        .select()
        .from(itemDroppingEntries)
        .where(inArray(itemDroppingEntries.taskId, taskIds.map(r => r.id)))
        .orderBy(itemDroppingEntries.dropTime);
    })(),

    hasEveningTasks
      ? db.select().from(edcReconciliationTasks)
          .where(and(
            gte(edcReconciliationTasks.date, dayStart),
            lte(edcReconciliationTasks.date, dayEnd),
          ))
          .orderBy(desc(edcReconciliationTasks.date))
      : Promise.resolve([]),

    hasEveningTasks
      ? db.select().from(briefingTasks)
          .where(and(gte(briefingTasks.date, dayStart), lte(briefingTasks.date, dayEnd)))
          .orderBy(desc(briefingTasks.date))
      : Promise.resolve([]),

    hasEveningTasks
      ? db.select().from(eodZReportTasks)
          .where(and(gte(eodZReportTasks.date, dayStart), lte(eodZReportTasks.date, dayEnd)))
          .orderBy(desc(eodZReportTasks.date))
      : Promise.resolve([]),

    hasEveningTasks
      ? db.select().from(openStatementTasks)
          .where(and(gte(openStatementTasks.date, dayStart), lte(openStatementTasks.date, dayEnd)))
          .orderBy(desc(openStatementTasks.date))
      : Promise.resolve([]),

    (async () => {
      await Promise.all(
        todaySchedules.map(s =>
          getOrCreateGroomingForSchedule(s.id, userId, s.storeId, s.shiftId, targetDate),
        ),
      );
      return db
        .select()
        .from(groomingTasks)
        .where(and(
          gte(groomingTasks.date, dayStart),
          lte(groomingTasks.date, dayEnd),
          eq(groomingTasks.userId, userId),
        ))
        .orderBy(desc(groomingTasks.date));
    })(),
  ]);

  const entriesByTaskId = new Map<number, typeof itemDroppingEntryRows>();
  for (const entry of itemDroppingEntryRows) {
    const bucket = entriesByTaskId.get(entry.taskId) ?? [];
    bucket.push(entry);
    entriesByTaskId.set(entry.taskId, bucket);
  }

  const tasks = [
    // ── Store Opening ──────────────────────────────────────────────────────
    ...openingRows.filter(r => inStore(r.storeId)).map(t => ({
      type:  'store_opening' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'morning' as const, date: t.date.toISOString(),
        loginPos: t.loginPos, checkAbsenSunfish: t.checkAbsenSunfish,
        tarikSohSales: t.tarikSohSales, fiveR: t.fiveR,
        // Per-area 5R photos
        fiveRAreaKasirPhotos:  parsePhotos(t.fiveRAreaKasirPhotos),
        fiveRAreaDepanPhotos:  parsePhotos(t.fiveRAreaDepanPhotos),
        fiveRAreaKananPhotos:  parsePhotos(t.fiveRAreaKananPhotos),
        fiveRAreaKiriPhotos:   parsePhotos(t.fiveRAreaKiriPhotos),
        fiveRAreaGudangPhotos: parsePhotos(t.fiveRAreaGudangPhotos),
        cekLamp: t.cekLamp, cekSoundSystem: t.cekSoundSystem,
        storeFrontPhotos: parsePhotos(t.storeFrontPhotos),
        cashDrawerPhotos: parsePhotos(t.cashDrawerPhotos),
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── Setoran ───────────────────────────────────────────────────────────
    ...setoranRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'setoran' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'morning' as const, date: t.date.toISOString(),
        amount:      t.amount, linkSetoran: t.linkSetoran, resiPhoto: t.resiPhoto,
        expectedAmount: t.expectedAmount, carriedDeficit: t.carriedDeficit,
        carriedDeficitFetchedAt: toIso(t.carriedDeficitFetchedAt),
        unpaidAmount: t.unpaidAmount,
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── Cek Bin ───────────────────────────────────────────────────────────
    ...cekBinRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'cek_bin' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'morning' as const, date: t.date.toISOString(),
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── Product Check ─────────────────────────────────────────────────────
    ...productCheckRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'product_check' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'morning' as const, date: t.date.toISOString(),
        display: t.display, price: t.price, saleTag: t.saleTag,
        shoeFiller: t.shoeFiller, labelIndo: t.labelIndo, barcode: t.barcode,
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── Item Dropping ─────────────────────────────────────────────────────
    ...itemDroppingRows.filter(r => inStore(r.storeId)).map(t => {
      const shift = (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode;
      const entries = (entriesByTaskId.get(t.id) ?? []).map(e => ({
        id: String(e.id), taskId: String(e.taskId), userId: e.userId,
        storeId: String(e.storeId), toNumber: e.toNumber,
        dropTime: toIso(e.dropTime),
        droppingPhotos: parsePhotos(e.droppingPhotos),
        notes: e.notes, createdAt: toIso(e.createdAt),
      }));
      return {
        type: 'item_dropping' as const, shift,
        data: {
          id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
          storeId: String(t.storeId), shift, date: t.date.toISOString(),
          hasDropping: t.hasDropping, entries,
          status: t.status, notes: t.notes,
          completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
        },
      };
    }),

    // ── Briefing ──────────────────────────────────────────────────────────
    ...briefingRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'briefing' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'evening' as const, date: t.date.toISOString(),
        done: t.done, isBalanced: t.isBalanced, parentTaskId: t.parentTaskId,
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── EOD Z-Report ──────────────────────────────────────────────────────
    ...eodZReportRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'eod_z_report' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'evening' as const, date: t.date.toISOString(),
        totalNominal: t.totalNominal, zReportPhotos: parsePhotos(t.zReportPhotos),
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── EDC Reconciliation ────────────────────────────────────────────────
    ...edcReconciliationRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'edc_reconciliation' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'evening' as const, date: t.date.toISOString(),
        parentTaskId: t.parentTaskId, isBalanced: t.isBalanced,
        expectedFetchedAt: toIso(t.expectedFetchedAt),
        discrepancyStartedAt:       toIso(t.discrepancyStartedAt),
        discrepancyResolvedAt:      toIso(t.discrepancyResolvedAt),
        discrepancyDurationMinutes: t.discrepancyDurationMinutes,
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── Open Statement ────────────────────────────────────────────────────
    ...openStatementRows.filter(r => inStore(r.storeId)).map(t => ({
      type: 'open_statement' as const,
      shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
      data: {
        id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
        storeId: String(t.storeId), shift: 'evening' as const, date: t.date.toISOString(),
        parentTaskId: t.parentTaskId, expectedAmount: t.expectedAmount,
        expectedFetchedAt: toIso(t.expectedFetchedAt), actualAmount: t.actualAmount,
        isBalanced: t.isBalanced,
        discrepancyStartedAt:       toIso(t.discrepancyStartedAt),
        discrepancyResolvedAt:      toIso(t.discrepancyResolvedAt),
        discrepancyDurationMinutes: t.discrepancyDurationMinutes,
        status: t.status, notes: t.notes,
        completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
      },
    })),

    // ── Grooming ──────────────────────────────────────────────────────────
    ...groomingRows.map(t => {
      const code = (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode;
      return {
        type: 'grooming' as const, shift: code,
        data: {
          id: String(t.id), scheduleId: String(t.scheduleId), userId: t.userId,
          storeId: String(t.storeId), shift: code, date: t.date.toISOString(),
          uniformActive: t.uniformActive, hairActive: t.hairActive,
          nailsActive: t.nailsActive, accessoriesActive: t.accessoriesActive, shoeActive: t.shoeActive,
          uniformComplete: t.uniformComplete, hairGroomed: t.hairGroomed, nailsClean: t.nailsClean,
          accessoriesCompliant: t.accessoriesCompliant, shoeCompliant: t.shoeCompliant,
          selfiePhotos: parsePhotos(t.selfiePhotos),
          status: t.status, notes: t.notes,
          completedAt: toIso(t.completedAt), verifiedBy: t.verifiedBy, verifiedAt: toIso(t.verifiedAt),
        },
      };
    }),
  ];

  const STATUS_ORDER: Record<string, number> = {
    pending: 0, in_progress: 1, discrepancy: 2, completed: 3, verified: 4, rejected: 5,
  };
  const SHIFT_ORDER: Record<string, number> = { morning: 0, full_day: 1, evening: 2 };

  tasks.sort((a, b) => {
    const s = (STATUS_ORDER[a.data.status] ?? 9) - (STATUS_ORDER[b.data.status] ?? 9);
    if (s !== 0) return s;
    return (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9);
  });

  return NextResponse.json({ success: true, tasks, shift: primaryShift, scheduleIds });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const { taskId, taskType, status } = await request.json() as {
    taskId: string; taskType: string; status: string;
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
    item_dropping: {
      getRow: async id => (await db.select({ status: itemDroppingTasks.status }).from(itemDroppingTasks).where(eq(itemDroppingTasks.id, id)).limit(1))[0],
      update: id => db.update(itemDroppingTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(itemDroppingTasks.id, id)).then(() => {}),
    },
    briefing: {
      getRow: async id => (await db.select({ status: briefingTasks.status }).from(briefingTasks).where(eq(briefingTasks.id, id)).limit(1))[0],
      update: id => db.update(briefingTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(briefingTasks.id, id)).then(() => {}),
    },
    edc_reconciliation: {
      getRow: async id => (await db.select({ status: edcReconciliationTasks.status }).from(edcReconciliationTasks).where(eq(edcReconciliationTasks.id, id)).limit(1))[0],
      update: id => db.update(edcReconciliationTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(edcReconciliationTasks.id, id)).then(() => {}),
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
    if (row.userId !== userId) return NextResponse.json({ error: 'Forbidden' },      { status: 403 });
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
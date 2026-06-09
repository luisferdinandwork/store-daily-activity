// scripts/seed-tasks.ts
// Fast task seeder.
//
// Seeds task rows for existing schedules using preloaded keys + batched inserts.
// This avoids thousands of repeated SELECT-before-INSERT queries.
//
// Behavior kept compatible with your current task rules:
// - Morning shared tasks: once per store/date.
// - Item Dropping, Briefing, Serah Terima: store/date/shift rows.
// - Evening ops tasks: once per store/date/evening shift.
// - Grooming: once per scheduleId.
// - No verifiedBy / verifiedAt is seeded.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  schedules,
  users,
  stores,
  areas,
  shifts,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  cekBinTasks,
  storeBins,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  briefingTasks,
  serahTerimaTasks,
  eodZReportTasks,
  edcReconciliationTasks,
  openStatementTasks,
  groomingTasks,
} from '@/lib/db/schema';

type ShiftCode = 'morning' | 'evening' | 'full_day';
type CountBucket = { created: number; skipped: number };
type TaskCounts = Record<string, CountBucket>;

const BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE ?? 500);
const ACTIVE_STATUSES = ['pending', 'in_progress', 'discrepancy'] as const;

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function ymd(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}

function resolveSeedRange() {
  const now = new Date();
  const raw = (process.env.SEED_TASKS_MONTH || process.env.SEED_SCHEDULE_MONTHS || process.env.SEED_MONTH || 'both')
    .trim()
    .toLowerCase();

  if (raw === 'both' || raw === 'default' || raw === 'previous,current' || raw === 'current,previous') {
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const currEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: startOfDay(prevStart), end: endOfDay(currEnd), label: 'previous+current' };
  }

  if (raw === 'current') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: startOfDay(start), end: endOfDay(end), label: ymd(start).slice(0, 7) };
  }

  if (raw === 'previous' || raw === 'last') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { start: startOfDay(start), end: endOfDay(end), label: ymd(start).slice(0, 7) };
  }

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    return { start: startOfDay(start), end: endOfDay(end), label: raw };
  }

  // Backward compatible: if the env is weird, seed all schedules.
  return { start: null as Date | null, end: null as Date | null, label: 'all schedules' };
}

async function insertInBatches<T extends Record<string, unknown>>(table: any, rows: T[], batchSize = BATCH_SIZE) {
  if (!rows.length) return 0;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await db.insert(table).values(batch as any);
    inserted += batch.length;
  }

  return inserted;
}

function bump(counts: TaskCounts, key: string, action: 'created' | 'skipped', amount = 1) {
  counts[key][action] += amount;
}

function makeBase(sched: any, shiftId: number, date: Date) {
  return {
    scheduleId: sched.id,
    userId: sched.userId,
    storeId: sched.storeId,
    shiftId,
    date,
    status: 'pending' as const,
  };
}

async function loadStoreDateKeys(table: any, storeIds: number[], start: Date | null, end: Date | null) {
  if (!storeIds.length) return new Set<string>();
  const where = start && end
    ? and(inArray(table.storeId, storeIds), gte(table.date, start), lte(table.date, end))
    : inArray(table.storeId, storeIds);

  const rows = await db
    .select({ storeId: table.storeId, date: table.date })
    .from(table)
    .where(where as any);

  return new Set((rows as any[]).map((r) => `${r.storeId}|${ymd(r.date)}`));
}

async function loadStoreDateShiftKeys(table: any, storeIds: number[], start: Date | null, end: Date | null, activeOnly = false) {
  if (!storeIds.length) return new Set<string>();
  const filters: any[] = [inArray(table.storeId, storeIds)];
  if (start && end) filters.push(gte(table.date, start), lte(table.date, end));
  if (activeOnly) filters.push(inArray(table.status, ACTIVE_STATUSES as any));

  const rows = await db
    .select({ storeId: table.storeId, date: table.date, shiftId: table.shiftId })
    .from(table)
    .where(and(...filters));

  return new Set((rows as any[]).map((r) => `${r.storeId}|${ymd(r.date)}|${r.shiftId}`));
}

async function loadScheduleIdKeys(table: any, scheduleIds: number[]) {
  if (!scheduleIds.length) return new Set<number>();
  const rows = await db
    .select({ scheduleId: table.scheduleId })
    .from(table)
    .where(inArray(table.scheduleId, scheduleIds));
  return new Set((rows as any[]).map((r) => Number(r.scheduleId)));
}

async function seedTasks() {
  const range = resolveSeedRange();
  console.log(`\n🗂️  seed-tasks fast mode: ${range.label}`);

  const scheduleFilters: any[] = [];
  if (range.start && range.end) {
    scheduleFilters.push(gte(schedules.date, range.start), lte(schedules.date, range.end));
  }

  const allSchedules = await db
    .select({
      sched: schedules,
      shiftCode: shifts.code,
      user: { id: users.id, name: users.name },
      store: { id: stores.id, name: stores.name },
      area: { name: areas.name },
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .leftJoin(users, eq(schedules.userId, users.id))
    .leftJoin(stores, eq(schedules.storeId, stores.id))
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .where(scheduleFilters.length ? and(...scheduleFilters) : undefined as any)
    .orderBy(areas.name, stores.name, schedules.date, shifts.sortOrder);

  if (!allSchedules.length) {
    throw new Error('No schedule rows found. Run seed-current-month.ts first.');
  }

  const allShifts = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftIdByCode = Object.fromEntries(allShifts.map((s) => [s.code, s.id])) as Record<string, number>;
  const morningShiftId = shiftIdByCode.morning;
  const eveningShiftId = shiftIdByCode.evening;

  if (!morningShiftId || !eveningShiftId) {
    throw new Error('morning/evening shifts not found. Run seed-setup.ts first.');
  }

  const storeIds = [...new Set((allSchedules as any[]).map((r) => r.sched.storeId))];
  const scheduleIds = (allSchedules as any[]).map((r) => r.sched.id);

  const counts: TaskCounts = {
    storeOpening: { created: 0, skipped: 0 },
    storeFront: { created: 0, skipped: 0 },
    setoran: { created: 0, skipped: 0 },
    cekBin: { created: 0, skipped: 0 },
    vmChecklist: { created: 0, skipped: 0 },
    marketingCheck: { created: 0, skipped: 0 },
    itemDropping: { created: 0, skipped: 0 },
    briefing: { created: 0, skipped: 0 },
    serahTerima: { created: 0, skipped: 0 },
    eodZReport: { created: 0, skipped: 0 },
    edcReconciliation: { created: 0, skipped: 0 },
    openStatement: { created: 0, skipped: 0 },
    grooming: { created: 0, skipped: 0 },
  };

  console.log(`   Schedules scanned: ${allSchedules.length}`);

  const [
    openingKeys,
    frontKeys,
    setoranKeys,
    cekBinKeys,
    vmKeys,
    marketingKeys,
    itemDroppingKeys,
    briefingKeys,
    serahTerimaKeys,
    eodKeys,
    edcKeys,
    openStatementKeys,
    groomingScheduleIds,
    activeBins,
  ] = await Promise.all([
    loadStoreDateKeys(storeOpeningTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(storeFrontTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(setoranTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(cekBinTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(vmChecklistTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(marketingCheckTasks, storeIds, range.start, range.end),
    loadStoreDateShiftKeys(itemDroppingTasks, storeIds, range.start, range.end),
    loadStoreDateShiftKeys(briefingTasks, storeIds, range.start, range.end),
    loadStoreDateShiftKeys(serahTerimaTasks, storeIds, range.start, range.end),
    loadStoreDateShiftKeys(eodZReportTasks, storeIds, range.start, range.end, true),
    loadStoreDateShiftKeys(edcReconciliationTasks, storeIds, range.start, range.end, true),
    loadStoreDateShiftKeys(openStatementTasks, storeIds, range.start, range.end, true),
    loadScheduleIdKeys(groomingTasks, scheduleIds),
    db
      .select({ storeId: storeBins.storeId, id: storeBins.id })
      .from(storeBins)
      .where(and(inArray(storeBins.storeId, storeIds), eq(storeBins.isActive, true))),
  ]);

  const binCountByStoreId = new Map<number, number>();
  for (const bin of activeBins as any[]) {
    binCountByStoreId.set(bin.storeId, (binCountByStoreId.get(bin.storeId) ?? 0) + 1);
  }

  const rows = {
    storeOpening: [] as Array<typeof storeOpeningTasks.$inferInsert>,
    storeFront: [] as Array<typeof storeFrontTasks.$inferInsert>,
    setoran: [] as Array<typeof setoranTasks.$inferInsert>,
    cekBin: [] as Array<typeof cekBinTasks.$inferInsert>,
    vmChecklist: [] as Array<typeof vmChecklistTasks.$inferInsert>,
    marketingCheck: [] as Array<typeof marketingCheckTasks.$inferInsert>,
    itemDropping: [] as Array<typeof itemDroppingTasks.$inferInsert>,
    briefing: [] as Array<typeof briefingTasks.$inferInsert>,
    serahTerima: [] as Array<typeof serahTerimaTasks.$inferInsert>,
    eodZReport: [] as Array<typeof eodZReportTasks.$inferInsert>,
    edcReconciliation: [] as Array<typeof edcReconciliationTasks.$inferInsert>,
    openStatement: [] as Array<typeof openStatementTasks.$inferInsert>,
    grooming: [] as Array<typeof groomingTasks.$inferInsert>,
  };

  function addStoreDateTask(
    keySet: Set<string>,
    countKey: keyof typeof counts,
    list: Array<any>,
    base: Record<string, unknown>,
  ) {
    const key = `${base.storeId}|${ymd(base.date as Date)}`;
    if (keySet.has(key)) {
      bump(counts, countKey, 'skipped');
      return;
    }
    keySet.add(key);
    list.push(base);
    bump(counts, countKey, 'created');
  }

  function addStoreDateShiftTask(
    keySet: Set<string>,
    countKey: keyof typeof counts,
    list: Array<any>,
    base: Record<string, unknown>,
  ) {
    const key = `${base.storeId}|${ymd(base.date as Date)}|${base.shiftId}`;
    if (keySet.has(key)) {
      bump(counts, countKey, 'skipped');
      return;
    }
    keySet.add(key);
    list.push(base);
    bump(counts, countKey, 'created');
  }

  for (const { sched, shiftCode } of allSchedules as any[]) {
    const code = shiftCode as ShiftCode;
    const date = startOfDay(sched.date);
    const isMorning = code === 'morning' || code === 'full_day';
    const isEvening = code === 'evening' || code === 'full_day';

    const morningBase = makeBase(sched, morningShiftId, date);
    const eveningBase = makeBase(sched, eveningShiftId, date);

    if (isMorning) {
      addStoreDateTask(openingKeys, 'storeOpening', rows.storeOpening, morningBase);
      addStoreDateTask(frontKeys, 'storeFront', rows.storeFront, morningBase);
      addStoreDateTask(setoranKeys, 'setoran', rows.setoran, { ...morningBase, carriedDeficit: '0', unpaidAmount: '0' });

      const totalStoreBins = binCountByStoreId.get(sched.storeId) ?? 0;
      addStoreDateTask(cekBinKeys, 'cekBin', rows.cekBin, {
        ...morningBase,
        totalStoreBins,
        minimumBinsToCheck: totalStoreBins > 0 ? Math.ceil(totalStoreBins * 0.3) : 0,
        checkedBinsCount: 0,
      });

      addStoreDateTask(vmKeys, 'vmChecklist', rows.vmChecklist, morningBase);
      addStoreDateTask(marketingKeys, 'marketingCheck', rows.marketingCheck, morningBase);
      addStoreDateShiftTask(itemDroppingKeys, 'itemDropping', rows.itemDropping, { ...morningBase, hasDropping: false });
      addStoreDateShiftTask(briefingKeys, 'briefing', rows.briefing, { ...morningBase, done: false, isBalanced: null, parentTaskId: null });
      addStoreDateShiftTask(serahTerimaKeys, 'serahTerima', rows.serahTerima, { ...morningBase, handoverText: '' });
    }

    if (isEvening) {
      if (code === 'evening') {
        addStoreDateShiftTask(itemDroppingKeys, 'itemDropping', rows.itemDropping, { ...eveningBase, hasDropping: false });
        addStoreDateShiftTask(briefingKeys, 'briefing', rows.briefing, { ...eveningBase, done: false, isBalanced: null, parentTaskId: null });
        addStoreDateShiftTask(serahTerimaKeys, 'serahTerima', rows.serahTerima, { ...eveningBase, handoverText: '' });
      }
      addStoreDateShiftTask(eodKeys, 'eodZReport', rows.eodZReport, eveningBase);
      addStoreDateShiftTask(edcKeys, 'edcReconciliation', rows.edcReconciliation, eveningBase);
      addStoreDateShiftTask(openStatementKeys, 'openStatement', rows.openStatement, eveningBase);
    }

    if (groomingScheduleIds.has(sched.id)) {
      bump(counts, 'grooming', 'skipped');
    } else {
      groomingScheduleIds.add(sched.id);
      rows.grooming.push({
        scheduleId: sched.id,
        userId: sched.userId,
        storeId: sched.storeId,
        shiftId: sched.shiftId,
        date,
        status: 'pending' as const,
      } as any);
      bump(counts, 'grooming', 'created');
    }
  }

  await insertInBatches(storeOpeningTasks, rows.storeOpening);
  await insertInBatches(storeFrontTasks, rows.storeFront);
  await insertInBatches(setoranTasks, rows.setoran);
  await insertInBatches(cekBinTasks, rows.cekBin);
  await insertInBatches(vmChecklistTasks, rows.vmChecklist);
  await insertInBatches(marketingCheckTasks, rows.marketingCheck);
  await insertInBatches(itemDroppingTasks, rows.itemDropping);
  await insertInBatches(briefingTasks, rows.briefing);
  await insertInBatches(serahTerimaTasks, rows.serahTerima);
  await insertInBatches(eodZReportTasks, rows.eodZReport);
  await insertInBatches(edcReconciliationTasks, rows.edcReconciliation);
  await insertInBatches(openStatementTasks, rows.openStatement);
  await insertInBatches(groomingTasks, rows.grooming);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ seed-tasks complete');
  console.log(`   ${'Task type'.padEnd(19)}  created  skipped`);
  console.log('   ' + '─'.repeat(38));
  for (const [name, c] of Object.entries(counts)) {
    console.log(`   ${name.padEnd(19)}  ${String(c.created).padStart(7)}  ${String(c.skipped).padStart(7)}`);
  }
  console.log('═══════════════════════════════════════════════════════════\n');
}

seedTasks()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ seed-tasks failed:', err);
    process.exit(1);
  });

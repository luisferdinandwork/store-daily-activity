// scripts/seed-current-month.ts
// Robust, idempotent schedule + task seeder.
//
// Default target: previous calendar month + current calendar month.
// This lets you keep historical attendance data for last month while leaving
// this month open for live attendance testing.
//
// Optional:
//   SEED_SCHEDULE_MONTHS=both       -> previous + current (default)
//   SEED_SCHEDULE_MONTHS=current    -> current only
//   SEED_SCHEDULE_MONTHS=previous   -> previous only
//   SEED_SCHEDULE_MONTHS=YYYY-MM    -> specific month only
//
// Examples:
//   npx tsx scripts/seed-current-month.ts
//   $env:SEED_SCHEDULE_MONTHS="both"; npx tsx scripts/seed-current-month.ts
//   $env:SEED_SCHEDULE_MONTHS="2026-04"; npx tsx scripts/seed-current-month.ts

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, gte, inArray, lte } from 'drizzle-orm';

type ShiftCode = 'morning' | 'evening' | 'full_day';
type PatternCode = 'E' | 'L' | 'FD' | 'OFF';

const PATTERNS: Record<string, PatternCode[]> = {
  pic_1:   ['OFF', 'E',   'E',   'E',   'E',   'E',   'OFF'],
  pic_2:   ['OFF', 'E',   'L',   'E',   'L',   'E',   'L'  ],
  sa:      ['OFF', 'OFF', 'L',   'L',   'L',   'L',   'L'  ],
  default: ['OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'],
};

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

function resolveTargetMonth(defaultMode: 'current' | 'previous' = 'current') {
  const now = new Date();
  const raw = (process.env.SEED_MONTH || defaultMode).trim().toLowerCase();

  let year: number;
  let monthIndex: number;

  if (raw === 'current') {
    year = now.getFullYear();
    monthIndex = now.getMonth();
  } else if (raw === 'previous' || raw === 'last') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    year = d.getFullYear();
    monthIndex = d.getMonth();
  } else if (/^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number);
    year = y;
    monthIndex = m - 1;
  } else {
    throw new Error('Invalid SEED_MONTH. Use current, previous, or YYYY-MM.');
  }

  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  const yearMonth = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

  return { year, monthIndex, start, end, yearMonth };
}


type TargetMonth = ReturnType<typeof resolveTargetMonth>;

function uniqueMonths(months: TargetMonth[]): TargetMonth[] {
  const seen = new Set<string>();
  return months.filter((m) => {
    if (seen.has(m.yearMonth)) return false;
    seen.add(m.yearMonth);
    return true;
  });
}

function resolveScheduleMonths(): TargetMonth[] {
  const raw = (process.env.SEED_SCHEDULE_MONTHS || process.env.SEED_MONTH || 'both').trim().toLowerCase();

  if (raw === 'both' || raw === 'default' || raw === 'previous,current' || raw === 'current,previous') {
    return uniqueMonths([
      resolveTargetMonth('previous'),
      resolveTargetMonth('current'),
    ]);
  }

  if (raw === 'current') return [resolveTargetMonth('current')];
  if (raw === 'previous' || raw === 'last') return [resolveTargetMonth('previous')];

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const oldSeedMonth = process.env.SEED_MONTH;
    process.env.SEED_MONTH = raw;
    const target = resolveTargetMonth('current');
    if (oldSeedMonth === undefined) delete process.env.SEED_MONTH;
    else process.env.SEED_MONTH = oldSeedMonth;
    return [target];
  }

  throw new Error('Invalid SEED_SCHEDULE_MONTHS. Use both, current, previous, or YYYY-MM.');
}

function* eachDayOfMonth(year: number, monthIndex: number): Generator<Date> {
  const days = new Date(year, monthIndex + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    yield new Date(year, monthIndex, day, 0, 0, 0, 0);
  }
}

function patternToShift(code: PatternCode, shiftIdByCode: Record<string, number>) {
  if (code === 'E') return { shiftCode: 'morning' as ShiftCode, shiftId: shiftIdByCode.morning };
  if (code === 'L') return { shiftCode: 'evening' as ShiftCode, shiftId: shiftIdByCode.evening };
  if (code === 'FD') return { shiftCode: 'full_day' as ShiftCode, shiftId: shiftIdByCode.full_day };
  return { shiftCode: null, shiftId: null };
}

async function seedMonth(target: TargetMonth) {
  const { db } = await import('../lib/db');
  const schema = await import('../lib/db/schema');
  const {
    users,
    stores,
    areas,
    shifts,
    employeeTypes,
    monthlySchedules,
    monthlyScheduleEntries,
    schedules,
    storeOpeningTasks,
    storeFrontTasks,
    setoranTasks,
    cekBinTasks,
    vmChecklistTasks,
    marketingCheckTasks,
    itemDroppingTasks,
    briefingTasks,
    edcReconciliationTasks,
    eodZReportTasks,
    openStatementTasks,
    groomingTasks,
  } = schema;

  console.log(`\n📅 seed-current-month: ${target.yearMonth}`);
  console.log(`   Range: ${target.start.toISOString().slice(0, 10)} → ${target.end.toISOString().slice(0, 10)}\n`);

  const allShifts = await db.select().from(shifts);
  const allEmpTypes = await db.select().from(employeeTypes);

  const shiftIdByCode = Object.fromEntries(allShifts.map((s: any) => [s.code, s.id])) as Record<string, number>;
  const empTypeCodeById = Object.fromEntries(allEmpTypes.map((e: any) => [e.id, e.code])) as Record<number, string>;

  const morningShiftId = shiftIdByCode.morning;
  const eveningShiftId = shiftIdByCode.evening;
  const fullDayShiftId = shiftIdByCode.full_day;

  if (!morningShiftId || !eveningShiftId || !fullDayShiftId) {
    throw new Error('Required shifts missing: morning/evening/full_day. Run seed-setup.ts first.');
  }

  async function findMonthlyEntry(monthlyScheduleId: number, userId: string, date: Date) {
    const [row] = await db
      .select({ id: monthlyScheduleEntries.id })
      .from(monthlyScheduleEntries)
      .where(and(
        eq(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleId),
        eq(monthlyScheduleEntries.userId, userId),
        gte(monthlyScheduleEntries.date, startOfDay(date)),
        lte(monthlyScheduleEntries.date, endOfDay(date)),
      ))
      .limit(1);
    return row ?? null;
  }

  async function upsertMonthlyEntry(input: {
    monthlyScheduleId: number;
    userId: string;
    storeId: number;
    date: Date;
    shiftId: number | null;
    isOff: boolean;
  }) {
    const existing = await findMonthlyEntry(input.monthlyScheduleId, input.userId, input.date);

    if (existing) {
      await db
        .update(monthlyScheduleEntries)
        .set({
          storeId: input.storeId,
          shiftId: input.shiftId ?? null,
          isOff: input.isOff,
          isLeave: false,
        } as any)
        .where(eq(monthlyScheduleEntries.id, existing.id));
      return { id: existing.id, created: false };
    }

    const [created] = await db
      .insert(monthlyScheduleEntries)
      .values({
        monthlyScheduleId: input.monthlyScheduleId,
        userId: input.userId,
        storeId: input.storeId,
        date: startOfDay(input.date),
        shiftId: input.shiftId ?? null,
        isOff: input.isOff,
        isLeave: false,
      } as any)
      .returning({ id: monthlyScheduleEntries.id });

    return { id: created.id, created: true };
  }

  async function findSchedule(userId: string, storeId: number, shiftId: number, date: Date) {
    const [row] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(
        eq(schedules.userId, userId),
        eq(schedules.storeId, storeId),
        eq(schedules.shiftId, shiftId),
        gte(schedules.date, startOfDay(date)),
        lte(schedules.date, endOfDay(date)),
      ))
      .limit(1);
    return row ?? null;
  }

  async function getOrCreateSchedule(input: {
    userId: string;
    storeId: number;
    shiftId: number;
    date: Date;
    monthlyScheduleEntryId: number;
  }) {
    const existing = await findSchedule(input.userId, input.storeId, input.shiftId, input.date);

    if (existing) {
      await db
        .update(schedules)
        .set({ monthlyScheduleEntryId: input.monthlyScheduleEntryId, isHoliday: false } as any)
        .where(eq(schedules.id, existing.id));
      return { id: existing.id, created: false };
    }

    const [created] = await db
      .insert(schedules)
      .values({
        userId: input.userId,
        storeId: input.storeId,
        shiftId: input.shiftId,
        date: startOfDay(input.date),
        monthlyScheduleEntryId: input.monthlyScheduleEntryId,
        isHoliday: false,
      } as any)
      .returning({ id: schedules.id });

    return { id: created.id, created: true };
  }

  async function sharedTaskExists(table: any, storeId: number, date: Date) {
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.storeId, storeId), eq(table.date, startOfDay(date))))
      .limit(1);
    return !!row;
  }

  async function activeTaskExists(table: any, storeId: number, date: Date) {
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(
        eq(table.storeId, storeId),
        eq(table.date, startOfDay(date)),
        inArray(table.status, ['pending', 'in_progress', 'discrepancy'] as any),
      ))
      .limit(1);
    return !!row;
  }

  async function personalTaskExists(table: any, scheduleId: number) {
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.scheduleId, scheduleId))
      .limit(1);
    return !!row;
  }

  const taskCounts: Record<string, number> = {
    storeOpening: 0,
    storeFront: 0,
    setoran: 0,
    cekBin: 0,
    vmChecklist: 0,
    marketingCheck: 0,
    itemDropping: 0,
    briefing: 0,
    edcReconciliation: 0,
    eodZReport: 0,
    openStatement: 0,
    grooming: 0,
  };

  async function seedTasksForSchedule(input: {
    scheduleId: number;
    userId: string;
    storeId: number;
    shiftId: number;
    shiftCode: ShiftCode;
    date: Date;
  }) {
    const date = startOfDay(input.date);
    const isMorning = input.shiftCode === 'morning' || input.shiftCode === 'full_day';
    const isEvening = input.shiftCode === 'evening' || input.shiftCode === 'full_day';

    const morningBase = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: morningShiftId,
      date,
      status: 'pending' as const,
    };

    const eveningBase = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: eveningShiftId,
      date,
      status: 'pending' as const,
    };

    async function insertShared(table: any, base: any, countKey: keyof typeof taskCounts) {
      if (await sharedTaskExists(table, input.storeId, date)) return;
      try {
        await db.insert(table).values(base);
        taskCounts[countKey]++;
      } catch (err) {
        // Safe on reruns/races: unique(storeId, date) may have been inserted by another schedule.
        if (!(await sharedTaskExists(table, input.storeId, date))) throw err;
      }
    }

    async function insertActive(table: any, base: any, countKey: keyof typeof taskCounts) {
      if (await activeTaskExists(table, input.storeId, date)) return;
      await db.insert(table).values(base);
      taskCounts[countKey]++;
    }

    if (isMorning) {
      await insertShared(storeOpeningTasks, morningBase, 'storeOpening');
      await insertShared(storeFrontTasks, morningBase, 'storeFront');
      await insertShared(setoranTasks, { ...morningBase, carriedDeficit: '0', unpaidAmount: '0' }, 'setoran');
      await insertShared(cekBinTasks, morningBase, 'cekBin');
      await insertShared(vmChecklistTasks, morningBase, 'vmChecklist');
      await insertShared(marketingCheckTasks, morningBase, 'marketingCheck');
      await insertActive(itemDroppingTasks, { ...morningBase, hasDropping: false }, 'itemDropping');
    }

    if (isEvening) {
      await insertActive(briefingTasks, eveningBase, 'briefing');
      await insertActive(edcReconciliationTasks, eveningBase, 'edcReconciliation');
      await insertActive(eodZReportTasks, eveningBase, 'eodZReport');
      await insertActive(openStatementTasks, eveningBase, 'openStatement');
    }

    if (!(await personalTaskExists(groomingTasks, input.scheduleId))) {
      await db.insert(groomingTasks).values({
        scheduleId: input.scheduleId,
        userId: input.userId,
        storeId: input.storeId,
        shiftId: input.shiftId,
        date,
        status: 'pending' as const,
      });
      taskCounts.grooming++;
    }
  }

  const storeRows = await db
    .select({ store: stores, area: areas })
    .from(stores)
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .orderBy(areas.name, stores.name);

  if (!storeRows.length) throw new Error('No stores found. Run seed-setup.ts first.');

  let monthlyCreated = 0;
  let entriesCreated = 0;
  let schedulesCreated = 0;
  let schedulesEnsured = 0;

  for (const { store, area } of storeRows as any[]) {
    const employees = await db.select().from(users).where(eq(users.homeStoreId, store.id));

    console.log(`\n── ${store.name} (${area?.name ?? 'no area'}) ──────────────────────`);

    if (!employees.length) {
      console.log('   ⚠️ No employees for this store; skipping.');
      continue;
    }

    const [existingMonthly] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, store.id), eq(monthlySchedules.yearMonth, target.yearMonth)))
      .limit(1);

    let monthlyScheduleId: number;

    if (existingMonthly) {
      monthlyScheduleId = existingMonthly.id;
    } else {
      const pic = employees.find((e: any) => e.employeeTypeId != null && empTypeCodeById[e.employeeTypeId] === 'pic_1') ?? employees[0];
      const [created] = await db
        .insert(monthlySchedules)
        .values({
          storeId: store.id,
          yearMonth: target.yearMonth,
          importedBy: pic.id,
          note: `Auto-seeded ${target.yearMonth}`,
        } as any)
        .returning({ id: monthlySchedules.id });
      monthlyScheduleId = created.id;
      monthlyCreated++;
    }

    for (const [empIndex, emp] of (employees as any[]).entries()) {
      const empTypeCode = emp.employeeTypeId != null ? empTypeCodeById[emp.employeeTypeId] ?? 'default' : 'default';
      const pattern = PATTERNS[empTypeCode] ?? PATTERNS.default;

      let empEntriesCreated = 0;
      let empSchedulesCreated = 0;
      let empSchedulesEnsured = 0;

      for (const date of eachDayOfMonth(target.year, target.monthIndex)) {
        const patternCode = date.getDate() === 15 && empIndex === 0
          ? 'FD'
          : pattern[date.getDay()] ?? 'OFF';
        const { shiftCode, shiftId } = patternToShift(patternCode, shiftIdByCode);
        const dateVal = startOfDay(date);
        const isOff = !shiftCode || !shiftId;

        const monthlyEntry = await upsertMonthlyEntry({
          monthlyScheduleId,
          userId: emp.id,
          storeId: store.id,
          date: dateVal,
          shiftId: shiftId ?? null,
          isOff,
        });

        if (monthlyEntry.created) {
          entriesCreated++;
          empEntriesCreated++;
        }

        if (isOff || !shiftCode || !shiftId) continue;

        const schedule = await getOrCreateSchedule({
          userId: emp.id,
          storeId: store.id,
          shiftId,
          date: dateVal,
          monthlyScheduleEntryId: monthlyEntry.id,
        });

        if (schedule.created) {
          schedulesCreated++;
          empSchedulesCreated++;
        } else {
          schedulesEnsured++;
          empSchedulesEnsured++;
        }

        await seedTasksForSchedule({
          scheduleId: schedule.id,
          userId: emp.id,
          storeId: store.id,
          shiftId,
          shiftCode,
          date: dateVal,
        });
      }

      console.log(
        `   👤 ${String(emp.name).padEnd(18)} (${empTypeCode.padEnd(8)})` +
          ` entries+${empEntriesCreated} schedules+${empSchedulesCreated} ensured=${empSchedulesEnsured}`,
      );
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`✅ seed-current-month complete (${target.yearMonth})`);
  console.log(`   Monthly schedules created : ${monthlyCreated}`);
  console.log(`   Entries created           : ${entriesCreated}`);
  console.log(`   Schedules created         : ${schedulesCreated}`);
  console.log(`   Existing schedules ensured: ${schedulesEnsured}`);
  console.log('   Tasks created:');
  for (const [key, value] of Object.entries(taskCounts)) console.log(`     ↳ ${key.padEnd(18)}: ${value}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

async function main() {
  const targets = resolveScheduleMonths();
  console.log(`
🗓️  Schedule seeding target months: ${targets.map((t) => t.yearMonth).join(', ')}
`);

  for (const target of targets) {
    await seedMonth(target);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ seed-current-month failed:', err);
    process.exit(1);
  });

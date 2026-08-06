// scripts/seed/schedules.ts
// Fast schedule seeder.
//
// Important change for speed:
// - This file seeds monthly schedule entries + schedules ONLY.
// - Task rows are seeded by scripts/seed/tasks.ts in bulk.
//
// Every employee at every store gets exactly WORKING_DAYS_PER_MONTH (26)
// scheduled/working days per month — the remaining days (2-5, depending on
// how long the month is) are OFF. Off days are spread roughly evenly across
// the month, with a per-employee offset (their index within the store) so
// employees at the same store don't all land on the same off days. Shift
// type (morning/evening/full_day) on working days cycles per employee type
// (see SHIFT_CYCLES) instead of following the calendar day-of-week.
//
// Supported env:
//   SEED_SCHEDULE_MONTHS=both | current | previous | YYYY-MM
//   SEED_MONTH=current | previous | YYYY-MM
//   SEED_WORKING_DAYS=26 (override the per-employee working-day target)

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  users,
  stores,
  areas,
  shifts,
  employeeTypes,
  monthlySchedules,
  monthlyScheduleEntries,
  schedules,
} from '@/lib/db/schema';

type ShiftCode = 'morning' | 'evening' | 'full_day';
type PatternCode = 'E' | 'L' | 'FD' | 'OFF';

type TargetMonth = {
  year: number;
  monthIndex: number;
  start: Date;
  end: Date;
  yearMonth: string;
};

const BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE ?? 500);

// Target working (non-OFF) days per employee per month. The rest of the
// month's days become OFF, spread evenly (see pickOffDayIndices).
const WORKING_DAYS_PER_MONTH = Number(process.env.SEED_WORKING_DAYS ?? 26);

// Shift type on a WORKING day, cycled by the employee's position among their
// own working days (not by calendar day-of-week). The store's designated
// full-day employee (see fullDayEmployee below) always gets 'FD' instead,
// on whichever days they work.
const SHIFT_CYCLES: Record<string, PatternCode[]> = {
  pic_1: ['E'],
  pic_2: ['E', 'L'],
  sa: ['L'],
  default: ['E'],
};

/**
 * Picks `offCount` day-indices (0-based, within a `daysInMonth`-day month)
 * to mark OFF, spread roughly evenly across the month. `offset` shifts the
 * whole pattern (e.g. by employee index) so employees at the same store
 * don't all share the same off days.
 */
function pickOffDayIndices(daysInMonth: number, offCount: number, offset: number): Set<number> {
  const offIdx = new Set<number>();
  if (offCount <= 0) return offIdx;

  const step = daysInMonth / offCount;
  for (let k = 0; k < offCount; k++) {
    const idx = Math.floor((k + 0.5) * step + offset) % daysInMonth;
    offIdx.add(idx);
  }

  return offIdx;
}

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

function resolveTargetMonth(defaultMode: 'current' | 'previous' = 'current'): TargetMonth {
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
    return uniqueMonths([resolveTargetMonth('previous'), resolveTargetMonth('current')]);
  }

  if (raw === 'current') return [resolveTargetMonth('current')];
  if (raw === 'previous' || raw === 'last') return [resolveTargetMonth('previous')];

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const old = process.env.SEED_MONTH;
    process.env.SEED_MONTH = raw;
    const target = resolveTargetMonth('current');
    if (old === undefined) delete process.env.SEED_MONTH;
    else process.env.SEED_MONTH = old;
    return [target];
  }

  throw new Error('Invalid SEED_SCHEDULE_MONTHS. Use both, current, previous, or YYYY-MM.');
}

function eachDayOfMonth(year: number, monthIndex: number): Date[] {
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) => new Date(year, monthIndex, i + 1, 0, 0, 0, 0));
}

function patternToShift(code: PatternCode, shiftIdByCode: Record<string, number>) {
  if (code === 'E') return { shiftCode: 'morning' as ShiftCode, shiftId: shiftIdByCode.morning };
  if (code === 'L') return { shiftCode: 'evening' as ShiftCode, shiftId: shiftIdByCode.evening };
  if (code === 'FD') return { shiftCode: 'full_day' as ShiftCode, shiftId: shiftIdByCode.full_day };
  return { shiftCode: null, shiftId: null };
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

async function seedMonth(target: TargetMonth) {
  console.log(`\n📅 seed-current-month: ${target.yearMonth}`);
  console.log(`   Range: ${ymd(target.start)} → ${ymd(target.end)}`);

  const [allShifts, allEmpTypes, storeRows] = await Promise.all([
    db.select().from(shifts),
    db.select().from(employeeTypes),
    db
      .select({ store: stores, area: areas })
      .from(stores)
      .leftJoin(areas, eq(stores.areaId, areas.id))
      .orderBy(areas.name, stores.name),
  ]);

  if (!storeRows.length) throw new Error('No stores found. Run the setup seed step first.');

  const shiftIdByCode = Object.fromEntries(allShifts.map((s: any) => [s.code, s.id])) as Record<string, number>;
  const empTypeCodeById = Object.fromEntries(allEmpTypes.map((e: any) => [e.id, e.code])) as Record<number, string>;

  if (!shiftIdByCode.morning || !shiftIdByCode.evening || !shiftIdByCode.full_day) {
    throw new Error('Required shifts missing: morning/evening/full_day. Run the setup seed step first.');
  }

  const storeIds = storeRows.map(({ store }: any) => store.id);

  const allEmployees = await db.select().from(users).where(inArray(users.homeStoreId, storeIds));
  const employeesByStoreId = new Map<number, any[]>();
  for (const emp of allEmployees as any[]) {
    if (emp.homeStoreId == null) continue;
    const rows = employeesByStoreId.get(emp.homeStoreId) ?? [];
    rows.push(emp);
    employeesByStoreId.set(emp.homeStoreId, rows);
  }

  // ── Monthly schedule master rows ──────────────────────────────────────────
  const existingMonthlyRows = await db
    .select({ id: monthlySchedules.id, storeId: monthlySchedules.storeId, yearMonth: monthlySchedules.yearMonth })
    .from(monthlySchedules)
    .where(and(inArray(monthlySchedules.storeId, storeIds), eq(monthlySchedules.yearMonth, target.yearMonth)));

  const monthlyKey = (storeId: number) => `${storeId}|${target.yearMonth}`;
  const existingMonthlyKeys = new Set(existingMonthlyRows.map((r: any) => monthlyKey(r.storeId)));

  const monthlyToInsert = [] as Array<typeof monthlySchedules.$inferInsert>;
  for (const { store } of storeRows as any[]) {
    if (existingMonthlyKeys.has(monthlyKey(store.id))) continue;
    const emps = employeesByStoreId.get(store.id) ?? [];
    if (!emps.length) continue;
    const pic = emps.find((e) => e.employeeTypeId != null && empTypeCodeById[e.employeeTypeId] === 'pic_1') ?? emps[0];
    monthlyToInsert.push({
      storeId: store.id,
      yearMonth: target.yearMonth,
      importedBy: pic.id,
      note: `Auto-seeded ${target.yearMonth}`,
    } as any);
  }

  const monthlyCreated = await insertInBatches(monthlySchedules, monthlyToInsert);

  const monthlyRows = await db
    .select({ id: monthlySchedules.id, storeId: monthlySchedules.storeId, yearMonth: monthlySchedules.yearMonth })
    .from(monthlySchedules)
    .where(and(inArray(monthlySchedules.storeId, storeIds), eq(monthlySchedules.yearMonth, target.yearMonth)));

  const monthlyIdByStoreId = new Map<number, number>();
  for (const row of monthlyRows as any[]) monthlyIdByStoreId.set(row.storeId, row.id);

  // ── Build entries in memory ───────────────────────────────────────────────
  const days = eachDayOfMonth(target.year, target.monthIndex);
  const monthlyScheduleIds = [...monthlyIdByStoreId.values()];

  const existingEntries = monthlyScheduleIds.length
    ? await db
        .select({
          id: monthlyScheduleEntries.id,
          monthlyScheduleId: monthlyScheduleEntries.monthlyScheduleId,
          userId: monthlyScheduleEntries.userId,
          date: monthlyScheduleEntries.date,
        })
        .from(monthlyScheduleEntries)
        .where(and(
          inArray(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleIds),
          gte(monthlyScheduleEntries.date, startOfDay(target.start)),
          lte(monthlyScheduleEntries.date, endOfDay(target.end)),
        ))
    : [];

  const entryKey = (monthlyScheduleId: number, userId: string, date: Date) => `${monthlyScheduleId}|${userId}|${ymd(date)}`;
  const existingEntryKeys = new Set(existingEntries.map((r: any) => entryKey(r.monthlyScheduleId, r.userId, r.date)));

  const entryRows: Array<typeof monthlyScheduleEntries.$inferInsert> = [];

  for (const { store, area } of storeRows as any[]) {
    const emps = employeesByStoreId.get(store.id) ?? [];
    if (!emps.length) {
      console.log(`   ⚠️ ${store.name}: no employees, skipped.`);
      continue;
    }

    const monthlyScheduleId = monthlyIdByStoreId.get(store.id);
    if (!monthlyScheduleId) continue;

    const fullDayEmployee = emps.find((e) => e.employeeTypeId != null && empTypeCodeById[e.employeeTypeId] === 'pic_1') ?? emps[0];
    const daysInMonth = days.length;
    const offDaysCount = Math.max(0, daysInMonth - WORKING_DAYS_PER_MONTH);
    console.log(
      `   🏪 ${store.name} (${area?.name ?? 'no area'}) → full-day: ${fullDayEmployee.name} · ` +
      `${WORKING_DAYS_PER_MONTH}/${daysInMonth} working days per employee`,
    );

    emps.forEach((emp, empIndex) => {
      const empTypeCode = emp.employeeTypeId != null ? empTypeCodeById[emp.employeeTypeId] ?? 'default' : 'default';
      const cycle = SHIFT_CYCLES[empTypeCode] ?? SHIFT_CYCLES.default;
      const isDailyFullDayEmployee = emp.id === fullDayEmployee.id;

      // Stagger each employee's off days by their position at the store so
      // coworkers don't all land on the same off day.
      const offDayIndices = pickOffDayIndices(daysInMonth, offDaysCount, empIndex);

      let workingDayIndex = 0;
      days.forEach((date, dayIndex) => {
        const isScheduledOff = offDayIndices.has(dayIndex);

        let patternCode: PatternCode;
        if (isScheduledOff) {
          patternCode = 'OFF';
        } else if (isDailyFullDayEmployee) {
          patternCode = 'FD';
          workingDayIndex += 1;
        } else {
          patternCode = cycle[workingDayIndex % cycle.length];
          workingDayIndex += 1;
        }

        const { shiftId } = patternToShift(patternCode, shiftIdByCode);
        const isOff = !shiftId;
        const key = entryKey(monthlyScheduleId, emp.id, date);
        if (existingEntryKeys.has(key)) return;

        entryRows.push({
          monthlyScheduleId,
          userId: emp.id,
          storeId: store.id,
          date: startOfDay(date),
          shiftId: shiftId ?? null,
          isOff,
          isLeave: false,
        } as any);
      });
    });
  }

  const entriesCreated = await insertInBatches(monthlyScheduleEntries, entryRows);

  const allEntries = monthlyScheduleIds.length
    ? await db
        .select({
          id: monthlyScheduleEntries.id,
          monthlyScheduleId: monthlyScheduleEntries.monthlyScheduleId,
          userId: monthlyScheduleEntries.userId,
          storeId: monthlyScheduleEntries.storeId,
          date: monthlyScheduleEntries.date,
          shiftId: monthlyScheduleEntries.shiftId,
          isOff: monthlyScheduleEntries.isOff,
          isLeave: monthlyScheduleEntries.isLeave,
        })
        .from(monthlyScheduleEntries)
        .where(and(
          inArray(monthlyScheduleEntries.monthlyScheduleId, monthlyScheduleIds),
          gte(monthlyScheduleEntries.date, startOfDay(target.start)),
          lte(monthlyScheduleEntries.date, endOfDay(target.end)),
        ))
    : [];

  const activeEntries = (allEntries as any[]).filter((e) => !e.isOff && !e.isLeave && e.shiftId != null);

  const existingSchedules = await db
    .select({ userId: schedules.userId, storeId: schedules.storeId, date: schedules.date })
    .from(schedules)
    .where(and(
      inArray(schedules.storeId, storeIds),
      gte(schedules.date, startOfDay(target.start)),
      lte(schedules.date, endOfDay(target.end)),
    ));

  const scheduleKey = (userId: string, storeId: number, date: Date) => `${userId}|${storeId}|${ymd(date)}`;
  const existingScheduleKeys = new Set(existingSchedules.map((r: any) => scheduleKey(r.userId, r.storeId, r.date)));

  const scheduleRowsToInsert = activeEntries
    .filter((entry) => !existingScheduleKeys.has(scheduleKey(entry.userId, entry.storeId, entry.date)))
    .map((entry) => ({
      userId: entry.userId,
      storeId: entry.storeId,
      shiftId: entry.shiftId,
      date: startOfDay(entry.date),
      monthlyScheduleEntryId: entry.id,
      isHoliday: false,
    } as typeof schedules.$inferInsert));

  const schedulesCreated = await insertInBatches(schedules, scheduleRowsToInsert);
  const schedulesExisting = activeEntries.length - schedulesCreated;

  console.log(`   ✓ monthly masters created : ${monthlyCreated}`);
  console.log(`   ✓ monthly entries created : ${entriesCreated}`);
  console.log(`   ✓ schedules created       : ${schedulesCreated}`);
  console.log(`   ✓ schedules existing      : ${schedulesExisting}`);
}

export async function seedSchedules() {
  const targets = resolveScheduleMonths();
  console.log(`\n🗓️  Schedule months: ${targets.map((t) => t.yearMonth).join(', ')}`);
  console.log('⚡ Fast mode: schedules only. Tasks are seeded separately.');

  for (const target of targets) await seedMonth(target);

  console.log('\n✅ seed-schedules complete.');
}

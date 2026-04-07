// scripts/seed-current-month.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds schedules + tasks for the CURRENT calendar month.
// Updated for lookup-table schema (shifts, employeeTypes are now tables).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
import {
  users, stores, areas, shifts, employeeTypes,
  monthlySchedules, monthlyScheduleEntries, schedules,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, receivingTasks, briefingTasks,
  edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

// ─── Target: current month ────────────────────────────────────────────────────

const NOW        = new Date();
const YEAR       = NOW.getFullYear();
const MONTH      = NOW.getMonth();          // 0-indexed
const YEAR_MONTH = `${YEAR}-${String(MONTH + 1).padStart(2, '0')}`;

// ─── Shift patterns (keyed by employee type CODE) ─────────────────────────────
// 'E' = morning shift, 'L' = evening shift, 'OFF' = day off

const PATTERNS: Record<string, string[]> = {
  pic_1:   ['OFF', 'E',   'E',   'E',   'E',   'E',   'OFF'],
  pic_2:   ['OFF', 'E',   'L',   'E',   'L',   'E',   'L'  ],
  so:      ['OFF', 'OFF', 'L',   'L',   'L',   'L',   'L'  ],
  default: ['OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function* eachDayOfMonth(year: number, month: number): Generator<Date> {
  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) yield new Date(year, month, d, 0, 0, 0, 0);
}

async function sharedExists(
  table: typeof storeOpeningTasks,
  storeId: number,
  date: Date,
): Promise<boolean> {
  const [r] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.storeId, storeId), eq(table.date, startOfDay(date))))
    .limit(1);
  return !!r;
}

async function personalExists(
  table: typeof groomingTasks,
  scheduleId: number,
): Promise<boolean> {
  const [r] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.scheduleId, scheduleId))
    .limit(1);
  return !!r;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedCurrentMonth() {
  console.log(`\n📅  seed-current-month: ${YEAR_MONTH}\n`);

  // ── Resolve lookup ids up front ─────────────────────────────────────────────
  const allShifts    = await db.select().from(shifts);
  const allEmpTypes  = await db.select().from(employeeTypes);

  const shiftIdByCode  = Object.fromEntries(allShifts.map(s => [s.code, s.id])) as Record<string, number>;
  const empTypeCodeById = Object.fromEntries(allEmpTypes.map(e => [e.id, e.code])) as Record<number, string>;

  if (!shiftIdByCode.morning || !shiftIdByCode.evening) {
    console.error('❌  Required shifts (morning, evening) not found. Run seed-setup.ts first.');
    process.exit(1);
  }

  const allStores = await db
    .select({ store: stores, area: areas })
    .from(stores)
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .orderBy(areas.name, stores.name);

  if (!allStores.length) {
    console.error('❌  No stores found. Run seed-setup.ts first.');
    process.exit(1);
  }

  // ── Counters ───────────────────────────────────────────────────────────────
  let totalMs        = 0;
  let totalEntries   = 0;
  let totalSchedRows = 0;
  const taskCounts: Record<string, number> = {
    storeOpening: 0, setoran: 0, cekBin: 0, productCheck: 0, receiving: 0,
    briefing: 0, edcSummary: 0, edcSettlement: 0, eodZReport: 0, openStatement: 0,
    grooming: 0,
  };

  for (const { store, area } of allStores) {
    console.log(`\n── ${store.name} (${area?.name ?? 'no area'}) ──────────────────────`);

    const employees = await db
      .select()
      .from(users)
      .where(eq(users.homeStoreId, store.id));

    if (!employees.length) {
      console.log('   ⚠️  No employees — skipping');
      continue;
    }

    // ── MonthlySchedule header ─────────────────────────────────────────────
    const [existingMs] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, store.id), eq(monthlySchedules.yearMonth, YEAR_MONTH)))
      .limit(1);

    let msId: number;

    if (existingMs) {
      msId = existingMs.id;
      console.log(`   ↩️  MonthlySchedule exists (id=${msId})`);
    } else {
      // Find a PIC1 to attribute the import to
      const pic1Code = 'pic_1';
      const pic1 = employees.find(
        e => e.employeeTypeId != null && empTypeCodeById[e.employeeTypeId] === pic1Code,
      ) ?? employees[0];

      const [ms] = await db
        .insert(monthlySchedules)
        .values({ storeId: store.id, yearMonth: YEAR_MONTH, importedBy: pic1.id, note: `Auto-seeded ${YEAR_MONTH}` })
        .returning({ id: monthlySchedules.id });
      msId = ms.id;
      totalMs++;
      console.log(`   ✅ Created MonthlySchedule id=${msId}`);
    }

    // ── Per-employee entries + schedule rows ───────────────────────────────
    for (const emp of employees) {
      const empTypeCode = emp.employeeTypeId != null
        ? empTypeCodeById[emp.employeeTypeId] ?? 'default'
        : 'default';
      const pattern = PATTERNS[empTypeCode] ?? PATTERNS.default;

      let empEntries   = 0;
      let empSchedules = 0;

      for (const date of eachDayOfMonth(YEAR, MONTH)) {
        const code      = pattern[date.getDay()] ?? 'OFF';
        const shiftCode = code === 'E' ? 'morning' : code === 'L' ? 'evening' : null;
        const isOff     = !shiftCode;
        const shiftId   = shiftCode ? shiftIdByCode[shiftCode] : null;
        const dateVal   = startOfDay(date);

        // MonthlyScheduleEntry
        const [mse] = await db
          .insert(monthlyScheduleEntries)
          .values({
            monthlyScheduleId: msId,
            userId:  emp.id,
            storeId: store.id,
            date:    dateVal,
            shiftId: shiftId ?? undefined,
            isOff,
            isLeave: false,
          })
          .onConflictDoNothing()
          .returning({ id: monthlyScheduleEntries.id });

        if (mse) empEntries++;
        if (isOff || !shiftId) continue;

        // Idempotency check for schedule row
        const [existingSched] = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(and(
            eq(schedules.userId,  emp.id),
            eq(schedules.storeId, store.id),
            eq(schedules.shiftId, shiftId),
            gte(schedules.date,   startOfDay(dateVal)),
            lte(schedules.date,   endOfDay(dateVal)),
          ))
          .limit(1);

        if (existingSched) {
          await seedTasksForSchedule(existingSched.id, emp.id, store.id, shiftId, shiftCode!, dateVal, taskCounts);
          continue;
        }

        // Resolve MSE id
        const mseId: number | undefined = mse?.id ?? (
          await db
            .select({ id: monthlyScheduleEntries.id })
            .from(monthlyScheduleEntries)
            .where(and(
              eq(monthlyScheduleEntries.monthlyScheduleId, msId),
              eq(monthlyScheduleEntries.userId,            emp.id),
              gte(monthlyScheduleEntries.date,             startOfDay(dateVal)),
              lte(monthlyScheduleEntries.date,             endOfDay(dateVal)),
            ))
            .limit(1)
            .then(rows => rows[0]?.id)
        );

        if (!mseId) {
          console.warn(`   ⚠️  No MSE id for ${emp.name} on ${dateVal.toISOString().slice(0,10)}`);
          continue;
        }

        const [newSched] = await db
          .insert(schedules)
          .values({
            userId:  emp.id,
            storeId: store.id,
            shiftId,
            date:    dateVal,
            monthlyScheduleEntryId: mseId,
            isHoliday: false,
          })
          .returning({ id: schedules.id });

        empSchedules++;
        totalSchedRows++;

        await seedTasksForSchedule(newSched.id, emp.id, store.id, shiftId, shiftCode!, dateVal, taskCounts);
      }

      totalEntries += empEntries;
      console.log(
        `   👤 ${emp.name.padEnd(18)} (${empTypeCode.padEnd(7)})` +
        `  entries+${empEntries}  schedRows+${empSchedules}`,
      );
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`✅  seed-current-month complete!  (${YEAR_MONTH})\n`);
  console.log(`   MonthlySchedules created : ${totalMs}`);
  console.log(`   Entries inserted         : ${totalEntries}`);
  console.log(`   Schedule rows created    : ${totalSchedRows}`);
  console.log('\n   Tasks created:');
  for (const [name, n] of Object.entries(taskCounts)) {
    console.log(`     ↳ ${name.padEnd(16)}: ${n}`);
  }
  console.log('═══════════════════════════════════════════════════════════\n');
}

// ─── Task seeder (per schedule row) ──────────────────────────────────────────

async function seedTasksForSchedule(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  shiftId:    number,
  shiftCode:  string,
  date:       Date,
  counts:     Record<string, number>,
) {
  const base = { scheduleId, userId, storeId, shiftId, date, status: 'pending' as const };

  try {
    if (shiftCode === 'morning') {
      if (!await sharedExists(storeOpeningTasks  as any, storeId, date)) { await db.insert(storeOpeningTasks).values(base);  counts.storeOpening++; }
      if (!await sharedExists(setoranTasks       as any, storeId, date)) { await db.insert(setoranTasks).values(base);       counts.setoran++;      }
      if (!await sharedExists(cekBinTasks        as any, storeId, date)) { await db.insert(cekBinTasks).values(base);        counts.cekBin++;       }
      if (!await sharedExists(productCheckTasks  as any, storeId, date)) { await db.insert(productCheckTasks).values(base);  counts.productCheck++; }
      if (!await sharedExists(receivingTasks     as any, storeId, date)) { await db.insert(receivingTasks).values(base);     counts.receiving++;    }
    }
    if (shiftCode === 'evening') {
      if (!await sharedExists(briefingTasks      as any, storeId, date)) { await db.insert(briefingTasks).values(base);      counts.briefing++;      }
      if (!await sharedExists(edcSummaryTasks    as any, storeId, date)) { await db.insert(edcSummaryTasks).values(base);    counts.edcSummary++;    }
      if (!await sharedExists(edcSettlementTasks as any, storeId, date)) { await db.insert(edcSettlementTasks).values(base); counts.edcSettlement++; }
      if (!await sharedExists(eodZReportTasks    as any, storeId, date)) { await db.insert(eodZReportTasks).values(base);    counts.eodZReport++;    }
      if (!await sharedExists(openStatementTasks as any, storeId, date)) { await db.insert(openStatementTasks).values(base); counts.openStatement++; }
    }
    if (!await personalExists(groomingTasks, scheduleId)) {
      await db.insert(groomingTasks).values(base);
      counts.grooming++;
    }
  } catch (err) {
    console.error(`   ❌ Task seed error for schedule ${scheduleId}:`, err);
  }
}

seedCurrentMonth()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-current-month failed:', err); process.exit(1); });
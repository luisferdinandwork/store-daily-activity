// scripts/seed-current-month.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds schedules + tasks for the CURRENT calendar month.
//
// Changes from original:
//   • Adds 'full_day' shift pattern (FD) — creates both morning + evening tasks
//   • Evening task existence check uses active-row query (no unique constraint)
//   • Morning task rows use morningShiftId; evening task rows use eveningShiftId
//     so the UI can group tasks correctly even for full_day employees
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
import {
  users, stores, areas, shifts, employeeTypes,
  monthlySchedules, monthlyScheduleEntries, schedules,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, itemDroppingTasks, briefingTasks,
  edcReconciliationTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';

// ─── Target: current month ────────────────────────────────────────────────────

const NOW        = new Date();
const YEAR       = NOW.getFullYear();
const MONTH      = NOW.getMonth();
const YEAR_MONTH = `${YEAR}-${String(MONTH + 1).padStart(2, '0')}`;

// ─── Shift patterns (keyed by employee type CODE) ─────────────────────────────
// 'E' = morning, 'L' = evening, 'FD' = full_day, 'OFF' = day off

const PATTERNS: Record<string, string[]> = {
  pic_1:   ['OFF', 'E',   'E',   'E',   'E',   'E',   'OFF'],
  pic_2:   ['OFF', 'E',   'L',   'E',   'L',   'E',   'L'  ],
  sa:      ['OFF', 'OFF', 'L',   'L',   'L',   'L',   'L'  ],
  default: ['OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function* eachDayOfMonth(year: number, month: number): Generator<Date> {
  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) yield new Date(year, month, d, 0, 0, 0, 0);
}

/** Morning tasks: unique(storeId, date) — check by store + date. */
async function morningSharedExists(
  table: typeof storeOpeningTasks,
  storeId: number,
  date: Date,
): Promise<boolean> {
  const [r] = await db
    .select({ id: table.id }).from(table)
    .where(and(eq(table.storeId, storeId), eq(table.date, startOfDay(date))))
    .limit(1);
  return !!r;
}

/**
 * Evening tasks: no unique constraint — check for any active row
 * (pending / in_progress / discrepancy) to avoid duplicates.
 */
async function eveningActiveExists(
  table: typeof briefingTasks,
  storeId: number,
  date: Date,
): Promise<boolean> {
  const [r] = await db
    .select({ id: table.id }).from(table)
    .where(and(
      eq(table.storeId, storeId),
      eq(table.date, startOfDay(date)),
      inArray(table.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .limit(1);
  return !!r;
}

async function personalExists(
  table: typeof groomingTasks,
  scheduleId: number,
): Promise<boolean> {
  const [r] = await db.select({ id: table.id }).from(table)
    .where(eq(table.scheduleId, scheduleId)).limit(1);
  return !!r;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedCurrentMonth() {
  console.log(`\n📅  seed-current-month: ${YEAR_MONTH}\n`);

  const allShifts        = await db.select().from(shifts);
  const allEmpTypes      = await db.select().from(employeeTypes);

  const shiftIdByCode    = Object.fromEntries(allShifts.map(s => [s.code, s.id])) as Record<string, number>;
  const empTypeCodeById  = Object.fromEntries(allEmpTypes.map(e => [e.id, e.code])) as Record<number, string>;

  const morningShiftId   = shiftIdByCode['morning'];
  const eveningShiftId   = shiftIdByCode['evening'];
  const fullDayShiftId   = shiftIdByCode['full_day'];

  if (!morningShiftId || !eveningShiftId) {
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

  let totalMs        = 0;
  let totalEntries   = 0;
  let totalSchedRows = 0;
  const taskCounts: Record<string, number> = {
    storeOpening: 0, setoran: 0, cekBin: 0, productCheck: 0, itemDropping: 0,  // ← CHANGED
    briefing: 0, edcReconciliation: 0, eodZReport: 0, openStatement: 0,        // ← CHANGED
    grooming: 0,
  };

  for (const { store, area } of allStores) {
    console.log(`\n── ${store.name} (${area?.name ?? 'no area'}) ──────────────────────`);

    const employees = await db.select().from(users).where(eq(users.homeStoreId, store.id));

    if (!employees.length) { console.log('   ⚠️  No employees — skipping'); continue; }

    const [existingMs] = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, store.id), eq(monthlySchedules.yearMonth, YEAR_MONTH))).limit(1);

    let msId: number;

    if (existingMs) {
      msId = existingMs.id;
      console.log(`   ↩️  MonthlySchedule exists (id=${msId})`);
    } else {
      const pic1 = employees.find(
        e => e.employeeTypeId != null && empTypeCodeById[e.employeeTypeId] === 'pic_1',
      ) ?? employees[0];

      const [ms] = await db.insert(monthlySchedules)
        .values({ storeId: store.id, yearMonth: YEAR_MONTH, importedBy: pic1.id, note: `Auto-seeded ${YEAR_MONTH}` })
        .returning({ id: monthlySchedules.id });
      msId = ms.id;
      totalMs++;
      console.log(`   ✅ Created MonthlySchedule id=${msId}`);
    }

    for (const emp of employees) {
      const empTypeCode = emp.employeeTypeId != null
        ? empTypeCodeById[emp.employeeTypeId] ?? 'default'
        : 'default';
      const pattern = PATTERNS[empTypeCode] ?? PATTERNS.default;

      let empEntries   = 0;
      let empSchedules = 0;

      for (const date of eachDayOfMonth(YEAR, MONTH)) {
        const code = pattern[date.getDay()] ?? 'OFF';

        // Map pattern code to shift
        let shiftCode: string | null = null;
        let shiftId:   number | null = null;

        if      (code === 'E')  { shiftCode = 'morning';  shiftId = morningShiftId; }
        else if (code === 'L')  { shiftCode = 'evening';  shiftId = eveningShiftId; }
        else if (code === 'FD') { shiftCode = 'full_day'; shiftId = fullDayShiftId ?? null; }

        const isOff   = !shiftCode;
        const dateVal = startOfDay(date);

        const [mse] = await db.insert(monthlyScheduleEntries)
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
        const [existingSched] = await db.select({ id: schedules.id }).from(schedules).where(and(
          eq(schedules.userId,  emp.id),
          eq(schedules.storeId, store.id),
          eq(schedules.shiftId, shiftId),
          gte(schedules.date,   startOfDay(dateVal)),
          lte(schedules.date,   endOfDay(dateVal)),
        )).limit(1);

        if (existingSched) {
          await seedTasksForSchedule(existingSched.id, emp.id, store.id, shiftId, shiftCode!, morningShiftId, eveningShiftId, dateVal, taskCounts);
          continue;
        }

        const mseId: number | undefined = mse?.id ?? (
          await db.select({ id: monthlyScheduleEntries.id }).from(monthlyScheduleEntries)
            .where(and(
              eq(monthlyScheduleEntries.monthlyScheduleId, msId),
              eq(monthlyScheduleEntries.userId, emp.id),
              gte(monthlyScheduleEntries.date, startOfDay(dateVal)),
              lte(monthlyScheduleEntries.date, endOfDay(dateVal)),
            ))
            .limit(1).then(rows => rows[0]?.id)
        );

        if (!mseId) {
          console.warn(`   ⚠️  No MSE id for ${emp.name} on ${dateVal.toISOString().slice(0, 10)}`);
          continue;
        }

        const [newSched] = await db.insert(schedules).values({
          userId: emp.id, storeId: store.id, shiftId, date: dateVal,
          monthlyScheduleEntryId: mseId, isHoliday: false,
        }).returning({ id: schedules.id });

        empSchedules++;
        totalSchedRows++;

        await seedTasksForSchedule(newSched.id, emp.id, store.id, shiftId, shiftCode!, morningShiftId, eveningShiftId, dateVal, taskCounts);
      }

      totalEntries += empEntries;
      console.log(
        `   👤 ${emp.name.padEnd(18)} (${empTypeCode.padEnd(8)})` +
        `  entries+${empEntries}  schedRows+${empSchedules}`,
      );
    }
  }

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
  scheduleId:    number,
  userId:        string,
  storeId:       number,
  shiftId:       number,      // the schedule's actual shiftId (may be full_day)
  shiftCode:     string,      // 'morning' | 'evening' | 'full_day'
  morningShiftId: number,     // resolved morning shift PK
  eveningShiftId: number,     // resolved evening shift PK
  date:          Date,
  counts:        Record<string, number>,
) {
  const isMorning = shiftCode === 'morning'  || shiftCode === 'full_day';
  const isEvening = shiftCode === 'evening'  || shiftCode === 'full_day';

  // Morning task rows always carry morningShiftId; evening rows always carry eveningShiftId.
  // This lets the UI group tasks by logical shift even for full_day employees.
  const morningBase = { scheduleId, userId, storeId, shiftId: morningShiftId, date, status: 'pending' as const };
  const eveningBase = { scheduleId, userId, storeId, shiftId: eveningShiftId, date, status: 'pending' as const };

  try {
    if (isMorning) {
      if (!await morningSharedExists(storeOpeningTasks  as any, storeId, date)) { await db.insert(storeOpeningTasks).values(morningBase);  counts.storeOpening++; }
      if (!await morningSharedExists(setoranTasks       as any, storeId, date)) { await db.insert(setoranTasks).values(morningBase);       counts.setoran++;      }
      if (!await morningSharedExists(cekBinTasks        as any, storeId, date)) { await db.insert(cekBinTasks).values(morningBase);        counts.cekBin++;       }
      if (!await morningSharedExists(productCheckTasks  as any, storeId, date)) { await db.insert(productCheckTasks).values(morningBase);  counts.productCheck++; }
      
      // CHANGED: receivingTasks → itemDroppingTasks. Uses eveningActiveExists 
      // because itemDroppingTasks is discrepancy-capable and lacks a (storeId, date) unique constraint.
      if (!await eveningActiveExists(itemDroppingTasks as any, storeId, date)) { await db.insert(itemDroppingTasks).values(morningBase); counts.itemDropping++; }
    }
    if (isEvening) {
      if (!await eveningActiveExists(briefingTasks          as any, storeId, date)) { await db.insert(briefingTasks).values(eveningBase);          counts.briefing++;          }
      
      // CHANGED: Merged edcSummaryTasks & edcSettlementTasks into edcReconciliationTasks
      if (!await eveningActiveExists(edcReconciliationTasks as any, storeId, date)) { await db.insert(edcReconciliationTasks).values(eveningBase); counts.edcReconciliation++; }
      
      if (!await eveningActiveExists(eodZReportTasks        as any, storeId, date)) { await db.insert(eodZReportTasks).values(eveningBase);        counts.eodZReport++;        }
      if (!await eveningActiveExists(openStatementTasks     as any, storeId, date)) { await db.insert(openStatementTasks).values(eveningBase);     counts.openStatement++;     }
    }
    
    // Grooming: always uses the schedule's own shiftId (may be full_day)
    if (!await personalExists(groomingTasks, scheduleId)) {
      await db.insert(groomingTasks).values({ scheduleId, userId, storeId, shiftId, date, status: 'pending' as const });
      counts.grooming++;
    }
  } catch (err) {
    console.error(`   ❌ Task seed error for schedule ${scheduleId}:`, err);
  }
}

seedCurrentMonth()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-current-month failed:', err); process.exit(1); });
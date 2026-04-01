// scripts/seed-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds all task rows for every existing schedule row.
//
// Task matrix
// ────────────
//  Morning shift (shared — one per store per day):
//    store_opening_tasks, setoran_tasks, cek_bin_tasks,
//    product_check_tasks, receiving_tasks
//
//  Evening shift (shared — one per store per day):
//    briefing_tasks, edc_summary_tasks, edc_settlement_tasks,
//    eod_z_report_tasks, open_statement_tasks
//
//  Both shifts (personal — one per employee per schedule):
//    grooming_tasks
//
// "Shared" means only ONE row per store per date regardless of how many
// employees are on that shift. The first schedule row encountered for a
// store+date wins; subsequent employees on the same day are skipped for
// that task type.
//
// Safe to re-run — every insert checks for an existing row first.
//
// Changes from previous version
// ──────────────────────────────
//  • All IDs are now integers (serial), not uuids
//  • attendanceId column removed from task tables — tasks are now linked
//    only via scheduleId; the attendance FK was an unnecessary coupling
//  • 9 new task tables added (setoran, cekBin, productCheck, receiving,
//    briefing, edcSummary, edcSettlement, eodZReport, openStatement)
//  • storeOpeningTask columns renamed to match new schema
//    (cashDrawerAmount → removed; new boolean checklist columns)
//
// Run with: tsx scripts/seed-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db }   from '@/lib/db';
import {
  schedules, users, stores, areas,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, receivingTasks, briefingTasks,
  edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}

/** True if an existing row was found (i.e. skip). */
async function exists(
  table: typeof storeOpeningTasks,
  scheduleId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.scheduleId, scheduleId))
    .limit(1);
  return !!row;
}

/** True if a shared task already exists for this store+date. */
async function sharedExists(
  table: typeof storeOpeningTasks,
  storeId: number,
  date: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.storeId, storeId),
        eq(table.date,    startOfDay(date)),
      ),
    )
    .limit(1);
  return !!row;
}

// ─── Counters ─────────────────────────────────────────────────────────────────

const counts = {
  storeOpening:  { created: 0, skipped: 0 },
  setoran:       { created: 0, skipped: 0 },
  cekBin:        { created: 0, skipped: 0 },
  productCheck:  { created: 0, skipped: 0 },
  receiving:     { created: 0, skipped: 0 },
  briefing:      { created: 0, skipped: 0 },
  edcSummary:    { created: 0, skipped: 0 },
  edcSettlement: { created: 0, skipped: 0 },
  eodZReport:    { created: 0, skipped: 0 },
  openStatement: { created: 0, skipped: 0 },
  grooming:      { created: 0, skipped: 0 },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedTasks() {
  console.log('🗂️   seed-tasks: all 11 task types\n');

  // Load all schedule rows with context
  const allSchedules = await db
    .select({
      sched: schedules,
      user:  { id: users.id, name: users.name, employeeType: users.employeeType },
      store: { id: stores.id, name: stores.name },
      area:  { name: areas.name },
    })
    .from(schedules)
    .leftJoin(users,  eq(schedules.userId,  users.id))
    .leftJoin(stores, eq(schedules.storeId, stores.id))
    .leftJoin(areas,  eq(stores.areaId,     areas.id))
    .orderBy(areas.name, stores.name, schedules.date, schedules.shift);

  if (!allSchedules.length) {
    console.error('❌  No schedule rows found. Run seed-schedules.ts first.');
    process.exit(1);
  }

  console.log(`   Found ${allSchedules.length} schedule row(s).\n`);

  let errors = 0;

  for (const { sched, user, store, area } of allSchedules) {
    const label =
      `${(area?.name  ?? '?').padEnd(12)} | ` +
      `${(store?.name ?? '?').padEnd(16)} | ` +
      `${(user?.name  ?? '?').padEnd(18)} | ` +
      `${(sched.shift ?? '?').padEnd(7)} | ` +
      `${sched.date.toISOString().slice(0, 10)}`;

    const base = {
      scheduleId: sched.id,
      userId:     sched.userId,
      storeId:    sched.storeId,
      shift:      sched.shift as 'morning' | 'evening',
      date:       startOfDay(sched.date),
      status:     'pending' as const,
    };

    try {
      // ── MORNING TASKS ─────────────────────────────────────────────────────
      if (sched.shift === 'morning') {

        // store_opening_tasks — shared
        if (await sharedExists(storeOpeningTasks as any, sched.storeId, sched.date)) {
          counts.storeOpening.skipped++;
        } else {
          await db.insert(storeOpeningTasks).values(base);
          counts.storeOpening.created++;
          console.log(`   ✅ storeOpening  ${label}`);
        }

        // setoran_tasks — shared
        if (await sharedExists(setoranTasks as any, sched.storeId, sched.date)) {
          counts.setoran.skipped++;
        } else {
          await db.insert(setoranTasks).values(base);
          counts.setoran.created++;
          console.log(`   ✅ setoran       ${label}`);
        }

        // cek_bin_tasks — shared (stub)
        if (await sharedExists(cekBinTasks as any, sched.storeId, sched.date)) {
          counts.cekBin.skipped++;
        } else {
          await db.insert(cekBinTasks).values(base);
          counts.cekBin.created++;
          console.log(`   ✅ cekBin        ${label}`);
        }

        // product_check_tasks — shared
        if (await sharedExists(productCheckTasks as any, sched.storeId, sched.date)) {
          counts.productCheck.skipped++;
        } else {
          await db.insert(productCheckTasks).values(base);
          counts.productCheck.created++;
          console.log(`   ✅ productCheck  ${label}`);
        }

        // receiving_tasks — shared
        if (await sharedExists(receivingTasks as any, sched.storeId, sched.date)) {
          counts.receiving.skipped++;
        } else {
          await db.insert(receivingTasks).values(base);
          counts.receiving.created++;
          console.log(`   ✅ receiving     ${label}`);
        }
      }

      // ── EVENING TASKS ─────────────────────────────────────────────────────
      if (sched.shift === 'evening') {

        // briefing_tasks — shared
        if (await sharedExists(briefingTasks as any, sched.storeId, sched.date)) {
          counts.briefing.skipped++;
        } else {
          await db.insert(briefingTasks).values(base);
          counts.briefing.created++;
          console.log(`   ✅ briefing      ${label}`);
        }

        // edc_summary_tasks — shared
        if (await sharedExists(edcSummaryTasks as any, sched.storeId, sched.date)) {
          counts.edcSummary.skipped++;
        } else {
          await db.insert(edcSummaryTasks).values(base);
          counts.edcSummary.created++;
          console.log(`   ✅ edcSummary    ${label}`);
        }

        // edc_settlement_tasks — shared
        if (await sharedExists(edcSettlementTasks as any, sched.storeId, sched.date)) {
          counts.edcSettlement.skipped++;
        } else {
          await db.insert(edcSettlementTasks).values(base);
          counts.edcSettlement.created++;
          console.log(`   ✅ edcSettlement ${label}`);
        }

        // eod_z_report_tasks — shared
        if (await sharedExists(eodZReportTasks as any, sched.storeId, sched.date)) {
          counts.eodZReport.skipped++;
        } else {
          await db.insert(eodZReportTasks).values(base);
          counts.eodZReport.created++;
          console.log(`   ✅ eodZReport    ${label}`);
        }

        // open_statement_tasks — shared
        if (await sharedExists(openStatementTasks as any, sched.storeId, sched.date)) {
          counts.openStatement.skipped++;
        } else {
          await db.insert(openStatementTasks).values(base);
          counts.openStatement.created++;
          console.log(`   ✅ openStatement ${label}`);
        }
      }

      // ── GROOMING — personal, both shifts ──────────────────────────────────
      if (await exists(groomingTasks as any, sched.id)) {
        counts.grooming.skipped++;
      } else {
        await db.insert(groomingTasks).values(base);
        counts.grooming.created++;
        console.log(`   ✅ grooming      ${label}`);
      }

    } catch (err) {
      errors++;
      console.error(`   ❌ schedule ${sched.id}: ${err}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅  seed-tasks complete!\n');

  const pad = (s: string) => s.padEnd(18);
  console.log(`   ${'Task type'.padEnd(18)}  created  skipped`);
  console.log('   ' + '─'.repeat(36));
  for (const [name, c] of Object.entries(counts)) {
    console.log(`   ${pad(name)}  ${String(c.created).padStart(7)}  ${String(c.skipped).padStart(7)}`);
  }

  console.log(`\n   Errors: ${errors}`);
  if (errors > 0) console.log('   ⚠️  Some rows failed — check logs above.');
  console.log('\n   Next step: tsx scripts/seed-attendance.ts');
  console.log('═══════════════════════════════════════════════════════════');

  if (errors > 0) process.exit(1);
}

seedTasks()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-tasks failed:', err); process.exit(1); });
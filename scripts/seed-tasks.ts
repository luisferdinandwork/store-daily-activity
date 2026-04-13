// scripts/seed-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds all task rows for every existing schedule row.
//
// Changes from original:
//   • full_day shift creates BOTH morning and evening task sets
//   • Evening tasks have no unique(storeId, date) constraint — existence check
//     looks for any active (pending/in_progress/discrepancy) row instead
//   • store_opening_tasks now has fiveRPhotos + cekPromo columns (no values
//     needed for seed — they default to null/false)
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
import {
  schedules, users, stores, areas, shifts,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, receivingTasks, briefingTasks,
  edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}

/** Morning tasks use a unique(storeId, date) constraint — check by store+date. */
async function morningSharedExists(
  table: typeof storeOpeningTasks,
  storeId: number,
  date: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.storeId, storeId), eq(table.date, startOfDay(date))))
    .limit(1);
  return !!row;
}

/**
 * Evening tasks have NO unique(storeId, date) constraint (discrepancy rows can
 * span multiple days). We check for any active (non-terminal) row instead.
 */
async function eveningActiveExists(
  table: typeof briefingTasks,
  storeId: number,
  date: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(
      eq(table.storeId, storeId),
      eq(table.date, startOfDay(date)),
      inArray(table.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .limit(1);
  return !!row;
}

/** Grooming is personal — one row per scheduleId. */
async function personalExists(
  table: typeof groomingTasks,
  scheduleId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.scheduleId, scheduleId))
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

  const allSchedules = await db
    .select({
      sched:     schedules,
      shiftCode: shifts.code,
      user:      { id: users.id, name: users.name },
      store:     { id: stores.id, name: stores.name },
      area:      { name: areas.name },
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .leftJoin(users,  eq(schedules.userId,  users.id))
    .leftJoin(stores, eq(schedules.storeId, stores.id))
    .leftJoin(areas,  eq(stores.areaId,     areas.id))
    .orderBy(areas.name, stores.name, schedules.date, shifts.sortOrder);

  if (!allSchedules.length) {
    console.error('❌  No schedule rows found. Run seed-schedules.ts first.');
    process.exit(1);
  }

  // Resolve morning/evening shift IDs for full_day task rows
  const allShifts         = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftIdByCode     = Object.fromEntries(allShifts.map(s => [s.code, s.id])) as Record<string, number>;
  const morningShiftId    = shiftIdByCode['morning'];
  const eveningShiftId    = shiftIdByCode['evening'];

  if (!morningShiftId || !eveningShiftId) {
    console.error('❌  morning/evening shifts not found. Run seed-setup.ts first.');
    process.exit(1);
  }

  console.log(`   Found ${allSchedules.length} schedule row(s).\n`);

  let errors = 0;

  for (const { sched, shiftCode, user, store, area } of allSchedules) {
    const label =
      `${(area?.name  ?? '?').padEnd(12)} | ` +
      `${(store?.name ?? '?').padEnd(16)} | ` +
      `${(user?.name  ?? '?').padEnd(18)} | ` +
      `${shiftCode.padEnd(8)} | ` +
      `${sched.date.toISOString().slice(0, 10)}`;

    // For full_day shifts, morning tasks use the morning shiftId and evening
    // tasks use the evening shiftId, so the UI can group them correctly.
    const morningBase = {
      scheduleId: sched.id, userId: sched.userId, storeId: sched.storeId,
      shiftId: morningShiftId, date: startOfDay(sched.date), status: 'pending' as const,
    };
    const eveningBase = {
      scheduleId: sched.id, userId: sched.userId, storeId: sched.storeId,
      shiftId: eveningShiftId, date: startOfDay(sched.date), status: 'pending' as const,
    };

    const isMorning = shiftCode === 'morning'  || shiftCode === 'full_day';
    const isEvening = shiftCode === 'evening'  || shiftCode === 'full_day';

    try {
      // ── MORNING TASKS ─────────────────────────────────────────────────────
      if (isMorning) {
        if (await morningSharedExists(storeOpeningTasks as any, sched.storeId, sched.date)) {
          counts.storeOpening.skipped++;
        } else {
          await db.insert(storeOpeningTasks).values(morningBase);
          counts.storeOpening.created++;
          console.log(`   ✅ storeOpening  ${label}`);
        }

        if (await morningSharedExists(setoranTasks as any, sched.storeId, sched.date)) {
          counts.setoran.skipped++;
        } else {
          await db.insert(setoranTasks).values(morningBase);
          counts.setoran.created++;
          console.log(`   ✅ setoran       ${label}`);
        }

        if (await morningSharedExists(cekBinTasks as any, sched.storeId, sched.date)) {
          counts.cekBin.skipped++;
        } else {
          await db.insert(cekBinTasks).values(morningBase);
          counts.cekBin.created++;
          console.log(`   ✅ cekBin        ${label}`);
        }

        if (await morningSharedExists(productCheckTasks as any, sched.storeId, sched.date)) {
          counts.productCheck.skipped++;
        } else {
          await db.insert(productCheckTasks).values(morningBase);
          counts.productCheck.created++;
          console.log(`   ✅ productCheck  ${label}`);
        }

        if (await morningSharedExists(receivingTasks as any, sched.storeId, sched.date)) {
          counts.receiving.skipped++;
        } else {
          await db.insert(receivingTasks).values(morningBase);
          counts.receiving.created++;
          console.log(`   ✅ receiving     ${label}`);
        }
      }

      // ── EVENING TASKS ─────────────────────────────────────────────────────
      if (isEvening) {
        if (await eveningActiveExists(briefingTasks as any, sched.storeId, sched.date)) {
          counts.briefing.skipped++;
        } else {
          await db.insert(briefingTasks).values(eveningBase);
          counts.briefing.created++;
          console.log(`   ✅ briefing      ${label}`);
        }

        if (await eveningActiveExists(edcSummaryTasks as any, sched.storeId, sched.date)) {
          counts.edcSummary.skipped++;
        } else {
          await db.insert(edcSummaryTasks).values(eveningBase);
          counts.edcSummary.created++;
          console.log(`   ✅ edcSummary    ${label}`);
        }

        if (await eveningActiveExists(edcSettlementTasks as any, sched.storeId, sched.date)) {
          counts.edcSettlement.skipped++;
        } else {
          await db.insert(edcSettlementTasks).values(eveningBase);
          counts.edcSettlement.created++;
          console.log(`   ✅ edcSettlement ${label}`);
        }

        if (await eveningActiveExists(eodZReportTasks as any, sched.storeId, sched.date)) {
          counts.eodZReport.skipped++;
        } else {
          await db.insert(eodZReportTasks).values(eveningBase);
          counts.eodZReport.created++;
          console.log(`   ✅ eodZReport    ${label}`);
        }

        if (await eveningActiveExists(openStatementTasks as any, sched.storeId, sched.date)) {
          counts.openStatement.skipped++;
        } else {
          await db.insert(openStatementTasks).values(eveningBase);
          counts.openStatement.created++;
          console.log(`   ✅ openStatement ${label}`);
        }
      }

      // ── GROOMING — personal, all shifts ───────────────────────────────────
      if (await personalExists(groomingTasks, sched.id)) {
        counts.grooming.skipped++;
      } else {
        // Grooming keeps the schedule's own shiftId (morning/evening/full_day)
        // so the employee knows which shift they're grooming for.
        await db.insert(groomingTasks).values({
          scheduleId: sched.id, userId: sched.userId, storeId: sched.storeId,
          shiftId: sched.shiftId, date: startOfDay(sched.date), status: 'pending' as const,
        });
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
// scripts/seed-attendance.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds attendance records for March 1 → March 17, 2026.
//
// For each schedule row in that range:
//   5%  → absent   (no check-in)
//   10% → late     (31–60 min after shift start)
//   85% → present  (0–15 min before shift start)
//
// Also seeds:
//   • break sessions     (80% of attended shifts)
//   • storeOpeningTask   completed (morning, 90% chance) — new checklist columns
//   • groomingTask       completed (all shifts, 95% chance)
//   • evening tasks      completed at 70% rate each (briefing, EDC, EOD, statement)
//   • setoran + productCheck + receiving  completed at 80% rate (morning)
//
// Changes from previous version
// ──────────────────────────────
//  • All IDs now integers — serial() PKs returned as numbers
//  • storeOpeningTask columns:
//      cashDrawerAmount/allLightsOn/cleanlinessCheck/… → replaced by
//      loginPos / checkAbsenSunfish / tarikSohSales / fiveR / cekLamp / cekSoundSystem
//  • groomingTask columns: groomingNotes → notes
//  • No attendanceId on task tables — removed from schema
//  • New task tables seeded: setoran, productCheck, receiving,
//    briefing, edcSummary, edcSettlement, eodZReport, openStatement
//
// Safe to re-run — skips schedules that already have an attendance record.
// Run with: tsx scripts/seed-attendance.ts
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db }   from '@/lib/db';
import {
  schedules, attendance, breakSessions,
  users, stores,
  storeOpeningTasks, setoranTasks, productCheckTasks,
  receivingTasks, briefingTasks, edcSummaryTasks,
  edcSettlementTasks, eodZReportTasks, openStatementTasks,
  groomingTasks,
} from '@/lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';

// ─── Config ───────────────────────────────────────────────────────────────────

const START_DATE = new Date(2026, 2,  1,  0,  0,  0,   0);   // March 1
const END_DATE   = new Date(2026, 2, 17, 23, 59, 59, 999);   // March 17

const SHIFT_CONFIG = {
  morning: {
    startHour:         8,
    endHour:           17,
    lateAfterMinutes:  30,
    breakHour:         12,
    breakType:         'lunch'  as const,
  },
  evening: {
    startHour:         13,
    endHour:           22,
    lateAfterMinutes:  30,
    breakHour:         17,
    breakType:         'dinner' as const,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function rand(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }
function chance(pct: number): boolean { return Math.random() < pct; }

/** Minutes from midnight to a time object */
function minutesSinceMidnight(h: number, m: number): number { return h * 60 + m; }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedAttendance() {
  console.log('📋  seed-attendance: March 1 → March 17, 2026\n');

  const scheduleRows = await db
    .select({ sched: schedules, user: users, store: stores })
    .from(schedules)
    .leftJoin(users,  eq(schedules.userId,  users.id))
    .leftJoin(stores, eq(schedules.storeId, stores.id))
    .where(
      and(
        gte(schedules.date, startOfDay(START_DATE)),
        lte(schedules.date, endOfDay(END_DATE)),
        eq(schedules.isHoliday, false),
      ),
    )
    .orderBy(schedules.date, schedules.shift);

  console.log(`   Found ${scheduleRows.length} schedule rows in range\n`);

  let created   = 0;
  let skipped   = 0;
  let cntAbsent = 0;
  let cntLate   = 0;
  let cntPresent = 0;
  let cntBreaks  = 0;

  // Per-task counters
  const taskDone: Record<string, number> = {
    storeOpening: 0, setoran: 0, productCheck: 0, receiving: 0,
    briefing: 0, edcSummary: 0, edcSettlement: 0, eodZReport: 0, openStatement: 0,
    grooming: 0,
  };

  for (const { sched } of scheduleRows) {
    // ── Skip if attendance already exists ────────────────────────────────────
    const [existingAtt] = await db
      .select({ id: attendance.id })
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (existingAtt) { skipped++; continue; }

    const cfg        = SHIFT_CONFIG[sched.shift as 'morning' | 'evening'];
    const shiftStart = new Date(sched.date);
    shiftStart.setHours(cfg.startHour, 0, 0, 0);
    const shiftEnd = new Date(sched.date);
    shiftEnd.setHours(cfg.endHour, 0, 0, 0);
    const lateThreshold = new Date(shiftStart);
    lateThreshold.setMinutes(cfg.lateAfterMinutes);

    const roll = Math.random();

    // ── Absent (5%) ───────────────────────────────────────────────────────────
    if (roll < 0.05) {
      await db.insert(attendance).values({
        scheduleId:  sched.id,
        userId:      sched.userId,
        storeId:     sched.storeId,
        date:        startOfDay(sched.date),
        shift:       sched.shift,
        status:      'absent',
        onBreak:     false,
        recordedBy:  sched.userId,
      });
      cntAbsent++;
      created++;
      continue;
    }

    // ── Late (10%) or Present (85%) ───────────────────────────────────────────
    let checkIn: Date;
    let attStatus: 'present' | 'late';

    if (roll < 0.15) {
      // Late: 31–60 min after shift start
      checkIn   = new Date(shiftStart);
      checkIn.setMinutes(checkIn.getMinutes() + rand(31, 60));
      attStatus = 'late';
      cntLate++;
    } else {
      // Present: 0–15 min early
      checkIn   = new Date(shiftStart);
      checkIn.setMinutes(checkIn.getMinutes() - rand(0, 15));
      attStatus = 'present';
      cntPresent++;
    }

    // Check out near shift end (0–20 min over)
    const checkOut = new Date(shiftEnd);
    checkOut.setMinutes(checkOut.getMinutes() + rand(0, 20));

    // ── Insert attendance ─────────────────────────────────────────────────────
    const [att] = await db
      .insert(attendance)
      .values({
        scheduleId:   sched.id,
        userId:       sched.userId,
        storeId:      sched.storeId,
        date:         startOfDay(sched.date),
        shift:        sched.shift,
        status:       attStatus,
        checkInTime:  checkIn,
        checkOutTime: checkOut,
        onBreak:      false,
        recordedBy:   sched.userId,
      })
      .returning({ id: attendance.id });

    created++;

    // ── Break session (80% chance) ────────────────────────────────────────────
    if (chance(0.80)) {
      const breakStart = new Date(sched.date);
      breakStart.setHours(cfg.breakHour, rand(0, 30), 0, 0);
      const breakEnd = new Date(breakStart);
      breakEnd.setMinutes(breakEnd.getMinutes() + rand(25, 45));

      if (breakStart > checkIn && breakEnd < checkOut) {
        await db.insert(breakSessions).values({
          attendanceId: att.id,
          userId:       sched.userId,
          storeId:      sched.storeId,
          breakType:    cfg.breakType,
          breakOutTime: breakStart,
          returnTime:   breakEnd,
        });
        cntBreaks++;
      }
    }

    // ── Complete task rows ────────────────────────────────────────────────────
    // Helper: mark a task row as completed (by scheduleId match)
    async function completeTask<T extends { scheduleId: number; status: string | null }>(
      table:     typeof storeOpeningTasks,
      extraSet:  Record<string, unknown>,
      taskName:  keyof typeof taskDone,
    ) {
      const [row] = await db
        .select({ id: table.id, status: table.status })
        .from(table)
        .where(eq(table.scheduleId, sched.id))
        .limit(1);

      if (!row || row.status !== 'pending') return;

      const completedAt = new Date(checkIn);
      completedAt.setMinutes(completedAt.getMinutes() + rand(5, 25));

      await db
        .update(table)
        .set({
          ...extraSet,
          status:      'completed',
          completedAt,
          updatedAt:   new Date(),
        } as any)
        .where(eq(table.id, row.id));

      taskDone[taskName]++;
    }

    if (sched.shift === 'morning') {
      // Store Opening (90% done)
      if (chance(0.90)) {
        await completeTask(
          storeOpeningTasks as any,
          {
            loginPos:          true,
            checkAbsenSunfish: chance(0.95),
            tarikSohSales:     chance(0.95),
            fiveR:             chance(0.90),
            cekLamp:           true,
            cekSoundSystem:    chance(0.90),
            storeFrontPhotos:  JSON.stringify(['opening/sample-storefront.jpg']),
            cashDrawerPhotos:  JSON.stringify(['opening/sample-cashdrawer.jpg']),
            notes:             chance(0.3) ? 'All clear, store ready.' : null,
          },
          'storeOpening',
        );
      }

      // Setoran (80% done)
      if (chance(0.80)) {
        const amount = (500_000 + rand(0, 10) * 50_000).toString();
        await completeTask(
          setoranTasks as any,
          {
            amount,
            linkSetoran:  `https://transfer.example.com/ref/${rand(100000, 999999)}`,
            moneyPhotos:  JSON.stringify(['setoran/sample-money.jpg']),
            notes:        chance(0.2) ? 'Transfer confirmed.' : null,
          },
          'setoran',
        );
      }

      // Product Check (80% done)
      if (chance(0.80)) {
        await completeTask(
          productCheckTasks as any,
          {
            display:    chance(0.95),
            price:      chance(0.95),
            saleTag:    chance(0.90),
            shoeFiller: chance(0.90),
            labelIndo:  chance(0.95),
            barcode:    chance(0.95),
            notes:      chance(0.2) ? 'Minor price tag missing on shelf 3.' : null,
          },
          'productCheck',
        );
      }

      // Receiving (80% done — 30% have an actual delivery)
      if (chance(0.80)) {
        const hasReceiving = chance(0.30);
        await completeTask(
          receivingTasks as any,
          {
            hasReceiving,
            receivingPhotos: hasReceiving
              ? JSON.stringify(['receiving/sample-delivery.jpg'])
              : null,
            notes: hasReceiving
              ? `Received ${rand(2, 10)} boxes from supplier.`
              : 'No delivery today.',
          },
          'receiving',
        );
      }
    }

    if (sched.shift === 'evening') {
      // Briefing (70% done)
      if (chance(0.70)) {
        await completeTask(
          briefingTasks as any,
          { done: true, notes: chance(0.2) ? 'Briefing done, team aligned.' : null },
          'briefing',
        );
      }

      // EDC Summary (70% done)
      if (chance(0.70)) {
        await completeTask(
          edcSummaryTasks as any,
          {
            edcSummaryPhotos: JSON.stringify(['edc/summary-sample.jpg']),
            notes:            chance(0.2) ? 'No issues.' : null,
          },
          'edcSummary',
        );
      }

      // EDC Settlement (70% done)
      if (chance(0.70)) {
        await completeTask(
          edcSettlementTasks as any,
          {
            edcSettlementPhotos: JSON.stringify(['edc/settlement-sample.jpg']),
            notes:               chance(0.2) ? 'Settled successfully.' : null,
          },
          'edcSettlement',
        );
      }

      // EOD Z-Report (70% done)
      if (chance(0.70)) {
        await completeTask(
          eodZReportTasks as any,
          {
            zReportPhotos: JSON.stringify(['eod/z-report-sample.jpg']),
            notes:         chance(0.2) ? 'Z-report printed and filed.' : null,
          },
          'eodZReport',
        );
      }

      // Open Statement (70% done)
      if (chance(0.70)) {
        await completeTask(
          openStatementTasks as any,
          {
            openStatementPhotos: JSON.stringify(['statement/open-statement-sample.jpg']),
            notes:               chance(0.2) ? 'Statement list filed.' : null,
          },
          'openStatement',
        );
      }
    }

    // Grooming (95% — both shifts, personal)
    if (chance(0.95)) {
      await completeTask(
        groomingTasks as any,
        {
          uniformComplete:      true,
          hairGroomed:          chance(0.95),
          nailsClean:           chance(0.95),
          accessoriesCompliant: chance(0.95),
          shoeCompliant:        true,
          selfiePhotos:         JSON.stringify(['grooming/selfie-sample.jpg']),
          notes:                chance(0.1) ? 'All good.' : null,
        },
        'grooming',
      );
    }

    if (created % 50 === 0) {
      process.stdout.write(`   ✓ ${created} attendance records created…\r`);
    }
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  seed-attendance complete!\n');
  console.log(`   Schedule rows found  : ${scheduleRows.length}`);
  console.log(`   Already had records  : ${skipped}`);
  console.log(`   Created              : ${created}`);
  console.log(`     ↳ Present          : ${cntPresent}`);
  console.log(`     ↳ Late             : ${cntLate}`);
  console.log(`     ↳ Absent           : ${cntAbsent}`);
  console.log(`   Break sessions       : ${cntBreaks}`);
  console.log('\n   Tasks completed:');
  for (const [name, n] of Object.entries(taskDone)) {
    console.log(`     ↳ ${name.padEnd(16)}: ${n}`);
  }
  console.log('═══════════════════════════════════════════════════════════');
}

seedAttendance()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-attendance failed:', err); process.exit(1); });
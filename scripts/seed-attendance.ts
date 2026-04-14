// scripts/seed-attendance.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds attendance records for March 1 → March 17, 2026.
// Updated for lookup-table schema (shift is now an FK to the shifts table).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db }   from '@/lib/db';
import {
  schedules, attendance, breakSessions,
  users, stores, shifts,
  storeOpeningTasks, setoranTasks, productCheckTasks,
  itemDroppingTasks, briefingTasks, edcReconciliationTasks,  
  eodZReportTasks, openStatementTasks,
  groomingTasks,
} from '@/lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';

// ─── Config ───────────────────────────────────────────────────────────────────

const START_DATE = new Date(2026, 2,  1,  0,  0,  0,   0);   // March 1
const END_DATE   = new Date(2026, 2, 17, 23, 59, 59, 999);   // March 17

const SHIFT_CONFIG = {
  morning: {
    startHour:        8,
    endHour:          17,
    lateAfterMinutes: 30,
    breakHour:        12,
    breakType:        'lunch'  as const,
  },
  evening: {
    startHour:        13,
    endHour:          22,
    lateAfterMinutes: 30,
    breakHour:        17,
    breakType:        'dinner' as const,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function rand(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }
function chance(pct: number): boolean { return Math.random() < pct; }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedAttendance() {
  console.log('📋  seed-attendance: March 1 → March 17, 2026\n');

  // Join schedules with shifts so we can read the shift CODE per row.
  const scheduleRows = await db
    .select({
      sched:     schedules,
      shiftCode: shifts.code,
      user:      users,
      store:     stores,
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .leftJoin(users,   eq(schedules.userId,  users.id))
    .leftJoin(stores,  eq(schedules.storeId, stores.id))
    .where(
      and(
        gte(schedules.date, startOfDay(START_DATE)),
        lte(schedules.date, endOfDay(END_DATE)),
        eq(schedules.isHoliday, false),
      ),
    )
    .orderBy(schedules.date, shifts.sortOrder);

  console.log(`   Found ${scheduleRows.length} schedule rows in range\n`);

  let created    = 0;
  let skipped    = 0;
  let cntAbsent  = 0;
  let cntLate    = 0;
  let cntPresent = 0;
  let cntBreaks  = 0;

    const taskDone: Record<string, number> = {
      storeOpening: 0, setoran: 0, productCheck: 0, itemDropping: 0,  
      briefing: 0, edcReconciliation: 0, eodZReport: 0, openStatement: 0, 
      grooming: 0,
    };

  for (const { sched, shiftCode } of scheduleRows) {
    // Validate shift code is one we know how to handle
    if (shiftCode !== 'morning' && shiftCode !== 'evening') {
      console.warn(`   ⚠️  Unknown shift code "${shiftCode}" on schedule ${sched.id} — skipping`);
      continue;
    }

    // ── Skip if attendance already exists ────────────────────────────────────
    const [existingAtt] = await db
      .select({ id: attendance.id })
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (existingAtt) { skipped++; continue; }

    const cfg        = SHIFT_CONFIG[shiftCode];
    const shiftStart = new Date(sched.date);
    shiftStart.setHours(cfg.startHour, 0, 0, 0);
    const shiftEnd = new Date(sched.date);
    shiftEnd.setHours(cfg.endHour, 0, 0, 0);

    const roll = Math.random();

    // ── Absent (5%) ───────────────────────────────────────────────────────────
    if (roll < 0.05) {
      await db.insert(attendance).values({
        scheduleId:  sched.id,
        userId:      sched.userId,
        storeId:     sched.storeId,
        date:        startOfDay(sched.date),
        shiftId:     sched.shiftId,
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
      checkIn   = new Date(shiftStart);
      checkIn.setMinutes(checkIn.getMinutes() + rand(31, 60));
      attStatus = 'late';
      cntLate++;
    } else {
      checkIn   = new Date(shiftStart);
      checkIn.setMinutes(checkIn.getMinutes() - rand(0, 15));
      attStatus = 'present';
      cntPresent++;
    }

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
        shiftId:      sched.shiftId,
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
    async function completeTask(
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
          status:     'completed',
          completedAt,
          updatedAt:  new Date(),
        } as any)
        .where(eq(table.id, row.id));

      taskDone[taskName]++;
    }

    if (shiftCode === 'morning') {
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

      if (chance(0.80)) {
        const amount = (500_000 + rand(0, 10) * 50_000).toString();
        await completeTask(
          setoranTasks as any,
          {
            amount,
            linkSetoran: `https://transfer.example.com/ref/${rand(100000, 999999)}`,
            // CHANGED: moneyPhotos (JSON) → resiPhoto (single string)
            resiPhoto:  'setoran/sample-resi.jpg',
            notes:      chance(0.2) ? 'Transfer confirmed.' : null,
          },
          'setoran',
        );
      }

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

      // CHANGED: receivingTasks → itemDroppingTasks with correct columns
      if (chance(0.80)) {
        const hasDropping = chance(0.30);
        const isReceived  = hasDropping ? chance(0.90) : false;
        await completeTask(
          itemDroppingTasks as any,
          {
            hasDropping,
            dropTime:    hasDropping ? new Date(checkIn.getTime() + rand(10, 60) * 60_000) : null,
            droppingPhotos: hasDropping
              ? JSON.stringify(['dropping/sample-delivery.jpg'])
              : null,
            isReceived,
            receiveTime:   isReceived ? new Date(checkIn.getTime() + rand(30, 120) * 60_000) : null,
            receivePhotos: isReceived
              ? JSON.stringify(['dropping/sample-receipt.jpg'])
              : null,
            notes: hasDropping
              ? (isReceived ? `Received ${rand(2, 10)} boxes.` : 'Dropped off, awaiting receipt confirmation.')
              : 'No delivery today.',
          },
          'itemDropping',
        );
      }
    }

    if (shiftCode === 'evening') {
      if (chance(0.70)) {
        await completeTask(
          briefingTasks as any,
          {
            done:       true,
            isBalanced: true,  // ← ADDED: schema expects this for completed state
            notes:      chance(0.2) ? 'Briefing done, team aligned.' : null,
          },
          'briefing',
        );
      }

      // CHANGED: Merged edcSummary + edcSettlement into edcReconciliation
      // Schema has no photo columns — uses isBalanced + expectedFetchedAt
      if (chance(0.70)) {
        await completeTask(
          edcReconciliationTasks as any,
          {
            expectedFetchedAt: new Date(checkIn.getTime() + rand(5, 15) * 60_000),
            expectedSnapshot:  JSON.stringify({ rows: [], generatedAt: new Date().toISOString() }),
            isBalanced:        true,
            notes:             chance(0.2) ? 'EDC reconciled, no discrepancies.' : null,
          },
          'edcReconciliation',
        );
      }

      if (chance(0.70)) {
        await completeTask(
          eodZReportTasks as any,
          {
            totalNominal:  (5_000_000 + rand(0, 20) * 100_000).toString(),
            zReportPhotos: JSON.stringify(['eod/z-report-sample.jpg']),
            notes:         chance(0.2) ? 'Z-report printed and filed.' : null,
          },
          'eodZReport',
        );
      }

      // CHANGED: openStatementTasks has no photo column.
      // Uses expectedAmount, actualAmount, isBalanced
      if (chance(0.70)) {
        const expected = 10_000_000 + rand(0, 5) * 500_000;
        await completeTask(
          openStatementTasks as any,
          {
            expectedAmount:    expected.toString(),
            expectedFetchedAt: new Date(checkIn.getTime() + rand(10, 30) * 60_000),
            actualAmount:      expected.toString(), // Balanced for seed
            isBalanced:        true,
            notes:             chance(0.2) ? 'Open statement matched.' : null,
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
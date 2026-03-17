// scripts/seed-attendance.ts
/**
 * Seeds attendance records for March 1, 2026 → today (March 17, 2026).
 *
 * For each schedule row in that date range:
 *   - 5%  chance → absent
 *   - 10% chance → late (31–60 min after shift start)
 *   - 85% → present (0–15 min early)
 *
 * Also seeds:
 *   - break sessions (80% chance per attended shift)
 *   - storeOpeningTask + groomingTask completion (simulated)
 *
 * Safe to re-run — skips days that already have an attendance record.
 * Run with: tsx scripts/seed-attendance.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
import {
  schedules, attendance, breakSessions,
  storeOpeningTasks, groomingTasks, users, stores,
} from '@/lib/db/schema';
import { and, eq, gte, lte, isNull } from 'drizzle-orm';

// ─── Config ───────────────────────────────────────────────────────────────────

const START_DATE = new Date(2026, 2, 1,  0,  0,  0, 0);  // March 1
const END_DATE   = new Date(2026, 2, 17, 23, 59, 59, 999); // March 17 (today)

const SHIFT_CONFIG = {
  morning: { startHour: 8,  endHour: 17, lateAfterMinutes: 30, breakHour: 12, breakType: 'lunch'  as const },
  evening: { startHour: 13, endHour: 22, lateAfterMinutes: 30, breakHour: 17, breakType: 'dinner' as const },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function rand(min: number, max: number) { return min + Math.floor(Math.random() * (max - min + 1)); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedAttendance() {
  console.log('📋  seed-attendance: March 1 → March 17, 2026\n');

  // Fetch all schedule rows in the date range
  const scheduleRows = await db
    .select({
      sched: schedules,
      user:  users,
      store: stores,
    })
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
  let absent    = 0;
  let late      = 0;
  let present   = 0;
  let breaks    = 0;
  let openingOk = 0;
  let groomOk   = 0;

  for (const { sched, user, store } of scheduleRows) {
    // Skip if attendance already exists
    const [existingAtt] = await db
      .select({ id: attendance.id })
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (existingAtt) {
      skipped++;
      continue;
    }

    const cfg        = SHIFT_CONFIG[sched.shift];
    const shiftStart = new Date(sched.date);
    shiftStart.setHours(cfg.startHour, 0, 0, 0);
    const shiftEnd = new Date(sched.date);
    shiftEnd.setHours(cfg.endHour, 0, 0, 0);
    const lateThreshold = new Date(shiftStart);
    lateThreshold.setMinutes(cfg.lateAfterMinutes);

    const roll = Math.random();

    // ── Absent (5%) ─────────────────────────────────────────────────────────
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
      absent++;
      created++;
      continue;
    }

    // ── Late (10%) ───────────────────────────────────────────────────────────
    let checkIn: Date;
    let attStatus: 'present' | 'late';

    if (roll < 0.15) {
      checkIn   = new Date(shiftStart);
      checkIn.setMinutes(rand(31, 60));
      attStatus = 'late';
      late++;
    } else {
      // Present — arrive 0–15 min early
      checkIn   = new Date(shiftStart);
      checkIn.setMinutes(-rand(0, 15));
      attStatus = 'present';
      present++;
    }

    // Check out near shift end (±0–20 min)
    const checkOut = new Date(shiftEnd);
    checkOut.setMinutes(rand(-5, 20));

    // ── Insert attendance ────────────────────────────────────────────────────
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

    // ── Link tasks to attendance ─────────────────────────────────────────────
    await db
      .update(storeOpeningTasks)
      .set({ attendanceId: att.id, updatedAt: new Date() })
      .where(eq(storeOpeningTasks.scheduleId, sched.id));

    await db
      .update(groomingTasks)
      .set({ attendanceId: att.id, updatedAt: new Date() })
      .where(eq(groomingTasks.scheduleId, sched.id));

    // ── Complete store opening task (morning only, 90% chance) ───────────────
    if (sched.shift === 'morning' && Math.random() > 0.10) {
      const completedAt = new Date(checkIn);
      completedAt.setMinutes(completedAt.getMinutes() + rand(5, 20));
      await db
        .update(storeOpeningTasks)
        .set({
          cashDrawerAmount: 500_000 + rand(0, 5) * 100_000,
          allLightsOn:      true,
          cleanlinessCheck: Math.random() > 0.05,
          equipmentCheck:   Math.random() > 0.05,
          stockCheck:       Math.random() > 0.10,
          safetyCheck:      true,
          openingNotes:     Math.random() > 0.7 ? 'All clear.' : null,
          storeFrontPhotos: JSON.stringify(['https://placehold.co/400x300?text=StoreFront']),
          cashDrawerPhotos: JSON.stringify(['https://placehold.co/400x300?text=CashDrawer']),
          status:           'completed',
          completedAt,
          updatedAt:        new Date(),
        })
        .where(eq(storeOpeningTasks.scheduleId, sched.id));
      openingOk++;
    }

    // ── Complete grooming task (95% chance) ──────────────────────────────────
    if (Math.random() > 0.05) {
      const completedAt = new Date(checkIn);
      completedAt.setMinutes(completedAt.getMinutes() + rand(2, 10));
      await db
        .update(groomingTasks)
        .set({
          uniformComplete:      true,
          hairGroomed:          Math.random() > 0.05,
          nailsClean:           Math.random() > 0.05,
          accessoriesCompliant: Math.random() > 0.05,
          shoeCompliant:        true,
          groomingNotes:        Math.random() > 0.8 ? 'All good.' : null,
          selfiePhotos:         JSON.stringify(['https://placehold.co/400x600?text=Selfie']),
          status:               'completed',
          completedAt,
          updatedAt:            new Date(),
        })
        .where(eq(groomingTasks.scheduleId, sched.id));
      groomOk++;
    }

    // ── Break session (80% chance) ────────────────────────────────────────────
    if (Math.random() < 0.80) {
      const breakStart = new Date(sched.date);
      breakStart.setHours(cfg.breakHour, rand(0, 30), 0, 0);
      const breakEnd = new Date(breakStart);
      breakEnd.setMinutes(breakEnd.getMinutes() + rand(25, 45));

      // Only add if break start is after check-in and before check-out
      if (breakStart > checkIn && breakEnd < checkOut) {
        await db.insert(breakSessions).values({
          attendanceId: att.id,
          userId:       sched.userId,
          storeId:      sched.storeId,
          breakType:    cfg.breakType,
          breakOutTime: breakStart,
          returnTime:   breakEnd,
        });
        breaks++;
      }
    }

    // Log progress every 50 rows
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
  console.log(`     ↳ Present          : ${present}`);
  console.log(`     ↳ Late             : ${late}`);
  console.log(`     ↳ Absent           : ${absent}`);
  console.log(`   Break sessions       : ${breaks}`);
  console.log(`   Opening tasks done   : ${openingOk}`);
  console.log(`   Grooming tasks done  : ${groomOk}`);
  console.log('═══════════════════════════════════════════════════════════');
}

seedAttendance()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-attendance failed:', err); process.exit(1); });
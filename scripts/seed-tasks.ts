// scripts/seed-tasks.ts
/**
 * Generates storeOpeningTasks and groomingTasks for all existing schedule rows
 * that don't yet have a corresponding task.
 *
 * Logic mirrors createScheduleAndTasks() in lib/schedule-utils.ts:
 *   - Every working schedule row gets a groomingTask
 *   - Only morning shifts get a storeOpeningTask
 *   - If an attendance record already exists for the schedule, attendanceId is
 *     backfilled on both task rows immediately (mirrors Bug 2 fix)
 *
 * Safe to re-run — idempotent (skips rows that already have tasks).
 * Run with: npm run seed:tasks
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
import {
  schedules, attendance,
  storeOpeningTasks, groomingTasks,
  users, stores, areas,
} from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedTasks() {
  console.log('🗂️   seed-tasks: storeOpeningTasks + groomingTasks\n');

  // ── 1. Load all schedule rows with user + store info ──────────────────────
  const allSchedules = await db
    .select({
      schedule: schedules,
      user:     { id: users.id, name: users.name, employeeType: users.employeeType },
      store:    { id: stores.id, name: stores.name },
      area:     { name: areas.name },
    })
    .from(schedules)
    .leftJoin(users,  eq(schedules.userId,  users.id))
    .leftJoin(stores, eq(schedules.storeId, stores.id))
    .leftJoin(areas,  eq(stores.areaId,     areas.id))
    .orderBy(areas.name, stores.name, schedules.date, schedules.shift);

  if (!allSchedules.length) {
    console.error('❌  No schedule rows found. Run seed:schedules first.');
    process.exit(1);
  }

  console.log(`   Found ${allSchedules.length} schedule row(s) to process.\n`);

  let openingCreated  = 0;
  let openingSkipped  = 0;
  let groomingCreated = 0;
  let groomingSkipped = 0;
  let attBackfilled   = 0;
  let errors          = 0;

  for (const { schedule: sched, user, store, area } of allSchedules) {
    const label =
      `${(area?.name ?? '?').padEnd(12)} | ` +
      `${(store?.name ?? '?').padEnd(16)} | ` +
      `${(user?.name  ?? '?').padEnd(18)} | ` +
      `${sched.shift?.padEnd(7)} | ` +
      `${sched.date.toISOString().slice(0, 10)}`;

    try {
      // ── 2. Look up existing attendance for this schedule ─────────────────
      const [existingAtt] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(eq(attendance.scheduleId, sched.id))
        .limit(1);

      const attendanceId = existingAtt?.id ?? null;

      // ── 3. storeOpeningTask — morning shifts only ─────────────────────────
      if (sched.shift === 'morning') {
        const [existingOpening] = await db
          .select({ id: storeOpeningTasks.id })
          .from(storeOpeningTasks)
          .where(eq(storeOpeningTasks.scheduleId, sched.id))
          .limit(1);

        if (existingOpening) {
          openingSkipped++;
        } else {
          await db.insert(storeOpeningTasks).values({
            userId:       sched.userId,
            storeId:      sched.storeId,
            scheduleId:   sched.id,
            attendanceId,
            date:         sched.date,
            shift:        sched.shift,
            status:       'pending',
          });
          openingCreated++;
          console.log(`   ✅ opening  ${label}`);
        }
      }

      // ── 4. groomingTask — every working shift ─────────────────────────────
      const [existingGrooming] = await db
        .select({ id: groomingTasks.id })
        .from(groomingTasks)
        .where(eq(groomingTasks.scheduleId, sched.id))
        .limit(1);

      if (existingGrooming) {
        groomingSkipped++;
      } else {
        await db.insert(groomingTasks).values({
          userId:       sched.userId,
          storeId:      sched.storeId,
          scheduleId:   sched.id,
          attendanceId,
          date:         sched.date,
          shift:        sched.shift,
          status:       'pending',
        });
        groomingCreated++;
        console.log(`   ✅ grooming ${label}`);
      }

      // ── 5. Backfill attendanceId on any existing tasks that are missing it
      //       (mirrors the Bug 2 fix in schedule-utils.ts)
      if (attendanceId) {
        const updated = await db
          .update(storeOpeningTasks)
          .set({ attendanceId, updatedAt: new Date() })
          .where(
            and(
              eq(storeOpeningTasks.scheduleId,   sched.id),
              isNull(storeOpeningTasks.attendanceId),
            ),
          )
          .returning({ id: storeOpeningTasks.id });

        const updatedG = await db
          .update(groomingTasks)
          .set({ attendanceId, updatedAt: new Date() })
          .where(
            and(
              eq(groomingTasks.scheduleId,   sched.id),
              isNull(groomingTasks.attendanceId),
            ),
          )
          .returning({ id: groomingTasks.id });

        const backfillCount = updated.length + updatedG.length;
        if (backfillCount > 0) {
          attBackfilled += backfillCount;
          console.log(`   🔗 backfilled attendanceId on ${backfillCount} task(s) — ${label}`);
        }
      }

    } catch (err) {
      errors++;
      console.error(`   ❌ error on schedule ${sched.id}: ${err}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅  seed-tasks complete!\n');
  console.log(`   Store opening tasks created  : ${openingCreated}`);
  console.log(`   Store opening tasks skipped  : ${openingSkipped}`);
  console.log(`   Grooming tasks created       : ${groomingCreated}`);
  console.log(`   Grooming tasks skipped       : ${groomingSkipped}`);
  console.log(`   Attendance IDs backfilled    : ${attBackfilled}`);
  console.log(`   Errors                       : ${errors}`);
  console.log('═══════════════════════════════════════════════════════════');

  if (errors > 0) process.exit(1);
}

seedTasks()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-tasks failed:', err); process.exit(1); });
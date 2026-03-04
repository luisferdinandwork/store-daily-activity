// scripts/seed-schedules.ts
// Generates rolling schedules + simulates past attendance for the last 14 days.
// Safe to re-run — idempotent (skips already-existing rows).
// Run with: tsx scripts/seed-schedules.ts

import { db } from '@/lib/db';
import {
  users, stores, areas,
  weeklyScheduleTemplates, weeklyScheduleEntries,
  schedules, attendance, employeeTasks, breakSessions, tasks,
} from '@/lib/db/schema';
import { eq, and, gte, lte, isNull } from 'drizzle-orm';
import { shouldTaskRunOnDate } from '@/lib/daily-task-utils';

// ─── Config ───────────────────────────────────────────────────────────────────

/** How many days into the past to backfill attendance. */
const BACKFILL_DAYS = 14;
/** How many weeks ahead to pre-generate schedules. */
const ROLLING_WEEKS_AHEAD = 4;

const SHIFT_CONFIG = {
  morning: { startHour: 8,  endHour: 17, lateAfterMinutes: 30 },
  evening: { startHour: 13, endHour: 22, lateAfterMinutes: 30 },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }

function* eachDay(start: Date, end: Date): Generator<Date> {
  const cur = startOfDay(start);
  const fin = startOfDay(end);
  while (cur <= fin) { yield new Date(cur); cur.setDate(cur.getDate() + 1); }
}

function taskMatchesEmployee(
  task: { role: string; employeeType: string | null; shift: string | null },
  user: { role: string; employeeType: string | null },
  shift: string,
) {
  return (
    task.role === user.role &&
    (!task.employeeType || task.employeeType === user.employeeType) &&
    (!task.shift || task.shift === shift)
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedSchedules() {
  console.log('📅  seed-schedules: generating schedules + simulating attendance\n');

  // Fetch all stores (with their area, for logging)
  const allStores = await db
    .select({ store: stores, area: areas })
    .from(stores)
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .orderBy(areas.name, stores.name);

  if (!allStores.length) {
    console.error('❌  No stores found. Run seed-setup.ts first.');
    process.exit(1);
  }

  const allActiveTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.isActive, true));

  console.log(`Found ${allStores.length} store(s) across ${new Set(allStores.map(s => s.area?.id)).size} area(s)\n`);

  const today    = startOfDay(new Date());
  const horizon  = new Date(today); horizon.setDate(today.getDate() + ROLLING_WEEKS_AHEAD * 7);
  const pastFrom = new Date(today); pastFrom.setDate(today.getDate() - BACKFILL_DAYS);

  let totalSchedules = 0;
  let totalTasks     = 0;
  let totalAttendance = 0;

  for (const { store, area } of allStores) {
    console.log(`\n── ${store.name} (${area?.name ?? 'no area'}) ──────────────────────────`);

    // Fetch active templates for this store
    const templateRows = await db
      .select({ tmpl: weeklyScheduleTemplates, user: users })
      .from(weeklyScheduleTemplates)
      .leftJoin(users, eq(weeklyScheduleTemplates.userId, users.id))
      .where(
        and(
          eq(weeklyScheduleTemplates.storeId,  store.id),
          eq(weeklyScheduleTemplates.isActive, true),
        )
      )
      .orderBy(users.name);

    if (!templateRows.length) {
      console.log('   ⚠️  No active templates — skipping');
      continue;
    }

    for (const { tmpl, user } of templateRows) {
      if (!user) continue;

      const entries = await db
        .select()
        .from(weeklyScheduleEntries)
        .where(eq(weeklyScheduleEntries.templateId, tmpl.id));

      if (!entries.length) continue;

      console.log(`\n   👤 ${user.name} (${user.employeeType ?? user.role})`);

      let schedsCreated = 0;
      let tasksCreated  = 0;
      let attCreated    = 0;

      // Generate from (backfill start OR lastScheduledThrough+1) up to horizon
      const resumeFrom = tmpl.lastScheduledThrough
        ? new Date(tmpl.lastScheduledThrough.getTime() + 86_400_000)
        : pastFrom;

      const genFrom = resumeFrom < pastFrom ? pastFrom : resumeFrom;

      for (const date of eachDay(genFrom, horizon)) {
        const weekday     = date.getDay();
        const todayEntries = entries.filter(e => Number(e.weekday) === weekday);

        for (const entry of todayEntries) {
          const shift = entry.shift as 'morning' | 'evening';

          // ── Idempotency: skip if schedule exists ─────────────────────────
          const existing = await db
            .select({ id: schedules.id })
            .from(schedules)
            .where(
              and(
                eq(schedules.userId,  tmpl.userId),
                eq(schedules.storeId, store.id),
                eq(schedules.shift,   shift),
                gte(schedules.date,   startOfDay(date)),
                lte(schedules.date,   endOfDay(date)),
              )
            )
            .limit(1);

          let schedId: string;

          if (existing.length > 0) {
            schedId = existing[0].id;
          } else {
            const [newSched] = await db
              .insert(schedules)
              .values({
                userId:          tmpl.userId,
                storeId:         store.id,
                shift,
                date:            startOfDay(date),
                templateEntryId: entry.id,
                isHoliday:       false,
              })
              .returning({ id: schedules.id });

            schedId = newSched.id;
            schedsCreated++;

            // Create task instances for this schedule
            const matchingTasks = allActiveTasks.filter(t =>
              shouldTaskRunOnDate(t.recurrence as any, t.recurrenceDays, date) &&
              taskMatchesEmployee(t, user, shift)
            );

            for (const task of matchingTasks) {
              const dup = await db
                .select({ id: employeeTasks.id })
                .from(employeeTasks)
                .where(
                  and(
                    eq(employeeTasks.taskId,     task.id),
                    eq(employeeTasks.userId,     tmpl.userId),
                    eq(employeeTasks.scheduleId, schedId),
                  )
                )
                .limit(1);

              if (dup.length > 0) continue;

              await db.insert(employeeTasks).values({
                taskId:     task.id,
                userId:     tmpl.userId,
                storeId:    store.id,
                scheduleId: schedId,
                date:       startOfDay(date),
                shift,
                status:     'pending',
              });
              tasksCreated++;
            }
          }

          // ── Simulate attendance for past dates only ───────────────────────
          const isPast = date < today;
          if (!isPast) continue;

          const existingAtt = await db
            .select({ id: attendance.id })
            .from(attendance)
            .where(eq(attendance.scheduleId, schedId))
            .limit(1);

          if (existingAtt.length > 0) continue;

          const cfg        = SHIFT_CONFIG[shift];
          const shiftStart = new Date(date);
          shiftStart.setHours(cfg.startHour, 0, 0, 0);

          // Simulate: 85% present on time, 10% late, 5% absent
          const roll = Math.random();

          if (roll < 0.05) {
            // Absent
            await db.insert(attendance).values({
              scheduleId:  schedId,
              userId:      tmpl.userId,
              storeId:     store.id,
              date:        startOfDay(date),
              shift,
              status:      'absent',
              onBreak:     false,
              recordedBy:  tmpl.userId,
            });
          } else {
            // Present or late — generate a realistic check-in time
            const lateMinutes  = roll < 0.15 ? Math.floor(Math.random() * 30) + 31 : 0; // 10% late
            const earlyMinutes = roll >= 0.15 ? Math.floor(Math.random() * 20) : 0;      // up to 20 min early

            const checkIn = new Date(shiftStart);
            checkIn.setMinutes(lateMinutes > 0 ? lateMinutes : -earlyMinutes);

            const lateThreshold = new Date(shiftStart);
            lateThreshold.setMinutes(cfg.lateAfterMinutes);
            const attStatus = checkIn > lateThreshold ? 'late' : 'present';

            // Check out 15–30 min after shift end (or exactly on time)
            const shiftEnd  = new Date(date);
            shiftEnd.setHours(cfg.endHour, 0, 0, 0);
            const checkOut = new Date(shiftEnd);
            checkOut.setMinutes(Math.floor(Math.random() * 30));

            const [att] = await db
              .insert(attendance)
              .values({
                scheduleId:   schedId,
                userId:       tmpl.userId,
                storeId:      store.id,
                date:         startOfDay(date),
                shift,
                status:       attStatus,
                checkInTime:  checkIn,
                checkOutTime: checkOut,
                onBreak:      false,
                recordedBy:   tmpl.userId,
              })
              .returning({ id: attendance.id });

            attCreated++;

            // Link attendance to tasks
            await db
              .update(employeeTasks)
              .set({ attendanceId: att.id, updatedAt: new Date() })
              .where(
                and(
                  eq(employeeTasks.scheduleId, schedId),
                  eq(employeeTasks.userId,     tmpl.userId),
                )
              );

            // Mark tasks complete (90% chance each)
            const pendingTasks = await db
              .select()
              .from(employeeTasks)
              .where(
                and(
                  eq(employeeTasks.scheduleId, schedId),
                  eq(employeeTasks.userId,     tmpl.userId),
                  eq(employeeTasks.status,     'pending'),
                )
              );

            for (const et of pendingTasks) {
              if (Math.random() < 0.90) {
                const completedAt = new Date(checkIn);
                completedAt.setMinutes(completedAt.getMinutes() + Math.floor(Math.random() * 60) + 10);
                await db
                  .update(employeeTasks)
                  .set({ status: 'completed', completedAt, updatedAt: new Date() })
                  .where(eq(employeeTasks.id, et.id));
              }
            }

            // Simulate a break session (80% chance)
            if (Math.random() < 0.80) {
              const breakStart = new Date(checkIn);
              breakStart.setHours(
                shift === 'morning' ? 12 : 17,
                Math.floor(Math.random() * 30),
                0, 0
              );
              const breakEnd = new Date(breakStart);
              breakEnd.setMinutes(breakEnd.getMinutes() + 30 + Math.floor(Math.random() * 15));

              await db.insert(breakSessions).values({
                attendanceId: att.id,
                userId:       tmpl.userId,
                storeId:      store.id,
                breakType:    shift === 'morning' ? 'lunch' : 'dinner',
                breakOutTime: breakStart,
                returnTime:   breakEnd,
              });
            }
          }

          attCreated++;
        }
      }

      // Update watermark
      await db
        .update(weeklyScheduleTemplates)
        .set({ lastScheduledThrough: horizon, updatedAt: new Date() })
        .where(eq(weeklyScheduleTemplates.id, tmpl.id));

      totalSchedules += schedsCreated;
      totalTasks     += tasksCreated;
      totalAttendance += attCreated;

      console.log(`      schedules: +${schedsCreated}  tasks: +${tasksCreated}  attendance: +${attCreated}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅  seed-schedules complete!\n');
  console.log(`   Schedules created : ${totalSchedules}`);
  console.log(`   Tasks created     : ${totalTasks}`);
  console.log(`   Attendance seeded : ${totalAttendance}`);
  console.log(`   Range             : ${pastFrom.toDateString()} → ${horizon.toDateString()}`);
  console.log('═══════════════════════════════════════════════════════════');
}

seedSchedules()
  .then(() => process.exit(0))
  .catch((err) => { console.error('❌  seed-schedules failed:', err); process.exit(1); });
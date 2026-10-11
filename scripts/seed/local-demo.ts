// Extend the repository's September seed into the current month, local DB only.
import '../lib/not-production';
import { db, pool } from '@/lib/db';
import { and, eq, gte, lt } from 'drizzle-orm';
import { monthlySchedules, monthlyScheduleEntries, schedules, storeMonthlyTargets, employeeMonthlyTargets } from '@/lib/db/schema';
import { addDaysKey, daysInMonthKey, jakartaDateKey, jakartaDayStart, jakartaMonthRange, jakartaTodayKey } from '@/lib/day-bucket';
import { YEAR_MONTH } from './dataset';
import { seedTasks } from './tasks';
import { seedAttendance } from './attendance';

async function run() {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.pathname !== '/prism_local') {
    throw new Error('Local demo seeding requires the local prism_local database.');
  }
  const month = jakartaTodayKey().slice(0, 7);
  if (month !== YEAR_MONTH) {
    const source = await db.select().from(monthlySchedules).where(eq(monthlySchedules.yearMonth, YEAR_MONTH));
    for (const master of source) {
      const existing = await db.select({ id: monthlySchedules.id }).from(monthlySchedules)
        .where(and(eq(monthlySchedules.storeId, master.storeId), eq(monthlySchedules.yearMonth, month))).limit(1);
      if (existing.length) continue;
      const [created] = await db.insert(monthlySchedules).values({ storeId: master.storeId, yearMonth: month, note: 'Local demo adapted from September roster' }).returning();
      const entries = await db.select().from(monthlyScheduleEntries).where(eq(monthlyScheduleEntries.monthlyScheduleId, master.id));
      const byUser = new Map<string, typeof entries>();
      for (const row of entries) {
        const rows = byUser.get(row.userId) ?? [];
        rows.push(row);
        byUser.set(row.userId, rows);
      }
      for (const rows of byUser.values()) {
        const byDay = new Map(rows.map((row) => [Number(jakartaDateKey(row.date).slice(-2)), row]));
        for (let day = 1; day <= daysInMonthKey(month); day++) {
          const original = byDay.get(day) ?? byDay.get(1);
          if (!original) continue;
          const date = jakartaDayStart(addDaysKey(`${month}-01`, day - 1));
          const [entry] = await db.insert(monthlyScheduleEntries).values({ monthlyScheduleId: created.id, userId: original.userId, storeId: master.storeId, date, shiftId: original.shiftId, isOff: original.isOff, isLeave: original.isLeave }).returning();
          if (entry.shiftId && !entry.isOff && !entry.isLeave) {
            await db.insert(schedules).values({ userId: entry.userId, storeId: entry.storeId, date, shiftId: entry.shiftId, monthlyScheduleEntryId: entry.id, isHoliday: false });
          }
        }
      }
    }
    const storeTargets = await db.select().from(storeMonthlyTargets).where(eq(storeMonthlyTargets.yearMonth, YEAR_MONTH));
    for (const row of storeTargets) {
      await db.insert(storeMonthlyTargets).values({ storeId: row.storeId, yearMonth: month, monthlySalesTarget: row.monthlySalesTarget, monthlyTransactionTarget: row.monthlyTransactionTarget, notes: 'Local demo target' }).onConflictDoNothing();
    }
    const employeeTargets = await db.select().from(employeeMonthlyTargets).where(eq(employeeMonthlyTargets.yearMonth, YEAR_MONTH));
    for (const row of employeeTargets) {
      await db.insert(employeeMonthlyTargets).values({ userId: row.userId, storeId: row.storeId, yearMonth: month, percentage: row.percentage, targetRoleCode: row.targetRoleCode, sortOrder: row.sortOrder, isPercentageOverridden: row.isPercentageOverridden }).onConflictDoNothing();
    }
  }
  // Seeder functions resolve these variables when called; no external BC calls.
  process.env.SEED_TASKS_MONTH = month;
  process.env.SEED_ATTENDANCE_MONTH = month;
  process.env.SEED_ONLY_BEFORE_DATE = jakartaTodayKey();
  await seedTasks();
  await seedAttendance();
  const range = jakartaMonthRange(month);
  const rows = await db.select({ id: schedules.id }).from(schedules).where(and(gte(schedules.date, range.start), lt(schedules.date, range.end)));
  console.log(`Local demo ready: ${month}, ${rows.length} working schedules.`);
}

run().then(() => pool.end()).catch(async (error) => { console.error(error); await pool.end(); process.exitCode = 1; });

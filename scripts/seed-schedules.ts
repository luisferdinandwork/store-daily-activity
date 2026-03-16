// scripts/seed-schedules.ts
/**
 * Generates monthly schedules for March 2026 only.
 * Creates:
 *   - One MonthlySchedule per store
 *   - MonthlyScheduleEntries (daily shift assignments per employee)
 *   - schedules rows (one per working shift entry)
 *
 * Tasks are NOT seeded here — they are created on check-in.
 * Attendance is NOT seeded — employees check in via the app.
 *
 * Safe to re-run — idempotent (skips already-existing rows).
 * Run with: tsx scripts/seed-schedules.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
import {
  users, stores, areas,
  monthlySchedules, monthlyScheduleEntries,
  schedules,
} from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

// ─── Target month ─────────────────────────────────────────────────────────────
const YEAR       = 2026;
const MONTH      = 2;   // 0-indexed: 2 = March
const YEAR_MONTH = '2026-03';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function* eachDayOfMonth(year: number, month: number): Generator<Date> {
  const count = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= count; d++) {
    yield new Date(year, month, d, 0, 0, 0, 0);
  }
}

/**
 * Build flat list of day entries for one employee based on a weekly pattern.
 * pattern: 7-element array indexed by getDay() (0=Sun … 6=Sat)
 *   'E'   = morning shift
 *   'L'   = evening shift
 *   'OFF' = day off
 */
function buildDayEntries(
  userId:  string,
  storeId: string,
  year:    number,
  month:   number,
  pattern: string[],
): Array<{
  userId:  string;
  storeId: string;
  date:    Date;
  shift:   'morning' | 'evening' | null;
  isOff:   boolean;
  isLeave: boolean;
}> {
  const entries = [];
  for (const date of eachDayOfMonth(year, month)) {
    const code = pattern[date.getDay()] ?? 'OFF';
    if (code === 'E') {
      entries.push({ userId, storeId, date, shift: 'morning' as const, isOff: false, isLeave: false });
    } else if (code === 'L') {
      entries.push({ userId, storeId, date, shift: 'evening' as const, isOff: false, isLeave: false });
    } else {
      entries.push({ userId, storeId, date, shift: null, isOff: true, isLeave: false });
    }
  }
  return entries;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedSchedules() {
  console.log(`📅  seed-schedules: ${YEAR_MONTH} (March ${YEAR})\n`);

  const allStores = await db
    .select({ store: stores, area: areas })
    .from(stores)
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .orderBy(areas.name, stores.name);

  if (!allStores.length) {
    console.error('❌  No stores found. Run seed-setup.ts first.');
    process.exit(1);
  }

  let totalMonthlySchedules  = 0;
  let totalEntries           = 0;
  let totalScheduleRows      = 0;

  for (const { store, area } of allStores) {
    console.log(`\n── ${store.name} (${area?.name ?? 'no area'}) ────────────────────`);

    // Get all employees whose home store is this store
    const employees = await db
      .select()
      .from(users)
      .where(eq(users.homeStoreId, store.id));

    if (!employees.length) {
      console.log('   ⚠️  No employees assigned to this store — skipping');
      continue;
    }

    // ── Find or create the MonthlySchedule header ───────────────────────────
    const [existingMs] = await db
      .select({ id: monthlySchedules.id })
      .from(monthlySchedules)
      .where(
        and(
          eq(monthlySchedules.storeId,   store.id),
          eq(monthlySchedules.yearMonth, YEAR_MONTH),
        ),
      )
      .limit(1);

    let msId: string;

    if (existingMs) {
      msId = existingMs.id;
      console.log(`   ↩️  Monthly schedule already exists (${msId}) — reusing`);
    } else {
      const pic1 = employees.find(e => e.employeeType === 'pic_1') ?? employees[0];
      const [ms] = await db
        .insert(monthlySchedules)
        .values({
          storeId:    store.id,
          yearMonth:  YEAR_MONTH,
          importedBy: pic1.id,
          note:       'Seeded for March 2026',
        })
        .returning({ id: monthlySchedules.id });
      msId = ms.id;
      totalMonthlySchedules++;
      console.log(`   ✅ Created MonthlySchedule ${msId}`);
    }

    // ── Seed entries + schedule rows per employee ───────────────────────────
    for (const emp of employees) {
      // Shift pattern by employee type
      // Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
      let pattern: string[];
      if (emp.employeeType === 'pic_1') {
        // Mon–Fri morning, weekend off
        pattern = ['OFF', 'E', 'E', 'E', 'E', 'E', 'OFF'];
      } else if (emp.employeeType === 'pic_2') {
        // Mon/Wed/Fri morning, Tue/Thu/Sat evening, Sun off
        pattern = ['OFF', 'E', 'L', 'E', 'L', 'E', 'L'];
      } else {
        // SO: Tue–Sat evening, Sun/Mon off
        pattern = ['OFF', 'OFF', 'L', 'L', 'L', 'L', 'L'];
      }

      const dayEntries = buildDayEntries(emp.id, store.id, YEAR, MONTH, pattern);

      let empEntries  = 0;
      let empSchedules = 0;

      for (const entry of dayEntries) {
        // ── Insert MonthlyScheduleEntry (skip on conflict) ─────────────────
        const [mse] = await db
          .insert(monthlyScheduleEntries)
          .values({
            monthlyScheduleId: msId,
            userId:            entry.userId,
            storeId:           entry.storeId,
            date:              startOfDay(entry.date),
            shift:             entry.shift ?? undefined,
            isOff:             entry.isOff,
            isLeave:           entry.isLeave,
          })
          .onConflictDoNothing()
          .returning({ id: monthlyScheduleEntries.id });

        if (mse) empEntries++;

        // Only working days get a schedule row
        if (entry.isOff || entry.isLeave || !entry.shift) continue;

        const shift = entry.shift;
        const date  = startOfDay(entry.date);

        // Idempotency: skip if schedule row already exists for this slot
        const [existingSched] = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(
            and(
              eq(schedules.userId,  emp.id),
              eq(schedules.storeId, store.id),
              eq(schedules.shift,   shift),
              gte(schedules.date,   startOfDay(date)),
              lte(schedules.date,   endOfDay(date)),
            ),
          )
          .limit(1);

        if (existingSched) continue;

        // Need the MSE id for the FK — use the one just inserted or look it up
        const mseId = mse?.id ?? (await db
          .select({ id: monthlyScheduleEntries.id })
          .from(monthlyScheduleEntries)
          .where(
            and(
              eq(monthlyScheduleEntries.monthlyScheduleId, msId),
              eq(monthlyScheduleEntries.userId,            emp.id),
              gte(monthlyScheduleEntries.date,             startOfDay(date)),
              lte(monthlyScheduleEntries.date,             endOfDay(date)),
            ),
          )
          .limit(1)
          .then(rows => rows[0]?.id));

        if (!mseId) {
          console.warn(`   ⚠️  Could not resolve MSE id for ${emp.name} on ${date.toISOString().slice(0, 10)} — skipping schedule row`);
          continue;
        }

        await db
          .insert(schedules)
          .values({
            userId:                 emp.id,
            storeId:                store.id,
            shift,
            date,
            monthlyScheduleEntryId: mseId,
            isHoliday:              false,
          });

        empSchedules++;
      }

      totalEntries      += empEntries;
      totalScheduleRows += empSchedules;

      console.log(
        `   👤 ${emp.name.padEnd(18)} (${(emp.employeeType ?? 'ops').padEnd(5)})` +
        `  entries+${empEntries}  scheduleRows+${empSchedules}`,
      );
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅  seed-schedules complete!\n');
  console.log(`   MonthlySchedules created : ${totalMonthlySchedules}`);
  console.log(`   Entries inserted         : ${totalEntries}`);
  console.log(`   Schedule rows created    : ${totalScheduleRows}`);
  console.log(`   Month                    : ${YEAR_MONTH}`);
  console.log('═══════════════════════════════════════════════════════════');
}

seedSchedules()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-schedules failed:', err); process.exit(1); });
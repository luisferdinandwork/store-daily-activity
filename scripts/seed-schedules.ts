// scripts/seed-schedules.ts
// ─────────────────────────────────────────────────────────────────────────────
// Generates monthly schedules for March 2026.
//
// Creates per store:
//   • One MonthlySchedule header row
//   • MonthlyScheduleEntries — one per employee per calendar day
//   • schedules rows          — one per working shift entry (no OFF/leave)
//
// Tasks are NOT seeded here — run seed-tasks.ts after this.
// Attendance is NOT seeded — employees check in via the app.
//
// Changes from previous version
// ──────────────────────────────
//  • store.id / monthly_schedule.id / entry.id / schedule.id are integers
//  • homeStoreId on users is integer — eq() comparison updated accordingly
//  • monthlyScheduleEntryId FK on schedules is integer
//
// Safe to re-run — idempotent (skips already-existing rows).
// Run with: tsx scripts/seed-schedules.ts
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db }   from '@/lib/db';
import {
  users, stores, areas,
  monthlySchedules, monthlyScheduleEntries,
  schedules,
} from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

// ─── Target month ─────────────────────────────────────────────────────────────

const YEAR       = 2026;
const MONTH      = 2;          // 0-indexed: 2 = March
const YEAR_MONTH = '2026-03';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}

function* eachDayOfMonth(year: number, month: number): Generator<Date> {
  const count = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= count; d++) {
    yield new Date(year, month, d, 0, 0, 0, 0);
  }
}

/**
 * Build a flat list of day entries for one employee.
 * `pattern` is a 7-element array indexed by Date.getDay() (0=Sun…6=Sat):
 *   'E'   → morning shift
 *   'L'   → evening shift
 *   'OFF' → day off
 */
function buildDayEntries(
  userId:  string,
  storeId: number,
  year:    number,
  month:   number,
  pattern: string[],
) {
  const entries: {
    userId:  string;
    storeId: number;
    date:    Date;
    shift:   'morning' | 'evening' | null;
    isOff:   boolean;
    isLeave: boolean;
  }[] = [];

  for (const date of eachDayOfMonth(year, month)) {
    const code = pattern[date.getDay()] ?? 'OFF';
    if (code === 'E') {
      entries.push({ userId, storeId, date, shift: 'morning', isOff: false, isLeave: false });
    } else if (code === 'L') {
      entries.push({ userId, storeId, date, shift: 'evening', isOff: false, isLeave: false });
    } else {
      entries.push({ userId, storeId, date, shift: null,      isOff: true,  isLeave: false });
    }
  }
  return entries;
}

// ─── Shift patterns by employee type ─────────────────────────────────────────
// Index: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

const PATTERNS: Record<string, string[]> = {
  // PIC 1: Mon–Fri morning, weekends off
  pic_1: ['OFF', 'E', 'E', 'E', 'E', 'E', 'OFF'],
  // PIC 2: alternating morning/evening Mon–Sat, Sun off
  pic_2: ['OFF', 'E', 'L', 'E', 'L', 'E', 'L'],
  // SO: Tue–Sat evening, Sun/Mon off
  so:    ['OFF', 'OFF', 'L', 'L', 'L', 'L', 'L'],
  // Fallback (ops etc.) — shouldn't appear in schedule but safe to have
  default: ['OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'],
};

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

  let totalMs       = 0;
  let totalEntries  = 0;
  let totalSchedRows = 0;

  for (const { store, area } of allStores) {
    console.log(`\n── ${store.name} (${area?.name ?? 'no area'}) ──────────────────────`);

    // All employees whose home store is this store
    const employees = await db
      .select()
      .from(users)
      .where(eq(users.homeStoreId, store.id));

    if (!employees.length) {
      console.log('   ⚠️  No employees assigned — skipping');
      continue;
    }

    // ── Find or create MonthlySchedule header ──────────────────────────────
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

    let msId: number;

    if (existingMs) {
      msId = existingMs.id;
      console.log(`   ↩️  MonthlySchedule already exists (id=${msId}) — reusing`);
    } else {
      const pic1 = employees.find(e => e.employeeType === 'pic_1') ?? employees[0];
      const [ms] = await db
        .insert(monthlySchedules)
        .values({
          storeId:    store.id,
          yearMonth:  YEAR_MONTH,
          importedBy: pic1.id,
          note:       `Seeded for March ${YEAR}`,
        })
        .returning({ id: monthlySchedules.id });

      msId = ms.id;
      totalMs++;
      console.log(`   ✅ Created MonthlySchedule id=${msId}`);
    }

    // ── Entries + schedule rows per employee ───────────────────────────────
    for (const emp of employees) {
      const pattern = PATTERNS[emp.employeeType ?? 'default'] ?? PATTERNS.default;
      const dayEntries = buildDayEntries(emp.id, store.id, YEAR, MONTH, pattern);

      let empEntries  = 0;
      let empSchedules = 0;

      for (const entry of dayEntries) {
        const dateVal = startOfDay(entry.date);

        // ── Insert MonthlyScheduleEntry (skip conflict silently) ───────────
        const [mse] = await db
          .insert(monthlyScheduleEntries)
          .values({
            monthlyScheduleId: msId,
            userId:            entry.userId,
            storeId:           entry.storeId,
            date:              dateVal,
            shift:             entry.shift ?? undefined,
            isOff:             entry.isOff,
            isLeave:           entry.isLeave,
          })
          .onConflictDoNothing()
          .returning({ id: monthlyScheduleEntries.id });

        if (mse) empEntries++;

        // OFF / leave → no schedule row needed
        if (entry.isOff || entry.isLeave || !entry.shift) continue;

        // ── Idempotency check for schedule row ─────────────────────────────
        const [existingSched] = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(
            and(
              eq(schedules.userId,  emp.id),
              eq(schedules.storeId, store.id),
              eq(schedules.shift,   entry.shift),
              gte(schedules.date,   startOfDay(dateVal)),
              lte(schedules.date,   endOfDay(dateVal)),
            ),
          )
          .limit(1);

        if (existingSched) continue;

        // Resolve the MSE id (use just-inserted one or look it up)
        const mseId: number | undefined = mse?.id ?? (
          await db
            .select({ id: monthlyScheduleEntries.id })
            .from(monthlyScheduleEntries)
            .where(
              and(
                eq(monthlyScheduleEntries.monthlyScheduleId, msId),
                eq(monthlyScheduleEntries.userId,            emp.id),
                gte(monthlyScheduleEntries.date,             startOfDay(dateVal)),
                lte(monthlyScheduleEntries.date,             endOfDay(dateVal)),
              ),
            )
            .limit(1)
            .then(rows => rows[0]?.id)
        );

        if (!mseId) {
          console.warn(
            `   ⚠️  Cannot resolve MSE id for ${emp.name} ` +
            `on ${dateVal.toISOString().slice(0, 10)} — skipping schedule row`,
          );
          continue;
        }

        await db.insert(schedules).values({
          userId:                 emp.id,
          storeId:                store.id,
          shift:                  entry.shift,
          date:                   dateVal,
          monthlyScheduleEntryId: mseId,
          isHoliday:              false,
        });

        empSchedules++;
      }

      totalEntries   += empEntries;
      totalSchedRows += empSchedules;

      console.log(
        `   👤 ${emp.name.padEnd(18)}` +
        ` (${(emp.employeeType ?? 'ops').padEnd(5)})` +
        `  entries+${empEntries}  scheduleRows+${empSchedules}`,
      );
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅  seed-schedules complete!\n');
  console.log(`   MonthlySchedules created : ${totalMs}`);
  console.log(`   Entries inserted         : ${totalEntries}`);
  console.log(`   Schedule rows created    : ${totalSchedRows}`);
  console.log(`   Month                    : ${YEAR_MONTH}`);
  console.log('\n   Next step: tsx scripts/seed-tasks.ts');
  console.log('═══════════════════════════════════════════════════════════');
}

seedSchedules()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-schedules failed:', err); process.exit(1); });
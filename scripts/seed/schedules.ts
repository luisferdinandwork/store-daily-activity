// scripts/seed/schedules.ts
//
// Seeds the September 2026 monthly schedule for every store in
// scripts/seed/dataset.ts that has one:
//
//   FF001 / FO001 — transcribed verbatim from "MRO SEP 2026"
//   DUMMY-001     — a simple deterministic pattern (synthetic)
//
// Shift codes per day:
//   E → morning · L → evening · F → full day · X → day off · A → leave (AL)
//
// It writes the three layers the app reads:
//   1. monthly_schedules          — one master row per store / 2026-09
//   2. monthly_schedule_entries   — one row per (employee, day), OFF/leave incl.
//   3. schedules                  — the materialised working days (E/L/F only)
//
// Dates are stored as UTC midnight of the calendar day (`Date.UTC`), matching
// the running app's convention (production runs in UTC — see
// lib/schedule-utils.ts `todayInStoreTimezone`). Drizzle's timestamp column
// serialises via `.toISOString()`, so this keeps the seed correct no matter
// what timezone it is run from.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  monthlySchedules,
  monthlyScheduleEntries,
  schedules,
  shifts,
  stores,
  users,
} from '@/lib/db/schema';
import {
  DAYS_IN_MONTH,
  SEED_MONTH_INDEX,
  SEED_YEAR,
  STORES,
  YEAR_MONTH,
} from './dataset';

const BATCH_SIZE = 500;

/** UTC midnight of a given day-of-month — the app's stored-date convention. */
function utcDay(day: number): Date {
  return new Date(Date.UTC(SEED_YEAR, SEED_MONTH_INDEX, day, 0, 0, 0, 0));
}

/** "YYYY-MM-DD" for a given day-of-month. */
function ymd(day: number): string {
  return `${YEAR_MONTH}-${String(day).padStart(2, '0')}`;
}

async function insertInBatches<T extends Record<string, unknown>>(table: any, rows: T[]) {
  if (!rows.length) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(table).values(batch as any);
    inserted += batch.length;
  }
  return inserted;
}

type ShiftName = 'morning' | 'evening' | 'full_day';
type DayShape =
  | { shiftCode: ShiftName; isOff: false; isLeave: false }
  | { shiftCode: null; isOff: true; isLeave: false }
  | { shiftCode: null; isOff: false; isLeave: true };

function codeToDay(code: string): DayShape {
  if (code === 'E') return { shiftCode: 'morning', isOff: false, isLeave: false };
  if (code === 'L') return { shiftCode: 'evening', isOff: false, isLeave: false };
  if (code === 'F') return { shiftCode: 'full_day', isOff: false, isLeave: false };
  if (code === 'A') return { shiftCode: null, isOff: false, isLeave: true };
  return { shiftCode: null, isOff: true, isLeave: false }; // X / anything else
}

async function seedStoreSchedule(
  storeNo: string,
  shiftIdByCode: Record<string, number>,
) {
  const def = STORES.find((s) => s.storeNo === storeNo);
  if (!def || !def.schedule) return;

  const grid = def.schedule;

  // Validate every grid row is exactly one entry per calendar day.
  for (const [nik, days] of Object.entries(grid)) {
    if (days.length !== DAYS_IN_MONTH) {
      throw new Error(`${storeNo}: grid for ${nik} has ${days.length} days, expected ${DAYS_IN_MONTH}.`);
    }
  }

  const [store] = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(eq(stores.storeNo, storeNo))
    .limit(1);
  if (!store) throw new Error(`Store ${storeNo} not found. Run the setup seed step first.`);

  const niks = Object.keys(grid);
  const userRows = await db
    .select({ id: users.id, nik: users.nik })
    .from(users)
    .where(inArray(users.nik, niks));

  const idByNik = new Map(userRows.map((u) => [u.nik, u.id]));
  const missing = niks.filter((n) => !idByNik.has(n));
  if (missing.length) {
    throw new Error(`${storeNo}: employee NIK(s) not found: ${missing.join(', ')}. Run the setup seed step first.`);
  }

  // First roster member (PIC 1, by dataset order) is stamped as importer.
  const importedBy = idByNik.get(def.employees[0]?.nik ?? niks[0]) ?? null;

  // Clear any prior schedule for this store: schedules first (FK to
  // monthly_schedule_entries with no cascade), then the master (cascades entries).
  await db.delete(schedules).where(eq(schedules.storeId, store.id));
  await db
    .delete(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, store.id), eq(monthlySchedules.yearMonth, YEAR_MONTH)));

  const [master] = await db
    .insert(monthlySchedules)
    .values({
      storeId: store.id,
      yearMonth: YEAR_MONTH,
      importedBy,
      note: `Seeded from the Sep 2026 break-down sheet — ${storeNo}`,
    })
    .returning({ id: monthlySchedules.id });

  // ── monthly_schedule_entries ─────────────────────────────────────────────
  const entryRows: Array<typeof monthlyScheduleEntries.$inferInsert> = [];
  for (const [nik, days] of Object.entries(grid)) {
    const userId = idByNik.get(nik)!;
    for (let day = 1; day <= DAYS_IN_MONTH; day++) {
      const shape = codeToDay(days[day - 1]);
      entryRows.push({
        monthlyScheduleId: master.id,
        userId,
        storeId: store.id,
        date: utcDay(day),
        shiftId: shape.shiftCode ? shiftIdByCode[shape.shiftCode] : null,
        isOff: shape.isOff,
        isLeave: shape.isLeave,
      });
    }
  }
  const entriesCreated = await insertInBatches(monthlyScheduleEntries, entryRows);

  // ── schedules (materialised working days) ─────────────────────────────────
  // Re-read entry ids keyed by (userId, YYYY-MM-DD) — reading the date as text
  // via to_char sidesteps any driver-side timezone reinterpretation.
  const persisted = await db
    .select({
      id: monthlyScheduleEntries.id,
      userId: monthlyScheduleEntries.userId,
      ymd: sql<string>`to_char(${monthlyScheduleEntries.date}, 'YYYY-MM-DD')`,
    })
    .from(monthlyScheduleEntries)
    .where(eq(monthlyScheduleEntries.monthlyScheduleId, master.id));

  const entryIdByKey = new Map(persisted.map((e) => [`${e.userId}|${e.ymd}`, e.id]));

  const scheduleRows: Array<typeof schedules.$inferInsert> = [];
  for (const [nik, days] of Object.entries(grid)) {
    const userId = idByNik.get(nik)!;
    for (let day = 1; day <= DAYS_IN_MONTH; day++) {
      const shape = codeToDay(days[day - 1]);
      if (!shape.shiftCode) continue; // OFF / leave — no schedules row

      const entryId = entryIdByKey.get(`${userId}|${ymd(day)}`);
      if (!entryId) throw new Error(`${storeNo}: missing entry for ${nik} on ${ymd(day)}`);

      scheduleRows.push({
        userId,
        storeId: store.id,
        shiftId: shiftIdByCode[shape.shiftCode],
        date: utcDay(day),
        monthlyScheduleEntryId: entryId,
        isHoliday: false,
      });
    }
  }
  const schedulesCreated = await insertInBatches(schedules, scheduleRows);

  const offCount = entryRows.filter((e) => e.isOff).length;
  const leaveCount = entryRows.filter((e) => e.isLeave).length;
  console.log(
    `   ✓ ${storeNo} ${store.name} — ${entriesCreated} entries (${niks.length}×${DAYS_IN_MONTH}), ` +
    `${schedulesCreated} work / ${offCount} off / ${leaveCount} leave`,
  );
}

export async function seedSchedules() {
  console.log(`\n🗓️  Seeding monthly schedules for ${YEAR_MONTH}`);

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftIdByCode = Object.fromEntries(shiftRows.map((s) => [s.code, s.id])) as Record<string, number>;
  for (const need of ['morning', 'evening', 'full_day']) {
    if (!shiftIdByCode[need]) throw new Error(`Shift "${need}" missing. Run the setup seed step first.`);
  }

  for (const s of STORES) {
    if (s.schedule) await seedStoreSchedule(s.storeNo, shiftIdByCode);
  }

  console.log('\n✅ seed-schedules complete.');
}

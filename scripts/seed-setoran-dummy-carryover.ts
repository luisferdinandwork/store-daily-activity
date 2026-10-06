// scripts/seed-setoran-dummy-carryover.ts
//
// Gives the DUMMY-001 test store a "sisa setoran" (carried-over balance) so the
// employee Setoran page can be tried with Total uang Cash Drawer =
// uang aktual diterima + sisa kemarin.
//
//   npx dotenv -e .env.local -- tsx scripts/seed-setoran-dummy-carryover.ts
//   SETORAN_CARRY=120000 npx dotenv -e .env.local -- tsx scripts/seed-setoran-dummy-carryover.ts
//
// What it does (all for DUMMY-001 only; safe to re-run — each run resets the scenario):
//   1. Deletes the store's setoran tasks for yesterday + today (their ledger rows
//      go with them), including any stale draft, so today starts "not started".
//   2. Writes yesterday's completed setoran whose unpaid (sisa) = SETORAN_CARRY
//      (default Rp 49.551 — the case from the bug report). Today's task is NOT
//      pre-created: it is made lazily when the employee opens it, and picks the
//      carried sisa up as "sisa kemarin".
//   3. Makes DUMMY-PIC1 testable today: an opening-shift schedule and a check-in,
//      only if they don't exist yet (nothing existing is overwritten).
//
// Try it: open Setoran as DUMMY-PIC1 (seed password) — or as IT-001 in a role
// preview of the Dummy store — and type "Uang aktual diterima" = 47800. Total uang
// Cash Drawer is Rp 97.351, so Total wajib disetor is Rp 50.000 and Kurang
// Rp 47.351; before the fix the page wrongly treated it as "setoran kecil".

// Refuses to run against production (scripts/lib/not-production.ts).
import './lib/not-production';

import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  attendance,
  schedules,
  setoranMoneyStorage,
  setoranTasks,
  shifts,
  stores,
  users,
} from '@/lib/db/schema';
import {
  addDaysKey,
  jakartaDayRange,
  jakartaDayStart,
  jakartaTodayKey,
  jakartaWallClock,
} from '@/lib/day-bucket';

const STORE_NO = 'DUMMY-001';
const USER_NIK = 'DUMMY-PIC1';
/** Cash the store banked yesterday, on top of the carried sisa. */
const YESTERDAY_STORED = 1_000_000;
const OPENING_SHIFTS = ['full_day', 'morning'] as const;

const money = (n: number) => n.toFixed(2);
const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function readCarry(): number {
  const raw = process.env.SETORAN_CARRY;
  if (raw == null || raw === '') return 49_551;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`SETORAN_CARRY must be a whole number of Rupiah, got "${raw}".`);
  return n;
}

async function main() {
  const carry = readCarry();

  const [store] = await db.select().from(stores).where(eq(stores.storeNo, STORE_NO)).limit(1);
  if (!store) throw new Error(`Store ${STORE_NO} not found. Run "npm run db:seed" first.`);

  const [user] = await db.select().from(users).where(eq(users.nik, USER_NIK)).limit(1);
  if (!user) throw new Error(`User ${USER_NIK} not found. Run "npm run db:seed" first.`);

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const morning = shiftRows.find((s) => s.code === 'morning');
  const openingShift = OPENING_SHIFTS.map((c) => shiftRows.find((s) => s.code === c)).find(Boolean);
  if (!morning || !openingShift) throw new Error('morning / full_day shifts not found. Run "npm run db:seed" first.');

  const todayKey = jakartaTodayKey();
  const yesterdayKey = addDaysKey(todayKey, -1);
  const yesterdayStart = jakartaDayStart(yesterdayKey);
  const today = jakartaDayRange(todayKey);

  // 1. Reset yesterday + today for this store (ledger rows cascade with the task).
  const removed = await db
    .delete(setoranTasks)
    .where(and(
      eq(setoranTasks.storeId, store.id),
      gte(setoranTasks.date, yesterdayStart),
      lt(setoranTasks.date, today.end),
    ))
    .returning({ id: setoranTasks.id });

  // 2. Yesterday: received = carry + what was banked, so unpaid (sisa) = carry.
  const received = carry + YESTERDAY_STORED;
  const required = received; // nothing carried into yesterday
  const unpaid = required - YESTERDAY_STORED;
  const doneAt = jakartaWallClock(yesterdayKey, '10:00');
  const now = new Date();

  const [task] = await db
    .insert(setoranTasks)
    .values({
      scheduleId: null, // like an IT-filled day: independent of any schedule
      userId: user.id,
      storeId: store.id,
      shiftId: morning.id,
      date: yesterdayStart,
      expectedAmount: money(received),
      carriedDeficit: money(0),
      carriedDeficitFetchedAt: doneAt,
      amount: money(YESTERDAY_STORED),
      unpaidAmount: money(unpaid),
      isNoSetoran: false,
      notes: 'Seed: sisa setoran untuk uji coba.',
      actualReceivedAmountBy: user.id,
      actualReceivedAmountAt: doneAt,
      storedAmountBy: user.id,
      storedAmountAt: doneAt,
      completedBy: user.id,
      status: 'completed',
      completedAt: doneAt,
      createdAt: doneAt,
      updatedAt: doneAt,
    })
    .returning();

  await db.insert(setoranMoneyStorage).values({
    taskId: task.id,
    scheduleId: null,
    userId: user.id,
    storeId: store.id,
    shiftId: morning.id,
    date: yesterdayStart,
    actualReceivedAmount: money(received),
    previousUnpaidAmount: money(0),
    requiredStoreAmount: money(required),
    storedAmount: money(YESTERDAY_STORED),
    unpaidAmount: money(unpaid),
    isNoSetoran: false,
    notes: task.notes,
    actualReceivedAmountBy: user.id,
    actualReceivedAmountAt: doneAt,
    storedAmountBy: user.id,
    storedAmountAt: doneAt,
    completedBy: user.id,
    createdAt: doneAt,
    updatedAt: doneAt,
  });

  // 3. Today: an opening-shift schedule + check-in for DUMMY-PIC1, if missing.
  let [schedule] = await db
    .select()
    .from(schedules)
    .where(and(
      eq(schedules.userId, user.id),
      eq(schedules.storeId, store.id),
      gte(schedules.date, today.start),
      lt(schedules.date, today.end),
    ))
    .limit(1);

  let madeSchedule = false;
  if (!schedule) {
    [schedule] = await db
      .insert(schedules)
      .values({
        userId: user.id,
        storeId: store.id,
        shiftId: openingShift.id,
        date: today.start,
        isHoliday: false,
      })
      .returning();
    madeSchedule = true;
  }

  const shiftCode = shiftRows.find((s) => s.id === schedule.shiftId)?.code;
  const opening = shiftCode != null && (OPENING_SHIFTS as readonly string[]).includes(shiftCode);

  const [att] = await db.select().from(attendance).where(eq(attendance.scheduleId, schedule.id)).limit(1);
  let madeAttendance = false;
  if (!att && opening && !schedule.isHoliday) {
    await db.insert(attendance).values({
      scheduleId: schedule.id,
      userId: user.id,
      storeId: store.id,
      date: schedule.date,
      shiftId: schedule.shiftId,
      status: 'present',
      checkInTime: now,
      notes: 'Seed: check-in untuk uji coba Setoran.',
    });
    madeAttendance = true;
  }

  console.log('✅ Seeded Setoran carry-over on', `${STORE_NO} (${store.name})`);
  console.log(`   Cleared setoran tasks   : ${removed.length} (yesterday + today)`);
  console.log(`   ${yesterdayKey} (kemarin)   : diterima ${rp(received)}, disetor ${rp(YESTERDAY_STORED)} → sisa ${rp(unpaid)}`);
  console.log(`   ${todayKey} (hari ini)  : task dibuat saat dibuka; sisa kemarin = ${rp(unpaid)}`);
  console.log(`   ${USER_NIK} schedule      : #${schedule.id} (${shiftCode}) ${madeSchedule ? 'created' : 'already existed'}`);
  console.log(`   ${USER_NIK} check-in      : ${madeAttendance ? 'created' : att ? 'already existed' : 'skipped (not an opening shift)'}`);
  if (!opening) console.log(`   ⚠ Today's ${USER_NIK} shift is "${shiftCode}" — Setoran needs an opening shift (morning / full_day).`);
  console.log('\nTry: Setoran → "Uang aktual diterima kemarin" = 47800');
  console.log(`   → Total uang Cash Drawer ${rp(47_800 + unpaid)}, Total wajib disetor ${rp(Math.floor((47_800 + unpaid) / 50_000) * 50_000)}.`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

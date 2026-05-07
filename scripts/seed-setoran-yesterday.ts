// scripts/seed-setoran-yesterday.ts
// Seeds one completed Setoran record for yesterday with an unpaid amount.
// This lets today's morning Setoran task show previousUnpaidAmount / carriedDeficit.

import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

import { db } from '@/lib/db';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  schedules,
  shifts,
  stores,
  users,
  setoranTasks,
  setoranMoneyStorage,
} from '@/lib/db/schema';

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

function money(n: number): string {
  return n.toFixed(2);
}

async function main() {
  const { db } = await import('../lib/db');
  const {
    schedules,
    setoranTasks,
    setoranMoneyStorage,
    shifts,
    stores,
    users,
  } = await import('../lib/db/schema');
  const now = new Date();
  const yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const nowTs = new Date();

  const shiftRows = await db
    .select({ id: shifts.id, code: shifts.code })
    .from(shifts);

  const morningShift = shiftRows.find((s) => s.code === 'morning');
  const fullDayShift = shiftRows.find((s) => s.code === 'full_day');

  if (!morningShift) throw new Error('Morning shift not found. Run seed-setup first.');

  let [schedule] = await db
    .select()
    .from(schedules)
    .where(and(
      gte(schedules.date, startOfDay(yesterday)),
      lte(schedules.date, endOfDay(yesterday)),
      inArray(schedules.shiftId, [morningShift.id, fullDayShift?.id ?? morningShift.id]),
      eq(schedules.isHoliday, false),
    ))
    .limit(1);

  if (!schedule) {
    const [store] = await db.select().from(stores).limit(1);
    const [user] = await db.select().from(users).limit(1);

    if (!store) throw new Error('No store found. Run seed-setup first.');
    if (!user) throw new Error('No user found. Run seed-setup first.');

    [schedule] = await db
      .insert(schedules)
      .values({
        userId: user.id,
        storeId: store.id,
        shiftId: morningShift.id,
        date: yesterday,
        isHoliday: false,
      } as typeof schedules.$inferInsert)
      .returning();

    console.log(`Created yesterday schedule #${schedule.id} for store #${store.id}.`);
  }

  await db
    .delete(setoranMoneyStorage)
    .where(and(
      eq(setoranMoneyStorage.storeId, schedule.storeId),
      eq(setoranMoneyStorage.date, yesterday),
    ));

  await db
    .delete(setoranTasks)
    .where(and(
      eq(setoranTasks.storeId, schedule.storeId),
      eq(setoranTasks.date, yesterday),
    ));

  const actualReceivedAmount = 1_000_000;
  const previousUnpaidAmount = 0;
  const requiredStoreAmount = actualReceivedAmount + previousUnpaidAmount;
  const storedAmount = 850_000;
  const unpaidAmount = requiredStoreAmount - storedAmount;

  const [task] = await db
    .insert(setoranTasks)
    .values({
      scheduleId: schedule.id,
      userId: schedule.userId,
      storeId: schedule.storeId,
      shiftId: morningShift.id,
      date: yesterday,
      expectedAmount: money(actualReceivedAmount),
      carriedDeficit: money(previousUnpaidAmount),
      carriedDeficitFetchedAt: nowTs,
      amount: money(storedAmount),
      unpaidAmount: money(unpaidAmount),
      resiPhoto: '/uploads/tasks/setoran/resi/seed-yesterday-resi.jpg',
      atmCardSelfiePhoto: '/uploads/tasks/setoran/atm-card-selfie/seed-yesterday-atm.jpg',
      notes: 'Seeded yesterday Setoran with unpaid carry-forward for testing.',
      status: 'completed',
      completedAt: nowTs,
      createdAt: nowTs,
      updatedAt: nowTs,
    })
    .returning();

  await db
    .insert(setoranMoneyStorage)
    .values({
      taskId: task.id,
      scheduleId: schedule.id,
      userId: schedule.userId,
      storeId: schedule.storeId,
      shiftId: morningShift.id,
      date: yesterday,
      actualReceivedAmount: money(actualReceivedAmount),
      previousUnpaidAmount: money(previousUnpaidAmount),
      requiredStoreAmount: money(requiredStoreAmount),
      storedAmount: money(storedAmount),
      unpaidAmount: money(unpaidAmount),
      resiPhoto: task.resiPhoto,
      atmCardSelfiePhoto: task.atmCardSelfiePhoto,
      notes: task.notes,
      createdAt: nowTs,
      updatedAt: nowTs,
    })
    .returning();

  console.log('✅ Seeded yesterday Setoran carry-forward test data');
  console.log(`   Date                  : ${yesterday.toISOString().slice(0, 10)}`);
  console.log(`   Store ID              : ${schedule.storeId}`);
  console.log(`   Schedule ID           : ${schedule.id}`);
  console.log(`   Actual received       : Rp ${actualReceivedAmount.toLocaleString('id-ID')}`);
  console.log(`   Stored                : Rp ${storedAmount.toLocaleString('id-ID')}`);
  console.log(`   Unpaid for next day   : Rp ${unpaidAmount.toLocaleString('id-ID')}`);
  console.log('\nOpen today\'s morning Setoran task for the same store to see the carry-forward.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

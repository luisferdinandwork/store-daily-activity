// scripts/seed-store-closing-sales-cash.ts
//
// Seeds YESTERDAY's Store Closing of the test store (DUMMY-001) with a Sales Cash
// amount, so today's morning Setoran can be tried: "Jumlah Sales Cash" starts from
// it and "Foto Jumlah Sales Cash" is asked.
//
//   npx tsx scripts/seed-store-closing-sales-cash.ts            # 2.350.000
//   npx tsx scripts/seed-store-closing-sales-cash.ts 4100000    # your own amount
//
// Also prints the state of today's Setoran (the prefill only shows while its
// "Jumlah Sales Cash" is still empty). Needs the IT switch `store_closing_update`
// on - it turns it on only if you pass --switch. Refuses to run against production.

import './lib/not-production';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  featureSwitches,
  setoranTasks,
  shifts,
  storeClosingEdcEntries,
  storeClosingTasks,
  stores,
  users,
} from '@/lib/db/schema';
import { addDaysKey, jakartaDayRange, jakartaTodayKey } from '@/lib/day-bucket';

const STORE_NO = 'DUMMY-001';

async function main() {
  const amountArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  const salesCash = amountArg ? Number(amountArg) : 2_350_000;
  const turnSwitchOn = process.argv.includes('--switch');

  const [store] = await db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.storeNo, STORE_NO)).limit(1);
  if (!store) throw new Error(`Store ${STORE_NO} not found.`);

  const [user] = await db.select({ id: users.id, nik: users.nik }).from(users).where(eq(users.homeStoreId, store.id)).limit(1);
  if (!user) throw new Error(`${STORE_NO} has no employee to attribute the closing to.`);

  const [evening] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, 'evening')).limit(1);
  if (!evening) throw new Error('Evening shift not found.');

  const today = jakartaTodayKey();
  const yesterday = addDaysKey(today, -1);
  const { start, end } = jakartaDayRange(yesterday);
  const now = new Date();

  const values = {
    userId: user.id,
    storeId: store.id,
    shiftId: evening.id,
    date: start,
    eodZReportDone: true,
    edcSettlementDone: true,
    edcSummaryDone: true,
    edcSummaryBy: user.id,
    edcSummaryAt: now,
    opMeVoucherAmount: '150000',
    salesCashAmount: String(salesCash),
    openStatementDecision: 'post_statement' as const,
    openStatementBy: user.id,
    openStatementAt: now,
    isOnHold: false,
    status: 'completed' as const,
    completedBy: user.id,
    completedAt: now,
    updatedAt: now,
  };

  const [existing] = await db
    .select({ id: storeClosingTasks.id })
    .from(storeClosingTasks)
    .where(and(eq(storeClosingTasks.storeId, store.id), gte(storeClosingTasks.date, start), lt(storeClosingTasks.date, end)))
    .limit(1);

  let taskId: number;
  if (existing) {
    await db.update(storeClosingTasks).set(values).where(eq(storeClosingTasks.id, existing.id));
    taskId = existing.id;
  } else {
    const [created] = await db.insert(storeClosingTasks).values({ ...values, createdAt: now }).returning({ id: storeClosingTasks.id });
    taskId = created.id;
  }

  const cells = [
    { bank: 'bca', method: 'qris', amount: '1200000' },
    { bank: 'bca', method: 'debit', amount: '800000' },
    { bank: 'mandiri', method: 'credit', amount: '500000' },
    { bank: 'indodana', method: 'total', amount: '350000' }, // one amount, no QRIS / Debit / Credit
  ];
  await db
    .insert(storeClosingEdcEntries)
    .values(cells.map((c) => ({ taskId, ...c, createdAt: now, updatedAt: now })))
    .onConflictDoUpdate({
      target: [storeClosingEdcEntries.taskId, storeClosingEdcEntries.bank, storeClosingEdcEntries.method],
      set: { amount: sql`excluded.amount`, updatedAt: now },
    });

  if (turnSwitchOn) {
    await db
      .insert(featureSwitches)
      .values({ key: 'store_closing_update', enabled: true })
      .onConflictDoUpdate({ target: featureSwitches.key, set: { enabled: true } });
  }
  const [sw] = await db.select({ enabled: featureSwitches.enabled }).from(featureSwitches).where(eq(featureSwitches.key, 'store_closing_update')).limit(1);

  const t = jakartaDayRange(today);
  const [setoran] = await db
    .select({ id: setoranTasks.id, status: setoranTasks.status, expected: setoranTasks.expectedAmount })
    .from(setoranTasks)
    .where(and(eq(setoranTasks.storeId, store.id), gte(setoranTasks.date, t.start), lt(setoranTasks.date, t.end)))
    .limit(1);

  console.log(`Closing ${yesterday} of ${STORE_NO} (${store.name}) ${existing ? 'updated' : 'created'}: Sales Cash Rp ${salesCash.toLocaleString('id-ID')}, Indodana Rp 350.000 (one amount).`);
  console.log(`Switch store_closing_update: ${sw?.enabled ? 'ON' : 'OFF - the Setoran shows no Sales Cash until it is on (re-run with --switch, or /it/feature-switches)'}`);
  if (!setoran) console.log("Today's Setoran: not created yet - opens fresh, Jumlah Sales Cash will be pre-filled.");
  else if (setoran.status === 'completed') console.log(`Today's Setoran #${setoran.id} is already COMPLETED - it cannot be redone; pick another day/store.`);
  else if (setoran.expected != null) console.log(`Today's Setoran #${setoran.id} already has a typed Jumlah Sales Cash (${setoran.expected}) - clear it to see the pre-fill.`);
  else console.log(`Today's Setoran #${setoran.id} is ${setoran.status} with nothing typed - the pre-fill will show.`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

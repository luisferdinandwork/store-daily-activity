// scripts/test-petty-cash-period-flow.ts
//
// End-to-end check of the petty cash period + refill flow against the REAL database logic
// (lib/db/utils/petty-cash-{period,refill,re-request,review}.ts) — DUMMY store only, staging only.
//
//   npx dotenv -e .env.local -- tsx scripts/test-petty-cash-period-flow.ts
//   npm run test:petty-cash-flow
//
// Safety: refuses production (scripts/lib/not-production.ts) and any store that is not DUMMY*. The store's own
// petty cash rows (periods, requests, refill requests, refills) are BACKED UP first, the scenario runs on a clean
// slate, and the backup is put back at the end — also when an assertion fails. petty_cash_* notifications the
// scenario created are removed again.
//
// The date is the thing under test, so the scenario walks across the 16th by passing a Jakarta day to the
// functions that take one (`getActivePeriod(storeId, day)`, `createRefillRequest(…, day)`, `getRefillOverview(…, day)`).
// M is the period of TODAY (16th → 15th, named after the month it ends in), N the one after, P the one after that.
//
// Rules under test:
//   • THE CALENDAR changes the period, on the 16th — sending / approving / verifying / receiving a refill closes
//     nothing and moves no request; on the 16th the store moves on and waiting requests go with it;
//   • a refill settles the OLDEST used period without a refill: on or before the 15th the period in use, after the
//     15th the period that has just ended (late) while it is still waiting, then the new one;
//   • the spendable balance is the cash really in the box: the period's balance, minus the previous period's refill
//     until it is received (even before it is asked for), plus its own refill once received while it still runs;
//   • usage booked after Finance froze a refill's amount carries into the next period;
//   • a Re-request is counted in the NEXT period, may change the category, and is checked against that period;
//   • Finance can still decide on a period until its refill is verified (then it is locked), and the next period
//     stays open to Finance.

import './lib/not-production';

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';

import { db } from '@/lib/db';
import { describeTarget } from './lib/db-target';
import { pettyCashPeriods, pettyCashRefillRequests, pettyCashTransactions } from '@/lib/db/schema';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { addMonths, usagePeriodFor } from '@/lib/petty-cash-period';
import { adjustPeriodBalance, getActivePeriod, getPeriod } from '@/lib/db/utils/petty-cash-period';
import {
  approveRefillRequest,
  attachRefillProof,
  createRefillRequest,
  getLiveRefillRequest,
  getRefillOutstanding,
  getRefillOverview,
  getRefillReceivedWithin,
  getSpendable,
  verifyRefillRequests,
} from '@/lib/db/utils/petty-cash-refill';
import { createReRequest } from '@/lib/db/utils/petty-cash-re-request';
import { financeAcceptTransaction, financeRejectTransaction, financeUserIds } from '@/lib/db/utils/petty-cash-review';
import { listPettyCashCategories } from '@/lib/db/utils/petty-cash-categories';
import { eq } from 'drizzle-orm';

const STORE_NO = 'DUMMY-001';
const TABLES = ['petty_cash_periods', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_transactions'] as const;
const MAX = 1_000_000;
const BANK = { bankName: 'BCA', accountNumber: '1234567890', accountHolderName: 'TEST DUMMY' };

let checks = 0;
const step = (title: string) => console.log(`\n${title}`);
const ok = (name: string) => {
  checks += 1;
  console.log(`  ✓ ${name}`);
};
const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) die('DATABASE_URL is not set.');
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });

  const dbName = (await pool.query('select current_database() d')).rows[0].d as string;
  console.log(`database : ${describeTarget(url as string)}  (current_database = ${dbName})`);

  const store = (await pool.query('select id, store_no, name, status from stores where store_no = $1', [STORE_NO])).rows[0];
  if (!store) die(`Store ${STORE_NO} not found.`);
  if (!/^DUMMY/i.test(store.store_no)) die('Refusing: not a DUMMY store.');
  if (store.status !== 'active') die(`${STORE_NO} is ${store.status}, petty cash needs an active store.`);
  const storeId = store.id as number;
  console.log(`store    : ${store.store_no} — ${store.name} (id ${storeId})`);

  // Who acts: any user of the store (PIC), an ops user, a finance user.
  const picId = (await pool.query('select id from users where home_store_id = $1 and deleted_at is null limit 1', [storeId])).rows[0]?.id as string | undefined;
  if (!picId) die(`${STORE_NO} has no user to act as PIC 1.`);
  const opsId = (
    await pool.query(`select u.id from users u join user_roles r on r.id = u.role_id where r.code in ('ops','it') and u.is_active limit 1`)
  ).rows[0]?.id as string | undefined;
  const financeId = (await financeUserIds())[0] ?? picId;
  const pic = picId as string;
  const ops = opsId ?? pic;

  // ── Backup ──────────────────────────────────────────────────────────────────
  const backup: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    backup[t] = (await pool.query(`select row_to_json(t) r from ${t} t where store_id = $1 order by id`, [storeId])).rows.map((r) => r.r);
  }
  const backupFile = join(tmpdir(), `petty-cash-${STORE_NO}-backup-${Date.now()}.json`);
  writeFileSync(backupFile, JSON.stringify(backup));
  console.log(`backup   : ${TABLES.map((t) => `${t.replace('petty_cash_', '')}=${backup[t].length}`).join(' ')}  → ${backupFile}`);
  const lastNotif = Number((await pool.query('select coalesce(max(id), 0) m from notifications')).rows[0].m);

  const wipe = async () => {
    await pool.query('delete from petty_cash_transactions where store_id = $1', [storeId]);
    await pool.query('delete from petty_cash_refill_requests where store_id = $1', [storeId]);
    await pool.query('delete from petty_cash_refills where store_id = $1', [storeId]);
    await pool.query('delete from petty_cash_periods where store_id = $1', [storeId]);
  };

  try {
    await wipe();

    const today = jakartaTodayKey();
    const M = usagePeriodFor(today); // the period of today
    const N = addMonths(M, 1);
    const P = addMonths(M, 2);
    const D16 = `${M}-16`; // the day the calendar moves M → N
    const D16b = `${N}-16`; // …and N → P
    const balanceOf = async (ym: string) => Number((await getPeriod(storeId, ym))!.currentBalance);
    const statusOf = async (ym: string) => (await getPeriod(storeId, ym))?.status ?? null;
    const spendableOf = async (ym: string) => (await getSpendable(storeId, (await getPeriod(storeId, ym))!)).spendable;
    const categories = await listPettyCashCategories({ activeOnly: true });
    assert.ok(categories.length >= 1, 'needs at least one active category');
    const catA = categories[0];
    const catB = categories[1] ?? categories[0];

    // ── 1. A period in use with some spending ─────────────────────────────────
    step(`1. Period ${M} in use`);
    const period = await getActivePeriod(storeId);
    assert.equal(period.yearMonth, M);
    assert.equal(period.status, 'open');
    assert.equal(Number(period.currentBalance), MAX);
    ok(`today (${today}) is in period ${M}; it opens at Rp ${MAX.toLocaleString('id-ID')}`);

    const now = new Date();
    const mk = async (status: string, amount: number, extra: Record<string, unknown> = {}, p = period) => {
      const [row] = await db
        .insert(pettyCashTransactions)
        .values({
          periodId: p.id,
          userId: pic,
          storeId,
          amount: amount.toFixed(2),
          actualAmount: status === 'completed' ? amount.toFixed(2) : null,
          description: `SCENARIO ${status} ${amount}`,
          categoryId: catA.id,
          categoryName: catA.name,
          status,
          imageUrl: status === 'completed' || status === 'ops_approved' ? 'https://example.test/receipt.jpg' : null,
          yearMonth: p.yearMonth,
          createdAt: now,
          updatedAt: now,
          ...extra,
        })
        .returning();
      return row;
    };
    /** What PIC 1 confirming a spend does to the period's balance. */
    const spend = async (ym: string, amount: number) =>
      db
        .update(pettyCashPeriods)
        .set({ currentBalance: String((await balanceOf(ym)) - amount) })
        .where(eq(pettyCashPeriods.id, (await getPeriod(storeId, ym))!.id));

    const A = await mk('completed', 100_000);
    const B = await mk('completed', 50_000);
    const C = await mk('pending_ops', 30_000);
    const D = await mk('ops_approved', 20_000);
    await spend(M, 150_000);
    assert.equal(await balanceOf(M), 850_000);
    ok('A 100k + B 50k completed, C waiting on OPS, D OPS-approved → balance 850.000');

    // Finance sends B back (Perlu Perbaikan): it gives its amount back to the period.
    const needsFix = await financeRejectTransaction({ txId: B.id, actorId: financeId, kind: 'needs_fix', comment: 'foto kurang jelas' });
    assert.equal(needsFix.success, true);
    assert.equal(await balanceOf(M), 900_000);
    ok('B → Perlu Perbaikan gives 50k back → balance 900.000');

    // ── 2. Overview before sending ────────────────────────────────────────────
    step('2. Refill overview before sending (on or before the 15th)');
    const before = await getRefillOverview(storeId);
    assert.equal(before.usageMonth, M);
    assert.equal(before.settle?.month, M);
    assert.equal(before.settle?.balance, 900_000);
    assert.equal(before.settle?.refill, 100_000);
    assert.equal(before.settle?.closed, false);
    assert.equal(before.deadline?.late, false);
    assert.equal(before.canRequest, true);
    assert.equal(await getRefillOutstanding(storeId, M), 0);
    ok('settles the period in use, refill = max − balance = 100.000, not late, nothing outstanding');

    // ── 3. Send the refill — nothing closes ───────────────────────────────────
    step('3. PIC 1 sends the refill');
    const sent = await createRefillRequest(storeId, pic, BANK);
    assert.equal(sent.success, true);
    if (!sent.success) return;
    assert.equal(sent.periodMonth, M);
    assert.equal(sent.usageMonth, M);
    assert.equal(sent.late, false);
    assert.equal(sent.request.yearMonth, M);
    ok(`refill is for period ${M}, on time, and ${M} is still the period in use`);

    assert.equal(await statusOf(M), 'open');
    assert.equal(await getPeriod(storeId, N), null);
    assert.equal((await getActivePeriod(storeId)).yearMonth, M);
    ok(`sending it did NOT close ${M} or open ${N} — new requests still land in ${M}`);

    const [stillC] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, C.id));
    const [stillD] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, D.id));
    assert.equal(stillC.yearMonth, M);
    assert.equal(stillD.yearMonth, M);
    ok('C (OPS) and D (approved) did not move');

    const again = await createRefillRequest(storeId, pic, BANK);
    assert.equal(again.success, false);
    const busy = await getRefillOverview(storeId);
    assert.equal(busy.canRequest, false);
    assert.equal(busy.settle, null);
    ok('a second refill while one is on its way is refused');

    // ── 4. Re-request ─────────────────────────────────────────────────────────
    step(`4. Re-request of the Perlu Perbaikan request (counted in ${N})`);
    const re = await createReRequest({
      originalTxId: B.id,
      storeId,
      userId: pic,
      requestDate: today,
      description: 'perbaikan struk',
      actualAmount: 50_000,
      categoryId: catB.id,
      imageUrl: 'https://example.test/new-receipt.jpg',
      imageKey: 'new-receipt',
    });
    assert.equal(re.success, true);
    if (!re.success) return;
    assert.equal(re.periodMonth, N);
    assert.equal(re.newBalance, 850_000);
    assert.equal(await balanceOf(N), 950_000);
    assert.equal(await statusOf(N), 'upcoming');
    assert.equal(await balanceOf(M), 900_000);
    ok(`counted in the next period ${N} (made ahead, still 'upcoming'), cut from its balance (spendable 900.000 → 850.000)`);

    const [reRow] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, re.txId));
    assert.equal(reRow.isReRequest, true);
    assert.equal(reRow.status, 'completed');
    assert.equal(reRow.yearMonth, N);
    assert.equal(reRow.categoryId, catB.id);
    assert.equal(reRow.imageUrl, 'https://example.test/new-receipt.jpg');
    ok('inserted as completed, new category + new receipt photo kept');

    assert.equal((await createReRequest({ originalTxId: B.id, storeId, userId: pic, requestDate: today, description: 'x', actualAmount: 1000 })).success, false);
    ok('a request can be re-requested only once');
    assert.equal((await createReRequest({ originalTxId: A.id, storeId, userId: pic, requestDate: today, description: 'x', actualAmount: 1000 })).success, false);
    ok('a request that is not Perlu Perbaikan can not be re-requested');

    const E = await mk('completed', 10_000, { financeReview: 'needs_fix', financeComment: 'x' });
    const tooBig = await createReRequest({ originalTxId: E.id, storeId, userId: pic, requestDate: today, description: 'besar', actualAmount: 900_000 });
    assert.equal(tooBig.success, false);
    ok('a re-request above the spendable balance (850.000) is refused');

    // ── 5. Finance on the period, before verification ─────────────────────────
    step('5. Finance review while the refill is not verified yet');
    const rejectA = await financeRejectTransaction({ txId: A.id, actorId: financeId, kind: 'rejected' });
    assert.equal(rejectA.success, true);
    assert.equal(await balanceOf(M), MAX); // 900k + A 100k, clamped at max
    assert.equal(await getRefillOutstanding(storeId, N), 0);
    ok('rejecting A gives 100k back → the refill owed drops to 0');
    assert.equal((await financeAcceptTransaction({ txId: A.id, actorId: financeId })).success, true);
    assert.equal(await balanceOf(M), 900_000);
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    ok('accepting it again takes it back');

    // ── 6. OPS approves, Finance verifies → period locked for Finance ─────────
    step('6. OPS approves, Finance verifies');
    assert.equal((await approveRefillRequest(sent.request.id, ops)).success, true);
    const verified = await verifyRefillRequests([sent.request.id], financeId);
    assert.deepEqual(verified.changedIds, [sent.request.id]);
    const [frozen] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, sent.request.id));
    assert.ok(frozen.transferAmount != null, 'verify freezes the transfer');
    assert.equal(Math.round(Number(frozen.transferAmount)), 100_000);
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    assert.equal(await statusOf(M), 'open');
    ok(`transfer frozen at 100.000, still owed to the store, and ${M} is still open`);

    const lockedA = await financeRejectTransaction({ txId: A.id, actorId: financeId, kind: 'rejected' });
    assert.equal(lockedA.success, false);
    ok('a request of the verified period is locked for Finance');

    // ── 7. Spending after the amount was frozen ───────────────────────────────
    step(`7. PIC 1 keeps spending in ${M} after Finance froze the transfer`);
    await mk('completed', 40_000);
    await spend(M, 40_000);
    assert.equal(await balanceOf(M), 860_000);
    assert.equal((await getActivePeriod(storeId)).yearMonth, M);
    ok('F 40k is booked in the period still in use → balance 860.000 (the transfer stays 100.000)');

    // ── 8. Receipt — while the period is still running ────────────────────────
    step('8. PIC 1 uploads the proof photos');
    const drawer = await attachRefillProof(sent.request.id, storeId, pic, 'drawer', 'https://example.test/drawer.jpg');
    assert.equal(drawer.success, true);
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    assert.ok(await getLiveRefillRequest(storeId));
    ok('one photo is not enough — still on its way, still owed');

    const signed = await attachRefillProof(sent.request.id, storeId, pic, 'signature', 'https://example.test/signature.jpg');
    assert.equal(signed.success, true);
    assert.equal(await getRefillOutstanding(storeId, N), 0);
    assert.equal(await getLiveRefillRequest(storeId), null);
    ok('both photos in → received, nothing owed any more');

    assert.equal(await statusOf(M), 'open');
    assert.equal(await statusOf(N), 'upcoming');
    assert.equal(await balanceOf(M), 860_000);
    ok('receiving changed no period and did not touch the balance');

    assert.equal(await getRefillReceivedWithin(storeId, M), 100_000);
    assert.equal(await spendableOf(M), 960_000);
    ok('but the cash is in the box: spendable in the running period = 860.000 + the 100.000 that arrived = 960.000');

    // ── 9. The 16th ───────────────────────────────────────────────────────────
    step(`9. The calendar moves on (${D16})`);
    const rolled = await getActivePeriod(storeId, D16);
    assert.equal(rolled.yearMonth, N);
    assert.equal(await statusOf(M), 'closed');
    assert.equal(await statusOf(N), 'open');
    ok(`${M} closed by itself, ${N} (made ahead for the Re-request) is open now`);

    assert.equal(await balanceOf(M), 860_000);
    assert.equal(await balanceOf(N), 910_000);
    ok('F (40k, spent after the transfer was frozen) is carried into the new period: 950.000 − 40.000 = 910.000');

    const [movedC] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, C.id));
    const [movedD] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, D.id));
    const [keptA] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, A.id));
    assert.equal(movedC.yearMonth, N);
    assert.equal(movedD.yearMonth, N);
    assert.equal(movedC.periodId, rolled.id);
    assert.equal(keptA.yearMonth, M);
    ok('C (OPS) and D (approved) moved to the new period; completed A stays');

    await getActivePeriod(storeId, D16);
    assert.equal(await balanceOf(N), 910_000);
    assert.equal((await getActivePeriod(storeId)).yearMonth, N);
    ok('rolling again changes nothing, and a call with today\'s date never moves the store backwards');

    assert.equal(await spendableOf(N), 910_000);
    ok('spendable now = 910.000: the box holds exactly what the books say');

    assert.equal(await adjustPeriodBalance(db, period.id, 50_000), false);
    ok(`the ended, verified period ${M} no longer moves`);

    const nextPeriodOk = await financeRejectTransaction({ txId: re.txId, actorId: financeId, kind: 'needs_fix' });
    assert.equal(nextPeriodOk.success, true);
    assert.equal((await financeAcceptTransaction({ txId: re.txId, actorId: financeId })).success, true);
    assert.equal(await balanceOf(N), 910_000);
    ok('the re-request (new period) is still open to Finance');

    // ── 10. After the 15th, the previous period is settled → the new one ──────
    step('10. After the 15th, with the previous period settled');
    const afterSettled = await getRefillOverview(storeId, D16);
    assert.equal(afterSettled.usageMonth, N);
    assert.equal(afterSettled.settle?.month, N);
    assert.equal(afterSettled.settle?.refill, 90_000);
    assert.equal(afterSettled.settle?.closed, false);
    assert.equal(afterSettled.deadline?.late, false);
    assert.equal(afterSettled.canRequest, true);
    ok(`a refill now covers ${N} (90.000), not late — ${M} already has its refill`);

    // ── 11. A refill sent after the 15th for the period that just ended ───────
    step(`11. Nobody asks for ${N}'s refill — the 16th passes`);
    await spend(N, 100_000);
    await mk('completed', 100_000, {}, (await getPeriod(storeId, N))!);
    assert.equal(await balanceOf(N), 810_000);

    const nextPeriod = await getActivePeriod(storeId, D16b);
    assert.equal(nextPeriod.yearMonth, P);
    assert.equal(await statusOf(N), 'closed');
    assert.equal(await statusOf(P), 'open');
    assert.equal(await balanceOf(P), MAX);
    ok(`${N} closed with 810.000 left, ${P} opened at 1.000.000 — no refill was needed to do that`);

    assert.equal(await getRefillOutstanding(storeId, P), 190_000);
    assert.equal(await spendableOf(P), 810_000);
    ok('even though nobody asked for it, the 190.000 is owed: spendable in the new period = 810.000, what is really in the box');

    const lateView = await getRefillOverview(storeId, D16b);
    assert.equal(lateView.usageMonth, P);
    assert.equal(lateView.settle?.month, N);
    assert.equal(lateView.settle?.refill, 190_000);
    assert.equal(lateView.settle?.closed, true);
    assert.equal(lateView.deadline?.late, true);
    ok(`sent now, the refill is for ${N} (the period that just ended, 190.000), flagged late`);

    const late = await createRefillRequest(storeId, pic, BANK, undefined, D16b);
    assert.equal(late.success, true);
    if (!late.success) return;
    assert.equal(late.periodMonth, N);
    assert.equal(late.usageMonth, P);
    assert.equal(late.late, true);
    assert.equal(late.request.yearMonth, N);
    assert.equal(await statusOf(P), 'open');
    assert.equal(await balanceOf(P), MAX);
    ok(`the late refill is recorded against ${N}; ${P} is untouched`);

    assert.equal((await createRefillRequest(storeId, pic, BANK, undefined, D16b)).success, false);
    ok('and while it is on its way the next one has to wait');

    assert.equal((await approveRefillRequest(late.request.id, ops)).success, true);
    assert.deepEqual((await verifyRefillRequests([late.request.id], financeId)).changedIds, [late.request.id]);
    await attachRefillProof(late.request.id, storeId, pic, 'drawer', 'https://example.test/drawer2.jpg');
    await attachRefillProof(late.request.id, storeId, pic, 'signature', 'https://example.test/signature2.jpg');
    assert.equal(await getRefillOutstanding(storeId, P), 0);
    assert.equal(await spendableOf(P), MAX);
    ok(`received → nothing owed, ${P} spendable is back to 1.000.000`);

    const nothing = await getRefillOverview(storeId, D16b);
    assert.equal(nothing.settle, null);
    assert.equal(nothing.canRequest, false);
    ok(`nothing to refill now: ${N} is settled and ${P} has no usage yet`);

    // ── 12. And the new period on its own ─────────────────────────────────────
    step(`12. Usage in ${P}, previous period settled`);
    await mk('completed', 60_000, {}, (await getPeriod(storeId, P))!);
    await spend(P, 60_000);
    const cur = await getRefillOverview(storeId, D16b);
    assert.equal(cur.settle?.month, P);
    assert.equal(cur.settle?.refill, 60_000);
    assert.equal(cur.settle?.closed, false);
    assert.equal(cur.deadline?.late, false);
    assert.equal(cur.canRequest, true);
    ok(`the refill now covers the period in use ${P} (60.000), not late — its 15th is still ahead`);

    console.log(`\n${checks} checks passed`);
  } finally {
    // ── Restore ───────────────────────────────────────────────────────────────
    try {
      await wipe();
      for (const t of ['petty_cash_periods', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_transactions'] as const) {
        if (backup[t].length === 0) continue;
        await pool.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(backup[t])]);
      }
      const gone = await pool.query(
        `delete from notifications where id > $1 and type like 'petty\\_cash\\_%' escape '\\'`,
        [lastNotif],
      );
      console.log(`\nrestored : ${STORE_NO} petty cash back to its backup (${TABLES.map((t) => `${t.replace('petty_cash_', '')}=${backup[t].length}`).join(' ')}); ${gone.rowCount} scenario notifications removed`);
    } catch (e) {
      console.error(`\n⚠️  RESTORE FAILED — the backup is in ${backupFile}\n`, e);
      process.exitCode = 1;
    }
    await pool.end().catch(() => undefined);
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

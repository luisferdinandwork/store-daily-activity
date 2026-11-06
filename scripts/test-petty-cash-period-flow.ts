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
// Rules under test:
//   • sending the refill closes the period, opens the next at once, and moves waiting requests to it;
//   • the spendable balance does NOT jump back to Rp 1.000.000 — it keeps the refill-not-received-yet out until
//     both proof photos are in;
//   • a Re-request is counted in the NEXT period, may change the category, and is checked against that period;
//   • Finance can still decide on a closed period until its refill is verified (then it is locked), and the next
//     period stays open to Finance.

import './lib/not-production';

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';

import { db } from '@/lib/db';
import { describeTarget } from './lib/db-target';
import { pettyCashPeriods, pettyCashRefillRequests, pettyCashTransactions } from '@/lib/db/schema';
import { jakartaYearMonth } from '@/lib/day-bucket';
import { addMonths } from '@/lib/petty-cash-period';
import { adjustPeriodBalance, getActivePeriod, getPeriod } from '@/lib/db/utils/petty-cash-period';
import {
  approveRefillRequest,
  attachRefillProof,
  createRefillRequest,
  getLiveRefillRequest,
  getRefillOutstanding,
  getRefillOverview,
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

    const M = jakartaYearMonth(Date.now());
    const N = addMonths(M, 1);
    const balanceOf = async (ym: string) => Number((await getPeriod(storeId, ym))!.currentBalance);
    const categories = await listPettyCashCategories({ activeOnly: true });
    assert.ok(categories.length >= 1, 'needs at least one active category');
    const catA = categories[0];
    const catB = categories[1] ?? categories[0];

    // ── 1. A period in use with some spending ─────────────────────────────────
    step(`1. Period ${M} in use`);
    const period = await getActivePeriod(storeId, M);
    assert.equal(period.yearMonth, M);
    assert.equal(Number(period.currentBalance), MAX);
    ok(`opens at Rp ${MAX.toLocaleString('id-ID')}`);

    const now = new Date();
    const mk = async (status: string, amount: number, extra: Record<string, unknown> = {}) => {
      const [row] = await db
        .insert(pettyCashTransactions)
        .values({
          periodId: period.id,
          userId: pic,
          storeId,
          amount: amount.toFixed(2),
          actualAmount: status === 'completed' ? amount.toFixed(2) : null,
          description: `SCENARIO ${status} ${amount}`,
          categoryId: catA.id,
          categoryName: catA.name,
          status,
          imageUrl: status === 'completed' || status === 'ops_approved' ? 'https://example.test/receipt.jpg' : null,
          yearMonth: M,
          createdAt: now,
          updatedAt: now,
          ...extra,
        })
        .returning();
      return row;
    };
    const A = await mk('completed', 100_000);
    const B = await mk('completed', 50_000);
    const C = await mk('pending_ops', 30_000);
    const D = await mk('ops_approved', 20_000);
    await db.update(pettyCashPeriods).set({ currentBalance: String(MAX - 150_000) }).where(eq(pettyCashPeriods.id, period.id));
    assert.equal(await balanceOf(M), 850_000);
    ok('A 100k + B 50k completed, C waiting on OPS, D OPS-approved → balance 850.000');

    // Finance sends B back (Perlu Perbaikan): it gives its amount back to the period.
    const needsFix = await financeRejectTransaction({ txId: B.id, actorId: financeId, kind: 'needs_fix', comment: 'foto kurang jelas' });
    assert.equal(needsFix.success, true);
    assert.equal(await balanceOf(M), 900_000);
    ok('B → Perlu Perbaikan gives 50k back → balance 900.000');

    // ── 2. Overview before sending ────────────────────────────────────────────
    step('2. Refill overview before sending');
    const before = await getRefillOverview(storeId);
    assert.equal(before.usageMonth, M);
    assert.equal(before.settle?.month, M);
    assert.equal(before.settle?.balance, 900_000);
    assert.equal(before.settle?.refill, 100_000);
    assert.equal(before.canRequest, true);
    assert.equal(await getRefillOutstanding(storeId, M), 0);
    ok('settles this period, refill = max − balance = 100.000, nothing outstanding');

    // ── 3. Send the refill ────────────────────────────────────────────────────
    step('3. PIC 1 sends the refill');
    const sent = await createRefillRequest(storeId, pic, BANK);
    assert.equal(sent.success, true);
    if (!sent.success) return;
    assert.equal(sent.periodMonth, M);
    assert.equal(sent.nextMonth, N);
    assert.equal(sent.moved, 2);
    assert.equal(sent.request.yearMonth, M);
    ok(`refill is for period ${M}, next period is ${N}, 2 waiting requests moved`);

    assert.equal((await getPeriod(storeId, M))!.status, 'closed');
    assert.equal((await getPeriod(storeId, N))!.status, 'open');
    assert.equal(await balanceOf(N), MAX);
    ok(`${M} is closed, ${N} is open`);

    const [movedC] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, C.id));
    const [movedD] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, D.id));
    const [keptA] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, A.id));
    assert.equal(movedC.yearMonth, N);
    assert.equal(movedD.yearMonth, N);
    assert.equal(keptA.yearMonth, M);
    ok('C (OPS) and D (approved) moved to the next period; completed A stays');

    assert.equal((await getActivePeriod(storeId, M)).yearMonth, N);
    ok('new requests now land in the next period');

    const again = await createRefillRequest(storeId, pic, BANK);
    assert.equal(again.success, false);
    ok('a second refill while one is on its way is refused');

    // ── 4. The balance does not turn back to 1 million ────────────────────────
    step('4. Balance stays at what is in the box until the refill is received');
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    const spendable = Math.max(0, (await balanceOf(N)) - (await getRefillOutstanding(storeId, N)));
    assert.equal(spendable, 900_000);
    ok('next period is Rp 1.000.000 on paper but only 900.000 is spendable (100.000 refill not received)');

    // ── 5. Re-request ─────────────────────────────────────────────────────────
    step('5. Re-request of the Perlu Perbaikan request');
    const re = await createReRequest({
      originalTxId: B.id,
      storeId,
      userId: pic,
      requestDate: M === jakartaYearMonth(Date.now()) ? new Date().toISOString().slice(0, 10) : `${M}-01`,
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
    ok(`counted in the next period ${N}, cut from its balance (spendable 900.000 → 850.000)`);

    const [reRow] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, re.txId));
    assert.equal(reRow.isReRequest, true);
    assert.equal(reRow.status, 'completed');
    assert.equal(reRow.yearMonth, N);
    assert.equal(reRow.categoryId, catB.id);
    assert.equal(reRow.imageUrl, 'https://example.test/new-receipt.jpg');
    ok('inserted as completed, new category + new receipt photo kept');

    assert.equal((await createReRequest({ originalTxId: B.id, storeId, userId: pic, requestDate: new Date().toISOString().slice(0, 10), description: 'x', actualAmount: 1000 })).success, false);
    ok('a request can be re-requested only once');
    assert.equal((await createReRequest({ originalTxId: A.id, storeId, userId: pic, requestDate: new Date().toISOString().slice(0, 10), description: 'x', actualAmount: 1000 })).success, false);
    ok('a request that is not Perlu Perbaikan can not be re-requested');

    // E: another Perlu Perbaikan request in the closed period — a re-request bigger than the spendable balance fails.
    const E = await mk('completed', 10_000, { financeReview: 'needs_fix', financeComment: 'x' });
    const tooBig = await createReRequest({ originalTxId: E.id, storeId, userId: pic, requestDate: new Date().toISOString().slice(0, 10), description: 'besar', actualAmount: 900_000 });
    assert.equal(tooBig.success, false);
    ok('a re-request above the spendable balance (850.000) is refused');

    // ── 6. Finance on the closed period, before verification ──────────────────
    step('6. Finance review while the refill is not verified yet');
    const rejectA = await financeRejectTransaction({ txId: A.id, actorId: financeId, kind: 'rejected' });
    assert.equal(rejectA.success, true);
    assert.equal(await balanceOf(M), MAX - 0); // 900k + A 100k, clamped at max
    assert.equal(await getRefillOutstanding(storeId, N), 0);
    ok('rejecting A gives 100k back to the CLOSED period → the refill owed drops to 0');
    assert.equal((await financeAcceptTransaction({ txId: A.id, actorId: financeId })).success, true);
    assert.equal(await balanceOf(M), 900_000);
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    ok('accepting it again takes it back');

    // ── 7. OPS approves, Finance verifies → period locked ─────────────────────
    step('7. OPS approves, Finance verifies');
    assert.equal((await approveRefillRequest(sent.request.id, ops)).success, true);
    const verified = await verifyRefillRequests([sent.request.id], financeId);
    assert.deepEqual(verified.changedIds, [sent.request.id]);
    const [frozen] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, sent.request.id));
    assert.ok(frozen.transferAmount != null, 'verify freezes the transfer');
    assert.equal(Math.round(Number(frozen.transferAmount)), 100_000);
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    ok('transfer frozen at 100.000, still owed to the store');

    const lockedA = await financeRejectTransaction({ txId: A.id, actorId: financeId, kind: 'rejected' });
    assert.equal(lockedA.success, false);
    ok('a request of the verified period is locked for Finance');
    assert.equal(await adjustPeriodBalance(db, period.id, 50_000), false);
    ok('the verified period balance no longer moves');

    const nextPeriodOk = await financeRejectTransaction({ txId: re.txId, actorId: financeId, kind: 'needs_fix' });
    assert.equal(nextPeriodOk.success, true);
    assert.equal((await financeAcceptTransaction({ txId: re.txId, actorId: financeId })).success, true);
    assert.equal(await balanceOf(N), 950_000);
    ok('the re-request (next period) is still open to Finance');

    // ── 8. Receipt ────────────────────────────────────────────────────────────
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

    assert.equal(await balanceOf(N), 950_000);
    ok('the next period was NOT reset to Rp 1.000.000 — it keeps what was spent in the meantime (950.000)');

    const after = await getRefillOverview(storeId);
    assert.equal(after.settle?.month, N);
    assert.equal(after.settle?.refill, 50_000);
    assert.equal(after.canRequest, true);
    ok(`the next refill settles ${N} (50.000) and can be sent`);

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

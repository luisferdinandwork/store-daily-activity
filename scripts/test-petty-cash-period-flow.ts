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
//   • the period changes on the 16th (the calendar) — or EARLIER, the moment the refill of the period in use is SENT:
//     that ends it, the store moves on and waiting requests + drafts go with it; approving / verifying / receiving
//     a refill changes no period; a period's refill can't be sent before the period has started (never 2 ahead);
//   • a refill can't be verified while a request of its period is still not decided (e.g. Pending Finance);
//   • a refill settles the OLDEST used period without a refill: on or before the 15th the period in use, after the
//     15th the period that has just ended (late) while it is still waiting, then the new one;
//   • the spendable balance is the cash really in the box: the period's balance, minus the previous period's refill
//     until it is received (even before it is asked for), plus its own refill once received while it still runs;
//   • usage booked after Finance froze a refill's amount carries into the next period;
//   • Perlu Perbaikan sends the SAME request back to PIC 1 as a draft: it stays in its period while that is still
//     running and no refill was asked for it, otherwise it moves to the NEXT period; PIC 1 fixes it (may change the
//     category), OPS approves it again and it is completed — cut from that period — and Pending Finance again;
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
import { adjustPeriodBalance, getActivePeriod, getPeriod, latestRefilledMonth } from '@/lib/db/utils/petty-cash-period';
import { visibleReviewOutcome } from '@/lib/petty-cash-review';
import {
  approveRefillRequest,
  attachRefillProof,
  createRefillRequest,
  getLiveRefillRequest,
  getRefillOutstanding,
  getRefillOverview,
  getSpendable,
  refillRequiredBeforeRequest,
  verifyRefillRequests,
} from '@/lib/db/utils/petty-cash-refill';
import { approveFixedRequest, resubmitFixedRequest } from '@/lib/db/utils/petty-cash-re-request';
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
  // A dropped idle connection must not kill the process before the backup is put back (it once left DUMMY-001
  // half-reset with a session holding its rows locked).
  pool.on('error', (e) => console.warn(`  (pool connection dropped: ${e.message})`));

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

    // Finance sends B back (Perlu Perbaikan): it gives its amount back to the period and goes back to PIC 1 as a
    // draft — in the SAME period, which is still running and has no refill asked for yet.
    const needsFix = await financeRejectTransaction({ txId: B.id, actorId: financeId, kind: 'needs_fix', comment: 'foto kurang jelas' });
    assert.equal(needsFix.success, true);
    assert.equal(needsFix.success && needsFix.periodMonth, M);
    assert.equal(await balanceOf(M), 900_000);
    const [draftB] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, B.id));
    assert.equal(draftB.status, 'draft');
    assert.equal(draftB.isReRequest, true);
    assert.equal(draftB.yearMonth, M);
    ok('B → Perlu Perbaikan: the same request is a draft again, still in period M, 50k back → balance 900.000');

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

    // ── 3. Send the refill — it ENDS the period at once ──────────────────────
    step(`3. PIC 1 sends ${M}'s refill → ${M} ends now, ${N} opens`);
    const sent = await createRefillRequest(storeId, pic, BANK);
    assert.equal(sent.success, true);
    if (!sent.success) return;
    assert.equal(sent.periodMonth, M);
    assert.equal(sent.usageMonth, N);
    assert.equal(sent.late, false);
    assert.equal(sent.request.yearMonth, M);
    ok(`refill is for period ${M}, on time, and the period in use is ${N} straight away`);

    assert.equal(await statusOf(M), 'closed');
    assert.equal(await statusOf(N), 'open');
    assert.equal(await balanceOf(N), MAX);
    assert.equal((await getActivePeriod(storeId)).yearMonth, N);
    ok(`sending it closed ${M} and opened ${N} (before the 16th) — new requests land in ${N}`);

    const [movedC] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, C.id));
    const [movedD] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, D.id));
    const [movedB] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, B.id));
    const nPeriod = (await getPeriod(storeId, N))!;
    assert.equal(movedC.yearMonth, N);
    assert.equal(movedC.periodId, nPeriod.id);
    assert.equal(movedD.yearMonth, N);
    assert.equal(movedB.status, 'draft');
    assert.equal(movedB.yearMonth, N);
    ok(`C (OPS), D (approved) and the draft B (being fixed) moved to ${N} with it; completed A stays in ${M}`);

    assert.equal(await spendableOf(N), 900_000);
    ok(`spendable in ${N} = 1.000.000 − the 100.000 refill of ${M} still on its way = 900.000 (what is in the box)`);

    const again = await createRefillRequest(storeId, pic, BANK);
    assert.equal(again.success, false);
    const busy = await getRefillOverview(storeId);
    assert.equal(busy.canRequest, false);
    assert.equal(busy.settle, null);
    ok('a second refill while one is on its way is refused');

    // ── 4. Perlu Perbaikan of an M request after the refill was sent → N ──────
    step(`4. Perlu Perbaikan of an ${M} request after its refill was sent (moves to ${N}), fixed, approved by OPS again`);
    const fixed = await mk('completed', 50_000);
    await spend(M, 50_000);
    assert.equal(await balanceOf(M), 850_000);
    const sentBack = await financeRejectTransaction({ txId: fixed.id, actorId: financeId, kind: 'needs_fix', comment: 'struk tidak sesuai' });
    assert.equal(sentBack.success, true);
    assert.equal(sentBack.success && sentBack.periodMonth, N);
    assert.equal(await balanceOf(M), 900_000);
    assert.equal(await balanceOf(N), MAX);
    const [asDraft] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, fixed.id));
    assert.equal(asDraft.status, 'draft');
    assert.equal(asDraft.yearMonth, N);
    ok(`a 50k ${M} request sent back after ${M}'s refill was sent: same row, draft, moved to ${N} (open), 50k back to ${M}`);

    assert.equal((await financeAcceptTransaction({ txId: fixed.id, actorId: financeId })).success, false);
    ok('while PIC 1 is fixing it Finance can not decide on it');

    assert.equal((await resubmitFixedRequest({ txId: A.id, storeId, userId: pic, description: 'x', actualAmount: 1000 })).success, false);
    ok('a request that was not sent back can not be "fixed"');

    const tooBig = await resubmitFixedRequest({ txId: fixed.id, storeId, userId: pic, description: 'besar', actualAmount: 950_000 });
    assert.equal(tooBig.success, false);
    ok(`a fix above what ${N} can spend (900.000) is refused`);

    const resent = await resubmitFixedRequest({
      txId: fixed.id,
      storeId,
      userId: pic,
      description: 'perbaikan struk',
      actualAmount: 50_000,
      categoryId: catB.id,
      imageUrl: 'https://example.test/new-receipt.jpg',
      imageKey: 'new-receipt',
    });
    assert.equal(resent.success, true);
    assert.equal(resent.success && resent.periodMonth, N);
    const [waiting] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, fixed.id));
    assert.equal(waiting.status, 'pending_ops');
    assert.equal(waiting.isReRequest, true);
    assert.equal(waiting.categoryId, catB.id);
    assert.equal(waiting.imageUrl, 'https://example.test/new-receipt.jpg');
    assert.equal(await balanceOf(N), MAX);
    ok('PIC 1 sends the fix → the same request waits on OPS, marked Re-request, new category + receipt kept, nothing cut yet');

    assert.equal(
      (await resubmitFixedRequest({ txId: fixed.id, storeId, userId: pic, description: 'x', actualAmount: 1000 })).success,
      false,
    );
    ok('it can not be sent twice');

    const approved = await approveFixedRequest({ txId: fixed.id, actorId: ops });
    assert.equal(approved.success, true);
    const [done] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, fixed.id));
    assert.equal(done.status, 'completed');
    assert.equal(done.financeReview, null);
    assert.equal(done.yearMonth, N);
    assert.equal(await balanceOf(N), 950_000);
    assert.equal(await spendableOf(N), 850_000);
    assert.equal(await balanceOf(M), 900_000);
    ok(`OPS approves → completed in ${N} (the period the employee now sees), cut from its balance (spendable 850.000), Pending Finance again`);

    // ── 5. Finance on the period, before verification ─────────────────────────
    step('5. Finance review while the refill is not verified yet');
    const rejectA = await financeRejectTransaction({ txId: A.id, actorId: financeId, kind: 'rejected' });
    assert.equal(rejectA.success, true);
    assert.equal(await balanceOf(M), MAX); // 900k + A 100k, clamped at max
    assert.equal(await getRefillOutstanding(storeId, N), 0);
    ok(`rejecting A gives 100k back to the closed (not yet verified) ${M} → the refill owed drops to 0`);
    assert.equal((await financeAcceptTransaction({ txId: A.id, actorId: financeId })).success, true);
    assert.equal(await balanceOf(M), 900_000);
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    ok('accepting it again takes it back');

    // ── 6. OPS approves, Finance verifies → period locked for Finance ─────────
    step('6. OPS approves, Finance verifies');
    assert.equal((await approveRefillRequest(sent.request.id, ops)).success, true);
    // A request of the period nobody at Finance has checked yet blocks the verification (it would freeze the amount).
    const H = await mk('completed', 10_000);
    const blocked = await verifyRefillRequests([sent.request.id], financeId);
    assert.deepEqual(blocked.changedIds, []);
    assert.equal(blocked.blocked, 1);
    ok(`a request of ${M} still Pending Finance blocks Verifikasi`);
    assert.equal((await financeAcceptTransaction({ txId: H.id, actorId: financeId })).success, true);

    const verified = await verifyRefillRequests([sent.request.id], financeId);
    assert.deepEqual(verified.changedIds, [sent.request.id]);
    const [frozen] = await db.select().from(pettyCashRefillRequests).where(eq(pettyCashRefillRequests.id, sent.request.id));
    assert.ok(frozen.transferAmount != null, 'verify freezes the transfer');
    assert.equal(Math.round(Number(frozen.transferAmount)), 100_000);
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    assert.equal(await statusOf(M), 'closed');
    ok(`once every request is decided it verifies: transfer frozen at 100.000, still owed to the store`);

    const lockedA = await financeRejectTransaction({ txId: A.id, actorId: financeId, kind: 'rejected' });
    assert.equal(lockedA.success, false);
    ok('a request of the verified period is locked for Finance');

    // ── 7. Spending after the refill was sent ─────────────────────────────────
    step(`7. PIC 1 keeps spending — it lands in ${N}, never in ${M}`);
    await mk('completed', 40_000, {}, (await getPeriod(storeId, N))!);
    await spend(N, 40_000);
    assert.equal(await balanceOf(N), 910_000);
    assert.equal(await balanceOf(M), 900_000);
    assert.equal((await getActivePeriod(storeId)).yearMonth, N);
    ok(`F 40k is booked in ${N} (910.000); ${M} and its transfer (100.000) stay as they are`);

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

    assert.equal(await statusOf(M), 'closed');
    assert.equal(await statusOf(N), 'open');
    assert.equal(await balanceOf(M), 900_000);
    assert.equal(await spendableOf(N), 910_000);
    ok(`receiving moved no period; spendable in ${N} = its balance 910.000 (the box holds what the books say)`);

    const tooEarly = await getRefillOverview(storeId);
    assert.equal(tooEarly.settle?.month, N);
    assert.equal(tooEarly.canRequest, false);
    assert.match(tooEarly.blockedReason ?? '', /baru dimulai/);
    assert.equal((await createRefillRequest(storeId, pic, BANK)).success, false);
    ok(`${N} has not started on the calendar yet (from ${D16}): its refill can't be sent today — a store never runs more than one period ahead`);

    // ── 9. The 16th ───────────────────────────────────────────────────────────
    step(`9. The calendar reaches ${N} (${D16}) — nothing left to move`);
    const rolled = await getActivePeriod(storeId, D16);
    assert.equal(rolled.yearMonth, N);
    assert.equal(await statusOf(M), 'closed');
    assert.equal(await statusOf(N), 'open');
    assert.equal(await balanceOf(M), 900_000);
    assert.equal(await balanceOf(N), 910_000);
    ok(`${N} was already in use; balances unchanged (${M} 900.000, ${N} 910.000), nothing carried`);

    const [keptA] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, A.id));
    assert.equal(keptA.yearMonth, M);
    ok('completed A stays in its period');

    await getActivePeriod(storeId, D16);
    assert.equal(await balanceOf(N), 910_000);
    assert.equal((await getActivePeriod(storeId)).yearMonth, N);
    ok('rolling again changes nothing, and a call with today\'s date never moves the store backwards');

    assert.equal(await adjustPeriodBalance(db, period.id, 50_000), false);
    ok(`the ended, verified period ${M} no longer moves`);

    const sentBackAgain = await financeRejectTransaction({ txId: fixed.id, actorId: financeId, kind: 'needs_fix', comment: 'cek lagi' });
    assert.equal(sentBackAgain.success, true);
    assert.equal(sentBackAgain.success && sentBackAgain.periodMonth, N);
    assert.equal(await balanceOf(N), 960_000);
    ok(`the fixed request is still open to Finance — sent back again it STAYS in ${N} (running, no refill asked)`);
    assert.equal((await resubmitFixedRequest({ txId: fixed.id, storeId, userId: pic, description: 'perbaikan 2', actualAmount: 50_000 })).success, true);
    assert.equal((await approveFixedRequest({ txId: fixed.id, actorId: ops })).success, true);
    assert.equal(await balanceOf(N), 910_000);
    ok('fixed and approved by OPS again → cut from N again (910.000)');

    // Ditolak before the period's Refill is sent: Finance sees it, PIC 1 does not — no message, the request still
    // reads Selesai on the employee page (visibleReviewOutcome). The balance logic is unchanged.
    const notesFor = async (txId: number) =>
      Number(
        (
          await pool.query(
            `select count(*) n from notifications where id > $1 and related_id = $2 and type like 'petty\\_cash\\_tx\\_%' escape '\\'`,
            [lastNotif, txId],
          )
        ).rows[0].n,
      );
    const sentThrough = () => latestRefilledMonth(storeId, db, { includeRejected: true });
    const G = await mk('completed', 20_000, {}, (await getPeriod(storeId, N))!);
    await spend(N, 20_000);
    assert.equal((await financeRejectTransaction({ txId: G.id, actorId: financeId, kind: 'rejected', comment: 'bukan petty cash' })).success, true);
    assert.equal(await balanceOf(N), 910_000);
    assert.equal(await notesFor(G.id), 0);
    assert.equal(visibleReviewOutcome('rejected', N, await sentThrough()), 'none');
    ok(`a ${N} request Ditolak before ${N}'s Refill is sent: 20k back to ${N}, but PIC 1 gets no message and still sees Selesai`);
    assert.equal((await financeAcceptTransaction({ txId: G.id, actorId: financeId })).success, true);
    assert.equal(await notesFor(G.id), 0);
    assert.equal((await financeRejectTransaction({ txId: G.id, actorId: financeId, kind: 'rejected' })).success, true);
    assert.equal(await notesFor(G.id), 0);
    assert.equal(await balanceOf(N), 910_000);
    ok('taking it back (Diterima) and turning it down again are silent too');

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

    assert.equal(await refillRequiredBeforeRequest(storeId, D16b), N);
    ok(`until ${N}'s Refill is sent, PIC 1 can file no new request in ${P}`);

    const late = await createRefillRequest(storeId, pic, BANK, undefined, D16b);
    assert.equal(late.success, true);
    if (!late.success) return;
    assert.equal(await refillRequiredBeforeRequest(storeId, D16b), null);
    assert.equal(late.periodMonth, N);
    assert.equal(late.usageMonth, P);
    assert.equal(late.late, true);
    assert.equal(late.request.yearMonth, N);
    assert.equal(await statusOf(P), 'open');
    assert.equal(await balanceOf(P), MAX);
    ok(`the late refill is recorded against ${N}; ${P} is untouched`);

    assert.equal((await createRefillRequest(storeId, pic, BANK, undefined, D16b)).success, false);
    ok('and while it is on its way the next one has to wait');

    assert.equal(visibleReviewOutcome('rejected', N, await sentThrough()), 'rejected');
    assert.equal(visibleReviewOutcome('accepted', N, await sentThrough()), 'accepted');
    assert.equal(visibleReviewOutcome(null, P, await sentThrough()), 'none');
    ok(`${N}'s Refill is sent → PIC 1 now sees the Ditolak of ${N}; ${P}'s decisions stay hidden`);

    assert.equal((await approveRefillRequest(late.request.id, ops)).success, true);
    // Finance checks every request of N first (a Pending Finance one would block Verifikasi).
    for (const t of await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.yearMonth, N))) {
      if (t.storeId === storeId && t.status === 'completed' && t.financeReview == null) {
        assert.equal((await financeAcceptTransaction({ txId: t.id, actorId: financeId })).success, true);
      }
    }
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

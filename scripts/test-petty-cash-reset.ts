// scripts/test-petty-cash-reset.ts
//
// End-to-end check of IT's Reset Petty Cash (lib/db/utils/petty-cash-reset.ts) against the REAL database logic —
// DUMMY store only, staging only.
//
//   npx dotenv -e .env.local -- tsx scripts/test-petty-cash-reset.ts
//   npm run test:petty-cash-reset
//
// Safety: refuses production (scripts/lib/not-production.ts) and any store that is not DUMMY*. The store's own
// petty cash rows (periods, requests, refill requests, refills) and its petty_cash_* notifications are BACKED UP
// first, the scenario runs on a clean slate, and the backup is put back at the end — also when an assertion fails.
//
// Rules under test:
//   • preview counts exactly what a reset removes and changes nothing;
//   • resetting ONE period removes its requests + the refill that settles it + their notifications, keeps the period
//     row (status, place in the chain) at Rp 1.000.000, and leaves every other period alone (a Re-request elsewhere
//     only loses the link to its original);
//   • resetting ALL periods removes everything of the store and opens one fresh period for this Jakarta month;
//   • nothing else is touched (unrelated notifications survive), unknown periods / stores are refused;
//   • the JSON backup the page offers restores the deleted rows.

import './lib/not-production';

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { describeTarget } from './lib/db-target';
import { pettyCashPeriods, pettyCashTransactions } from '@/lib/db/schema';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { addMonths, usagePeriodFor } from '@/lib/petty-cash-period';
import { parseResetScope } from '@/lib/petty-cash-reset';
import { getActivePeriod, getPeriod } from '@/lib/db/utils/petty-cash-period';
import {
  approveRefillRequest,
  createRefillRequest,
  getRefillOutstanding,
  verifyRefillRequests,
} from '@/lib/db/utils/petty-cash-refill';
import { createReRequest } from '@/lib/db/utils/petty-cash-re-request';
import { financeRejectTransaction, financeUserIds } from '@/lib/db/utils/petty-cash-review';
import { listPettyCashCategories } from '@/lib/db/utils/petty-cash-categories';
import {
  exportResetBackup,
  getResetOverview,
  listResetStores,
  previewPettyCashReset,
  resetPettyCash,
} from '@/lib/db/utils/petty-cash-reset';

const STORE_NO = 'DUMMY-001';
const TABLES = ['petty_cash_periods', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_transactions'] as const;
const MAX = 1_000_000;
const BANK = { bankName: 'BCA', accountNumber: '1234567890', accountHolderName: 'TEST DUMMY' };
const STAFF_NOTIFS = `left(type, 11) = 'petty_cash_' and user_id in (select id from users where home_store_id = $1)`;

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

  const picId = (await pool.query('select id from users where home_store_id = $1 and deleted_at is null limit 1', [storeId])).rows[0]?.id as string | undefined;
  if (!picId) die(`${STORE_NO} has no user to act as PIC 1.`);
  const opsId = (
    await pool.query(`select u.id from users u join user_roles r on r.id = u.role_id where r.code in ('ops','it') and u.is_active limit 1`)
  ).rows[0]?.id as string | undefined;
  const financeId = (await financeUserIds())[0] ?? (picId as string);
  const pic = picId as string;
  const ops = opsId ?? pic;

  // ── Backup ──────────────────────────────────────────────────────────────────
  const backup: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    backup[t] = (await pool.query(`select row_to_json(t) r from ${t} t where store_id = $1 order by id`, [storeId])).rows.map((r) => r.r);
  }
  const notifQuery = `select row_to_json(n) r from notifications n where ${STAFF_NOTIFS}
    or (related_type = 'petty_cash_transaction' and related_id in (select id from petty_cash_transactions where store_id = $1))
    or (related_type = 'petty_cash_refill_request' and related_id in (select id from petty_cash_refill_requests where store_id = $1))`;
  backup.notifications = (await pool.query(notifQuery, [storeId])).rows.map((r) => r.r);
  const storeBalance = (await pool.query('select petty_cash_balance b from stores where id = $1', [storeId])).rows[0].b as string | null;
  const backupFile = join(tmpdir(), `petty-cash-reset-${STORE_NO}-backup-${Date.now()}.json`);
  writeFileSync(backupFile, JSON.stringify({ ...backup, storeBalance }));
  console.log(`backup   : ${[...TABLES, 'notifications'].map((t) => `${t.replace('petty_cash_', '')}=${backup[t].length}`).join(' ')}  → ${backupFile}`);
  const lastNotif = Number((await pool.query('select coalesce(max(id), 0) m from notifications')).rows[0].m);

  const wipe = async () => {
    await pool.query(notifQuery.replace('select row_to_json(n) r from', 'delete from').replace(' n where', ' where'), [storeId]);
    await pool.query('delete from petty_cash_transactions where store_id = $1', [storeId]);
    await pool.query('delete from petty_cash_refill_requests where store_id = $1', [storeId]);
    await pool.query('delete from petty_cash_refills where store_id = $1', [storeId]);
    await pool.query('delete from petty_cash_periods where store_id = $1', [storeId]);
  };
  const insertRows = async (table: string, rows: unknown[], tail = '') => {
    if (!rows.length) return;
    await pool.query(`insert into ${table} select * from json_populate_recordset(null::${table}, $1::json) ${tail}`, [JSON.stringify(rows)]);
  };
  const countRows = async (sql: string, ...params: unknown[]) => Number((await pool.query(sql, params)).rows[0].n);
  const notifExists = async (id: number) => (await countRows('select count(*)::int n from notifications where id = $1', id)) === 1;

  try {
    await wipe();

    const today = jakartaTodayKey();
    // The period of today's date (16th → 15th) and the one after it; D16 = the day the calendar moves on to N.
    const M = usagePeriodFor(today);
    const N = addMonths(M, 1);
    const D16 = `${M}-16`;
    const balanceOf = async (ym: string) => Number((await getPeriod(storeId, ym))!.currentBalance);
    const categories = await listPettyCashCategories({ activeOnly: true });
    assert.ok(categories.length >= 1, 'needs at least one active category');
    const cat = categories[0];

    // ── Scenario: the full Refill story over two periods ───────────────────────
    step(`Scenario: period ${M} refilled → ${N} in use, with a Re-request`);
    const period = await getActivePeriod(storeId);
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
          description: `RESET SCENARIO ${status} ${amount}`,
          categoryId: cat.id,
          categoryName: cat.name,
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
    const needsFix = await financeRejectTransaction({ txId: B.id, actorId: financeId, kind: 'needs_fix', comment: 'foto kurang jelas' });
    assert.equal(needsFix.success, true);

    const sent = await createRefillRequest(storeId, pic, BANK);
    assert.equal(sent.success, true);
    if (!sent.success) return;
    assert.equal((await approveRefillRequest(sent.request.id, ops)).success, true);
    assert.deepEqual((await verifyRefillRequests([sent.request.id], financeId)).changedIds, [sent.request.id]);
    assert.equal((await getPeriod(storeId, M))!.status, 'open'); // sending / verifying a refill closes nothing
    // The 16th: the calendar moves the store on — M closes, N opens, C and D (still waiting) go with it.
    assert.equal((await getActivePeriod(storeId, D16)).yearMonth, N);

    const re = await createReRequest({
      originalTxId: B.id,
      storeId,
      userId: pic,
      requestDate: today,
      description: 'perbaikan struk',
      actualAmount: 50_000,
      categoryId: cat.id,
      imageUrl: 'https://example.test/new-receipt.jpg',
      imageKey: 'new-receipt',
    });
    assert.equal(re.success, true);
    if (!re.success) return;
    assert.equal(re.periodMonth, N);

    const nBalance = await balanceOf(N);
    assert.equal(nBalance, 950_000);
    assert.equal((await getPeriod(storeId, M))!.status, 'closed');
    assert.equal((await getPeriod(storeId, N))!.status, 'open');
    assert.equal(await getRefillOutstanding(storeId, N), 100_000);
    ok(`${M} closed (A 100k, B 50k Perlu Perbaikan, refill verified), ${N} open (C, D moved over + Re-request of B), balance ${nBalance.toLocaleString('id-ID')}`);

    // Notifications: two about the period M rows, one for the store's staff with no link, two that must survive.
    const notif = async (userId: string, type: string, relatedType: string | null, relatedId: number | null) =>
      Number(
        (
          await pool.query(
            `insert into notifications (user_id, type, title, related_type, related_id) values ($1,$2,'RESET TEST',$3,$4) returning id`,
            [userId, type, relatedType, relatedId],
          )
        ).rows[0].id,
      );
    const nTx = await notif(pic, 'petty_cash_tx_re_request', 'petty_cash_transaction', A.id);
    const nRefill = await notif(ops, 'petty_cash_refill_requested', 'petty_cash_refill_request', sent.request.id);
    const nStaff = await notif(pic, 'petty_cash_misc', null, null);
    const nOther = await notif(ops, 'issue_reported', null, null);
    const nSchedule = await notif(pic, 'schedule_changed', 'schedule', 1);
    ok('5 test notifications: 2 about period rows, 1 loose petty_cash_* for the staff, 2 unrelated');

    // What a reset must remove, counted straight from SQL (independent of the code under test). The flow itself
    // also writes notifications that name these rows (Perlu Perbaikan, refill verified, Re-request), so the
    // number is not just the two above.
    const aboutRows = async (txIds: number[], refillIds: number[], staff: boolean) =>
      countRows(
        `select count(*)::int n from notifications where
           (related_type = 'petty_cash_transaction' and related_id = any($1::int[]))
        or (related_type = 'petty_cash_refill_request' and related_id = any($2::int[]))
        or ($3::boolean and ${STAFF_NOTIFS.replace('$1', '$4')})`,
        txIds,
        refillIds,
        staff,
        storeId,
      );
    const expectM = await aboutRows([A.id, B.id], [sent.request.id], false);
    assert.ok(expectM >= 4, `expected the flow to leave at least 4 notifications about period ${M}, found ${expectM}`);
    ok(`${expectM} notifications name the rows of period ${M} (the 2 above + the Perlu Perbaikan and refill-verified messages)`);

    // ── 1. Overview + preview change nothing ──────────────────────────────────
    step('1. Overview and preview');
    const stores = await listResetStores();
    const row = stores.find((s) => s.id === storeId)!;
    assert.deepEqual([row.periods, row.requests, row.refillRequests], [2, 5, 1]);
    ok('store list counts 2 periods, 5 requests, 1 refill request');

    const overview = await getResetOverview(storeId);
    assert.equal(overview.success, true);
    if (!overview.success) return;
    assert.deepEqual(overview.data.periods.map((p) => [p.yearMonth, p.status, p.requests, p.waiting, p.completed]), [
      [N, 'open', 3, 2, 1],
      [M, 'closed', 2, 0, 2],
    ]);
    assert.equal(overview.data.periods[1].refill?.state, 'verified');
    assert.equal(overview.data.periods[1].refill?.count, 1);
    assert.equal(overview.data.periods[0].refill, null);
    assert.equal(overview.data.totals.requests, 5);
    ok(`overview lists ${N} (3 requests: C, D, Re-request) above ${M} (A, B; refill Terverifikasi)`);

    const prePeriod = await previewPettyCashReset(storeId, { type: 'period', yearMonth: M });
    assert.equal(prePeriod.success, true);
    if (!prePeriod.success) return;
    const pp = prePeriod.data;
    assert.equal(pp.requests, 2);
    assert.equal(pp.completedAmount, 150_000);
    assert.equal(pp.refillRequests, 1);
    assert.equal(pp.refillsVerified, 1);
    assert.equal(pp.refillsReceived, 0);
    assert.equal(pp.transferredAmount, 100_000);
    assert.equal(pp.refillsInFlight, 1);
    assert.equal(pp.periodsRemoved, 0);
    assert.equal(pp.orphanedReRequests, 1);
    assert.equal(pp.notifications, expectM);
    assert.deepEqual(pp.after, { yearMonth: M, status: 'closed', balance: MAX });
    ok(`period ${M}: 2 requests (150.000), 1 Finance-verified refill (100.000), 1 Re-request would lose its original, ${expectM} notifications; ${M} stays closed at 1.000.000`);

    const preAll = await previewPettyCashReset(storeId, { type: 'all' });
    assert.equal(preAll.success, true);
    if (!preAll.success) return;
    assert.equal(preAll.data.requests, 5);
    assert.equal(preAll.data.periodsRemoved, 2);
    assert.equal(preAll.data.orphanedReRequests, 0);
    const expectAll = await aboutRows([A.id, B.id, C.id, D.id, re.txId], [sent.request.id], true);
    assert.ok(expectAll > expectM, 'the loose staff notification is only part of "all"');
    assert.equal(preAll.data.notifications, expectAll);
    assert.deepEqual(preAll.data.after, { yearMonth: M, status: 'open', balance: MAX });
    ok(`all periods: 5 requests, 2 periods, ${expectAll} notifications (the 2 unrelated stay); a fresh open period for this month`);

    assert.equal(await countRows('select count(*)::int n from petty_cash_transactions where store_id = $1', storeId), 5);
    assert.equal(await balanceOf(N), 950_000);
    ok('previewing changed nothing');

    // ── 2. Reset ONE period (the closed, refilled one) ────────────────────────
    step(`2. Reset period ${M}`);
    const backupM = await exportResetBackup(storeId, { type: 'period', yearMonth: M });
    assert.equal(backupM.success, true);
    if (!backupM.success) return;
    const bm = backupM.data.body as Record<string, unknown[]>;
    assert.deepEqual(
      [bm.petty_cash_transactions.length, bm.petty_cash_refill_requests.length, bm.petty_cash_periods.length, bm.notifications.length],
      [2, 1, 1, expectM],
    );
    assert.ok(backupM.data.filename.includes(STORE_NO) && backupM.data.filename.includes(M));
    ok(`the backup holds exactly the 2 requests, the refill, the period and the ${expectM} notifications`);

    const r1 = await resetPettyCash(storeId, { type: 'period', yearMonth: M });
    assert.equal(r1.success, true);
    if (!r1.success) return;
    assert.deepEqual(r1.data.deleted, { requests: 2, refillRequests: 1, legacyRefills: 0, periods: 0, notifications: expectM });
    assert.equal(await aboutRows([A.id, B.id], [sent.request.id], false), 0);
    ok(`deleted 2 requests, 1 refill request, ${expectM} notifications; no period row`);

    const mRow = (await getPeriod(storeId, M))!;
    assert.equal(mRow.status, 'closed');
    assert.equal(Number(mRow.currentBalance), MAX);
    assert.equal(Number(mRow.openingBalance), MAX);
    assert.equal(mRow.closingBalance, null);
    assert.equal(await countRows('select count(*)::int n from petty_cash_transactions where store_id = $1 and year_month = $2', storeId, M), 0);
    assert.equal(await countRows('select count(*)::int n from petty_cash_refill_requests where store_id = $1', storeId), 0);
    ok(`${M} is still there, still closed (its place in the chain), balance back at 1.000.000`);

    assert.equal((await getPeriod(storeId, N))!.status, 'open');
    assert.equal(await balanceOf(N), 950_000);
    assert.equal(await countRows('select count(*)::int n from petty_cash_transactions where store_id = $1 and period_id = $2', storeId, (await getPeriod(storeId, N))!.id), 3);
    assert.equal((await getActivePeriod(storeId, D16)).yearMonth, N);
    ok(`${N} untouched: still open, 3 requests, balance 950.000, still where new requests land`);

    const [reRow] = await db.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, re.txId));
    assert.equal(reRow.isReRequest, true);
    assert.equal(reRow.reRequestOfId, null);
    assert.equal(reRow.status, 'completed');
    ok('the Re-request kept its row and its mark, only the link to its original is gone');

    assert.equal(await getRefillOutstanding(storeId, N), 0);
    ok('no refill is owed any more for the period before');

    assert.equal(await notifExists(nTx), false);
    assert.equal(await notifExists(nRefill), false);
    for (const id of [nStaff, nOther, nSchedule]) assert.equal(await notifExists(id), true);
    ok('only the notifications about the deleted rows went');

    const again = await resetPettyCash(storeId, { type: 'period', yearMonth: M });
    assert.equal(again.success, true);
    if (!again.success) return;
    assert.deepEqual(again.data.deleted, { requests: 0, refillRequests: 0, legacyRefills: 0, periods: 0, notifications: 0 });
    assert.equal(await balanceOf(M), MAX);
    ok('resetting it again is a harmless no-op');

    // ── 3. Reset the period in use ────────────────────────────────────────────
    step(`3. Reset period ${N} (the one in use)`);
    const r2 = await resetPettyCash(storeId, { type: 'period', yearMonth: N });
    assert.equal(r2.success, true);
    if (!r2.success) return;
    assert.equal(r2.data.deleted.requests, 3);
    const nRow = (await getPeriod(storeId, N))!;
    assert.equal(nRow.status, 'open');
    assert.equal(Number(nRow.currentBalance), MAX);
    assert.equal(await countRows('select count(*)::int n from petty_cash_transactions where store_id = $1', storeId), 0);
    assert.equal((await getPeriod(storeId, M))!.status, 'closed');
    ok(`${N} is open at 1.000.000 with no requests; ${M} untouched`);

    // ── 4. Refusals ───────────────────────────────────────────────────────────
    step('4. Refusals');
    const noPeriod = await resetPettyCash(storeId, { type: 'period', yearMonth: '2020-01' });
    assert.equal(noPeriod.success, false);
    assert.equal(noPeriod.success === false && noPeriod.status, 404);
    const noStore = await resetPettyCash(2_000_000_000, { type: 'all' });
    assert.equal(noStore.success, false);
    assert.equal(noStore.success === false && noStore.status, 404);
    assert.equal((await previewPettyCashReset(storeId, { type: 'period', yearMonth: '2020-01' })).success, false);
    ok('an unknown period or store is a 404 for both the reset and the preview');
    assert.equal(parseResetScope('period', '2026-13'), null);
    assert.equal(parseResetScope('period', undefined), null);
    assert.equal(parseResetScope('everything', undefined), null);
    assert.deepEqual(parseResetScope('all', undefined), { type: 'all' });
    assert.deepEqual(parseResetScope('period', '2026-11'), { type: 'period', yearMonth: '2026-11' });
    ok('the scope parser accepts "all" and a real YYYY-MM period only');

    // ── 5. Reset ALL periods ──────────────────────────────────────────────────
    step('5. Reset all periods');
    const E = await mk('completed', 10_000);
    await db.update(pettyCashPeriods).set({ currentBalance: String(MAX - 10_000) }).where(eq(pettyCashPeriods.id, period.id));
    const nTx2 = await notif(pic, 'petty_cash_tx_re_request', 'petty_cash_transaction', E.id);

    const backupAll = await exportResetBackup(storeId, { type: 'all' });
    assert.equal(backupAll.success, true);
    if (!backupAll.success) return;
    const ba = backupAll.data.body as Record<string, unknown[]>;
    assert.deepEqual([ba.petty_cash_transactions.length, ba.petty_cash_periods.length], [1, 2]);

    const r3 = await resetPettyCash(storeId, { type: 'all' });
    assert.equal(r3.success, true);
    if (!r3.success) return;
    assert.equal(r3.data.deleted.requests, 1);
    assert.equal(r3.data.deleted.periods, 2);
    assert.deepEqual(r3.data.after, { yearMonth: M, status: 'open', balance: MAX });
    ok('deleted the request and both periods');

    const periods = (await pool.query('select year_month, status, current_balance::numeric c, opening_balance::numeric o from petty_cash_periods where store_id = $1', [storeId])).rows;
    assert.equal(periods.length, 1);
    assert.equal(periods[0].year_month, M);
    assert.equal(periods[0].status, 'open');
    assert.equal(Number(periods[0].c), MAX);
    assert.equal(Number(periods[0].o), MAX);
    assert.equal(Number((await pool.query('select petty_cash_balance::numeric b from stores where id = $1', [storeId])).rows[0].b), MAX);
    for (const t of ['petty_cash_transactions', 'petty_cash_refill_requests', 'petty_cash_refills']) {
      assert.equal(await countRows(`select count(*)::int n from ${t} where store_id = $1`, storeId), 0);
    }
    ok(`one fresh open period ${M} at 1.000.000 (stores.petty_cash_balance too), nothing else is left`);

    assert.equal(await notifExists(nTx2), false);
    assert.equal(await notifExists(nStaff), false);
    assert.equal(await notifExists(nOther), true);
    assert.equal(await notifExists(nSchedule), true);
    ok('the loose petty_cash_* notification of the staff went; the unrelated ones stayed');

    // ── 6. The backup restores ────────────────────────────────────────────────
    step('6. The JSON backup puts the rows back');
    await pool.query('delete from petty_cash_periods where store_id = $1', [storeId]);
    await insertRows('petty_cash_periods', ba.petty_cash_periods);
    await insertRows('petty_cash_transactions', ba.petty_cash_transactions);
    assert.equal(await countRows('select count(*)::int n from petty_cash_periods where store_id = $1', storeId), 2);
    const back = (await pool.query('select id, description, actual_amount::numeric a from petty_cash_transactions where store_id = $1', [storeId])).rows;
    assert.equal(back.length, 1);
    assert.equal(back[0].id, E.id);
    assert.equal(Number(back[0].a), 10_000);
    // M was closed and N open before the reset; the backup brings both back as they were (M holds the 10k spent).
    assert.equal(await countRows('select count(*)::int n from petty_cash_periods p where store_id = $1 and year_month = $2 and p.current_balance::numeric = $3 and status = $4', storeId, M, MAX - 10_000, 'closed'), 1);
    assert.equal(await countRows('select count(*)::int n from petty_cash_periods p where store_id = $1 and year_month = $2 and p.current_balance::numeric = $3 and status = $4', storeId, N, MAX, 'open'), 1);
    ok('2 periods and the request are back with their ids, amounts, statuses and balances');

    // ── 7. A store that is not active gets no new period (read-only check) ───
    step('7. Non-active store (preview only)');
    const inactive = (await pool.query(`select id, store_no, status from stores where status <> 'active' limit 1`)).rows[0];
    if (inactive) {
      const p = await previewPettyCashReset(inactive.id, { type: 'all' });
      assert.equal(p.success, true);
      if (p.success) assert.deepEqual(p.data.after, { yearMonth: null, status: null, balance: null });
      ok(`${inactive.store_no} (${inactive.status}): "all" would leave no period behind`);
    } else {
      console.log('  – no non-active store in this database, skipped');
    }

    console.log(`\n${checks} checks passed`);
  } finally {
    // ── Restore ───────────────────────────────────────────────────────────────
    try {
      await wipe();
      await pool.query('delete from notifications where id > $1', [lastNotif]);
      for (const t of ['petty_cash_periods', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_transactions'] as const) {
        await insertRows(t, backup[t]);
      }
      await insertRows('notifications', backup.notifications, 'on conflict (id) do nothing');
      await pool.query('update stores set petty_cash_balance = $1 where id = $2', [storeBalance, storeId]);
      console.log(`\nrestored : ${STORE_NO} petty cash back to its backup (${[...TABLES, 'notifications'].map((t) => `${t.replace('petty_cash_', '')}=${backup[t].length}`).join(' ')}); scenario notifications removed`);
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

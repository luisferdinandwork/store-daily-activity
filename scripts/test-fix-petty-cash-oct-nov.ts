// scripts/test-fix-petty-cash-oct-nov.ts
//
// End-to-end check of scripts/fix-petty-cash-oct-nov-periods.ts on a STAGING database, DUMMY-001 only:
//
//   DATABASE_URL=<staging url> npx tsx scripts/test-fix-petty-cash-oct-nov.ts
//
// Safety: refuses any database that is not *-staging / prism_local (the usual not-production guard cannot tell,
// PRODUCTION_DATABASE_URL is often unset) and any store that is not DUMMY-001. DUMMY-001's petty cash rows (4 tables +
// their notifications) are BACKED UP first, a "lumped" October scenario (the shape the old flow left behind) is built,
// the fix script is run against it as a child process, and the backup is put back at the end — also when a check fails.
//
// Rules under test: dry run changes nothing · apply needs --confirm · requests are re-sorted by the day they were
// confirmed (boundaries 15/16 Oct) · Oct closed / Nov open with the right balances · waiting requests go to Nov ·
// the refill request is relabelled and never "received" · running twice changes nothing more · --restore puts the
// scenario back exactly · --verify freezes the transfer + notifies once · a store with a verified refill is skipped.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { usagePeriodFor } from '@/lib/petty-cash-period';

const STORE_NO = 'DUMMY-001';
const SCRIPT = 'scripts/fix-petty-cash-oct-nov-periods.ts';
const TABLES = ['petty_cash_periods', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_transactions'] as const;

let checks = 0;
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
  console.log(`database : ${dbName}`);
  if (!(/-staging$/.test(dbName) || dbName === 'prism_local')) die(`Refusing: "${dbName}" is not a staging/local database.`);
  if (usagePeriodFor(jakartaTodayKey()) !== '2026-11') {
    console.log('(today is no longer in the 2026-11 period — the fix script refuses to run then; nothing to test)');
    await pool.end();
    return;
  }

  const store = (await pool.query('select id, store_no, status from stores where store_no = $1', [STORE_NO])).rows[0];
  if (!store || store.status !== 'active') die(`${STORE_NO} must exist and be active.`);
  const storeId = store.id as number;
  const pic = (await pool.query('select id from users where home_store_id = $1 and deleted_at is null limit 1', [storeId])).rows[0]?.id as string;
  if (!pic) die(`${STORE_NO} has no user to act as PIC 1.`);
  const financeUser = (
    await pool.query(`select u.id, u.nik from users u join user_roles r on r.id = u.role_id where r.code in ('finance','it') and u.is_active limit 1`)
  ).rows[0] as { id: string; nik: string } | undefined;
  if (!financeUser) die('No active Finance/IT user on this database to record a verification under.');
  const fin = financeUser as { id: string; nik: string };

  // ── Backup of DUMMY-001's petty cash ─────────────────────────────────────────
  const backup: Record<string, unknown[]> = {};
  for (const t of TABLES) backup[t] = (await pool.query(`select row_to_json(t) r from ${t} t where store_id = $1 order by id`, [storeId])).rows.map((r) => r.r);
  const notifQuery = `select row_to_json(n) r from notifications n where
      (related_type = 'petty_cash_transaction' and related_id in (select id from petty_cash_transactions where store_id = $1))
   or (related_type = 'petty_cash_refill_request' and related_id in (select id from petty_cash_refill_requests where store_id = $1))`;
  backup.notifications = (await pool.query(notifQuery, [storeId])).rows.map((r) => r.r);
  const backupFile = join(tmpdir(), `fix-oct-nov-test-${STORE_NO}-${Date.now()}.json`);
  writeFileSync(backupFile, JSON.stringify(backup));
  console.log(`backup   : ${TABLES.map((t) => `${t.replace('petty_cash_', '')}=${backup[t].length}`).join(' ')} → ${backupFile}`);

  const wipe = async () => {
    await pool.query(notifQuery.replace('select row_to_json(n) r from', 'delete from').replace(' n where', ' where'), [storeId]);
    for (const t of ['petty_cash_transactions', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_periods']) {
      await pool.query(`delete from ${t} where store_id = $1`, [storeId]);
    }
  };
  const insertRows = async (table: string, rows: unknown[]) => {
    if (rows.length) await pool.query(`insert into ${table} select * from json_populate_recordset(null::${table}, $1::json)`, [JSON.stringify(rows)]);
  };
  const one = async (sql: string, ...p: unknown[]) => (await pool.query(sql, p)).rows[0];
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(
        ['petty_cash_periods', 'petty_cash_transactions', 'petty_cash_refill_requests'].map(async (t) =>
          (await pool.query(`select row_to_json(t) r from ${t} t where store_id = $1 order by id`, [storeId])).rows.map((r) => r.r),
        ),
      ),
    );
  const run = (...extra: string[]) => {
    const r = spawnSync('npx', ['tsx', SCRIPT, `--store=${STORE_NO}`, '--include-dummy', ...extra], { shell: true, encoding: 'utf8', env: process.env });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  try {
    await wipe();

    // ── Scenario: the lumped October the old flow left behind ──────────────────
    console.log('\nScenario: one open "2026-10" period holding everything, a refill labelled 2026-11');
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const period = await one(
      `insert into petty_cash_periods (store_id, year_month, opening_balance, current_balance, status, created_at, updated_at)
       values ($1, '2026-10', 1000000, 630000, 'open', $2, $2) returning id`,
      storeId, now,
    );
    const mk = async (status: string, amount: number, confirmedAt: string | null, review: string | null = null, ym = '2026-10') =>
      (
        await one(
          `insert into petty_cash_transactions (period_id, amount, actual_amount, actual_amount_at, description, user_id, store_id, status, year_month, finance_review, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '2026-10-10 03:00:00', '2026-10-10 03:00:00') returning id`,
          period.id, amount, status === 'completed' ? amount : null, confirmedAt, `TEST ${status} ${amount}`, pic, storeId, status, ym, review,
        )
      ).id as number;
    const a = await mk('completed', 100_000, '2026-10-12 10:00:00.123456'); //            Oct
    const b = await mk('completed', 40_000, '2026-10-15 23:59:59.999999'); //             Oct (last second)
    const c = await mk('completed', 30_000, '2026-10-16 00:00:00.000001'); //             Nov (first second)
    const d = await mk('completed', 200_000, '2026-11-04 09:00:00.654321'); //            Nov
    const e = await mk('completed', 50_000, '2026-10-20 09:00:00.111111', 'needs_fix'); // Nov, left out of usage
    const f = await mk('pending_ops', 20_000, null); //                                    waiting → Nov
    const g = await mk('ops_approved', 10_000, null); //                                   waiting → Nov
    const h = await mk('ops_rejected', 5_000, null); //                                    stays
    const refill = await one(
      `insert into petty_cash_refill_requests (store_id, year_month, requested_by, requested_at, status, approved_by, approved_at, balance_before, updated_at)
       values ($1, '2026-11', $2, $3, 'approved', $2, $3, 630000, $3) returning id`,
      storeId, pic, now,
    );
    const lumped = await snapshot();
    ok('lumped scenario built');

    // ── 1. dry run changes nothing ─────────────────────────────────────────────
    let r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /DUMMY-001 .*→/);
    assert.equal(await snapshot(), lumped);
    ok('dry run exits 0, prints the plan and changes nothing');

    // ── 2. apply needs the database name typed back ────────────────────────────
    r = run('--apply');
    assert.notEqual(r.code, 0);
    r = run('--apply', '--confirm=wrong');
    assert.notEqual(r.code, 0);
    assert.equal(await snapshot(), lumped);
    ok('--apply without a matching --confirm is refused');

    // ── 3. apply ───────────────────────────────────────────────────────────────
    r = run('--apply', `--confirm=${dbName}`);
    assert.equal(r.code, 0, r.out);
    const per = async (ym: string) => one(`select id, status, current_balance::float bal, closed_at from petty_cash_periods where store_id = $1 and year_month = $2`, storeId, ym);
    const oct = await per('2026-10');
    const nov = await per('2026-11');
    assert.equal(oct.status, 'closed');
    assert.equal(oct.bal, 860_000);
    assert.ok(oct.closed_at);
    assert.equal(nov.status, 'open');
    assert.equal(nov.bal, 770_000); // 1.000.000 − 30.000 − 200.000 (the Perlu Perbaikan one is left out; waiting ones cost nothing yet)
    ok('October closed at Rp 860.000, November open at Rp 770.000');
    for (const [id, ym] of [[a, '2026-10'], [b, '2026-10'], [c, '2026-11'], [d, '2026-11'], [e, '2026-11'], [f, '2026-11'], [g, '2026-11'], [h, '2026-10']] as const) {
      const t = await one(`select t.year_month ym, p.year_month pm from petty_cash_transactions t left join petty_cash_periods p on p.id = t.period_id where t.id = $1`, id);
      assert.equal(t.ym, ym, `request ${id}`);
      assert.equal(t.pm, ym, `request ${id} period`);
    }
    ok('every request sits in the period of its confirm day (15/16 Oct boundary included); waiting ones in November; Ops-rejected untouched');
    const rr = await one(`select year_month, status, balance_before::float bb, balance_after, finance_verified_at from petty_cash_refill_requests where id = $1`, refill.id);
    assert.equal(rr.year_month, '2026-10');
    assert.equal(rr.bb, 860_000);
    assert.equal(rr.status, 'approved');
    assert.equal(rr.balance_after, null);
    assert.equal(rr.finance_verified_at, null);
    ok('the refill request is relabelled 2026-10, not verified, never received');
    const fixed = await snapshot();

    // ── 4. second run changes nothing more ─────────────────────────────────────
    r = run('--apply', `--confirm=${dbName}`);
    assert.equal(r.code, 0, r.out);
    const again = JSON.parse(await snapshot()) as Array<Array<Record<string, unknown>>>;
    const first = JSON.parse(fixed) as typeof again;
    const strip = (rows: Array<Record<string, unknown>>) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'updated_at')));
    assert.deepEqual(again.map(strip), first.map(strip));
    ok('running it twice changes nothing but updated_at');

    // ── 5. restore puts the scenario back ──────────────────────────────────────
    const backups = readdirSync('backups').filter((f) => f.startsWith(`petty-cash-oct-nov-backup-${dbName}-`)).sort();
    const firstBackup = `backups/${backups[backups.length - 2]}`; // the first apply's (the second apply made a later one)
    r = run(`--restore=${firstBackup}`, `--confirm=${dbName}`);
    assert.equal(r.code, 0, r.out);
    const restored = JSON.parse(await snapshot()) as typeof again;
    const lumpedRows = JSON.parse(lumped) as typeof again;
    assert.deepEqual(restored.map(strip), lumpedRows.map(strip));
    ok('--restore brings back the lumped scenario exactly (the November row it created is gone)');

    // ── 6. verify ──────────────────────────────────────────────────────────────
    const notifBefore = Number((await one(`select count(*)::int n from notifications where related_type = 'petty_cash_refill_request' and related_id = $1`, refill.id)).n);
    r = run('--apply', `--confirm=${dbName}`, '--verify', `--actor=${fin.nik}`);
    assert.equal(r.code, 0, r.out);
    const v = await one(`select finance_verified_by, finance_verified_at, transfer_amount::float ta, rejected_count, balance_after, year_month from petty_cash_refill_requests where id = $1`, refill.id);
    assert.equal(v.finance_verified_by, fin.id);
    assert.ok(v.finance_verified_at);
    assert.equal(v.ta, 140_000); // 1.000.000 − 860.000
    assert.equal(v.balance_after, null);
    assert.equal(v.year_month, '2026-10');
    const notifAfter = Number((await one(`select count(*)::int n from notifications where related_type = 'petty_cash_refill_request' and related_id = $1`, refill.id)).n);
    assert.equal(notifAfter, notifBefore + 1);
    ok('--verify freezes Rp 140.000, records the Finance user, sends one notification, still no balance_after');

    // ── 7. a verified refill → the store is skipped, never touched ─────────────
    const before = await snapshot();
    r = run('--apply', `--confirm=${dbName}`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SKIPPED DUMMY-001/);
    assert.equal(await snapshot(), before);
    ok('a store whose refill is already verified is skipped and left alone');

    // ── 8. restore after verify removes the notification ───────────────────────
    const all = readdirSync('backups').filter((f) => f.startsWith(`petty-cash-oct-nov-backup-${dbName}-`)).sort();
    r = run(`--restore=backups/${all[all.length - 2]}`, `--confirm=${dbName}`); // the --verify apply's (step 7's apply was a no-op skip)
    assert.equal(r.code, 0, r.out);
    const un = await one(`select finance_verified_at, transfer_amount from petty_cash_refill_requests where id = $1`, refill.id);
    assert.equal(un.finance_verified_at, null);
    assert.equal(un.transfer_amount, null);
    assert.equal(Number((await one(`select count(*)::int n from notifications where related_type = 'petty_cash_refill_request' and related_id = $1`, refill.id)).n), notifBefore);
    ok('--restore after --verify un-verifies and removes the notification it sent');
  } finally {
    await wipe();
    for (const t of ['petty_cash_periods', 'petty_cash_refills', 'petty_cash_refill_requests', 'petty_cash_transactions'] as const) await insertRows(t, backup[t]);
    await insertRows('notifications', backup.notifications);
    await pool.end();
    console.log(`\nDUMMY-001 petty cash put back as it was.`);
  }
  console.log(`\n✅ ${checks} checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

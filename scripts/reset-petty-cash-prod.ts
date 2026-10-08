// scripts/reset-petty-cash-prod.ts
//
// Wipe ALL petty cash activity on PRODUCTION and start fresh:
//
//   npm run db:reset-petty-cash:prod                       # look only (default): counts + what would be lost
//   npm run db:reset-petty-cash:prod -- --apply            # back up, confirm by typing the DB name, wipe + restart
//   npm run db:reset-petty-cash:prod -- --apply --confirm=<database-name>   # same, without a terminal prompt
//
// Deleted:   petty_cash_transactions (requests), petty_cash_refill_requests,
//            petty_cash_refills (legacy month-end), petty_cash_periods, and the
//            notifications about refill requests (they would point at nothing).
// Recreated: for every ACTIVE store, one period for this Jakarta month at the full
//            float (Rp 1.000.000), and stores.petty_cash_balance (legacy column)
//            set to the same. ready_to_open / close stores get nothing — as in the
//            app, ready_to_open is provisioned when IT activates the store.
// Untouched: categories, users, stores, receipt photos already uploaded to NOS
//            (they just stop being referenced).
//
// Safety: it only ever uses PRODUCTION_DATABASE_URL (never staging). It looks
// only unless you pass --apply. Every run writes a JSON backup of the rows it
// would delete to backups/ (git-ignored) BEFORE changing anything; applying
// needs the database name typed back, happens in ONE transaction, and rolls back
// unless the result checks out (tables empty, one fresh period per active store).

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Pool } from 'pg';
import { describeTarget, parseTarget } from './lib/db-target';

const FLOAT = 1_000_000; // PETTY_CASH_MAX_BALANCE (lib/db/schema/petty-cash.ts)
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CONFIRM = args.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);

const TABLES = ['petty_cash_transactions', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_periods'] as const;

const line = () => console.log('─'.repeat(64));
const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

/** Today's YYYY-MM in Jakarta, whatever zone this machine is in. */
function jakartaMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7);
}

async function confirmByTyping(expected: string): Promise<boolean> {
  if (CONFIRM !== undefined) return CONFIRM === expected;
  if (!process.stdin.isTTY) die(`No terminal to confirm in. Re-run with --confirm=${expected} if you really mean it.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`Type the production database name (${expected}) to WIPE petty cash — Enter alone cancels: `, resolve),
  );
  rl.close();
  return answer.trim() === expected;
}

async function main() {
  const url = process.env.PRODUCTION_DATABASE_URL;
  if (!url) die('PRODUCTION_DATABASE_URL is not set in .env.local.');
  const target = parseTarget(url as string);

  console.log(APPLY ? '🧨 RESET petty cash on PRODUCTION' : '🔍 LOOK ONLY — nothing will be changed (add --apply to wipe)');
  line();
  console.log(`production : ${describeTarget(url as string)}`);
  line();

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000, max: 2 });
  try {
    const month = jakartaMonth();

    // ── What is there ───────────────────────────────────────────────────────
    const counts: Record<string, number> = {};
    for (const t of TABLES) counts[t] = Number((await pool.query(`select count(*)::int n from ${t}`)).rows[0].n);

    const txByStatus = (await pool.query(`select status, count(*)::int n, coalesce(sum(coalesce(actual_amount, amount)),0)::bigint total from petty_cash_transactions group by status order by status`)).rows;
    const refillByStatus = (await pool.query(`select status, count(*)::int n, count(balance_after)::int received from petty_cash_refill_requests group by status order by status`)).rows;
    const notifs = Number((await pool.query(`select count(*)::int n from notifications where type like 'petty\\_cash\\_%' escape '\\'`)).rows[0].n);
    const stores = (await pool.query(`select id, store_no, name, status from stores order by store_no`)).rows as { id: number; store_no: string; name: string; status: string }[];
    const active = stores.filter((s) => s.status === 'active');

    console.log('rows that will be DELETED');
    for (const t of TABLES) console.log(`  ${t.padEnd(30)} ${String(counts[t]).padStart(6)}`);
    console.log(`  ${'notifications (petty_cash_*)'.padEnd(30)} ${String(notifs).padStart(6)}`);

    if (txByStatus.length) {
      console.log('\nrequests by status');
      for (const r of txByStatus) console.log(`  ${String(r.status).padEnd(14)} ${String(r.n).padStart(5)}   Rp ${Number(r.total).toLocaleString('id-ID')}`);
    }
    if (refillByStatus.length) {
      console.log('\nrefill requests by status');
      for (const r of refillByStatus) console.log(`  ${String(r.status).padEnd(14)} ${String(r.n).padStart(5)}   (${r.received} already received by the store)`);
    }
    const inFlight = txByStatus.filter((r) => r.status === 'pending_ops' || r.status === 'ops_approved').reduce((a, r) => a + r.n, 0);
    const openRefills = refillByStatus.filter((r) => r.status === 'pending' || (r.status === 'approved' && r.received < r.n)).reduce((a, r) => a + r.n, 0);
    if (inFlight || openRefills) {
      console.log(`\n⚠️  still in flight and would be lost: ${inFlight} request(s) not yet completed, ${openRefills} refill request(s) not yet received`);
    }

    console.log(`\nwill be CREATED: ${active.length} fresh period(s) for ${month} at Rp ${FLOAT.toLocaleString('id-ID')} (active stores of ${stores.length})`);

    // ── Backup (always, even when only looking) ─────────────────────────────
    const dir = path.resolve(process.cwd(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `petty-cash-reset-${target.database}-${stamp}.json`);
    const backup: Record<string, unknown> = { takenAt: new Date().toISOString(), database: target.database };
    for (const t of TABLES) backup[t] = (await pool.query(`select * from ${t} order by id`)).rows;
    backup.notifications = (await pool.query(`select * from notifications where type like 'petty\\_cash\\_%' escape '\\' order by id`)).rows;
    backup.storesPettyCashBalance = (await pool.query(`select id, store_no, petty_cash_balance from stores order by id`)).rows;
    fs.writeFileSync(file, JSON.stringify(backup, null, 1));
    console.log(`\n💾 backup written: ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);

    if (!APPLY) {
      console.log('\n🔍 Look-only run complete — nothing was changed.');
      return;
    }

    // ── Confirm + apply ─────────────────────────────────────────────────────
    console.log('\nThis permanently deletes the rows above from the LIVE database (the JSON backup is your way back).');
    if (!(await confirmByTyping(target.database))) die('Cancelled. Nothing was changed.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query(`SET LOCAL statement_timeout = '2min'`);

      // Children before parents (a transaction's period_id points at a period).
      await client.query('delete from petty_cash_transactions');
      await client.query('delete from petty_cash_refill_requests');
      await client.query('delete from petty_cash_refills');
      await client.query('delete from petty_cash_periods');
      await client.query(`delete from notifications where type like 'petty\\_cash\\_%' escape '\\'`);

      // Fresh start: one full period for this month per active store. Timestamps are
      // explicit (the app's convention) rather than DEFAULT NOW(), which reads back 7h off.
      const now = new Date();
      for (const s of active) {
        await client.query(
          `insert into petty_cash_periods (store_id, year_month, opening_balance, current_balance, status, created_at, updated_at)
           values ($1, $2, $3, $3, 'open', $4, $4)`,
          [s.id, month, FLOAT, now],
        );
      }
      if (active.length) {
        await client.query(`update stores set petty_cash_balance = $1 where id = any($2)`, [FLOAT, active.map((s) => s.id)]);
      }

      // The result must be exactly what was promised, or nothing happens.
      for (const t of TABLES.filter((x) => x !== 'petty_cash_periods')) {
        const n = Number((await client.query(`select count(*)::int n from ${t}`)).rows[0].n);
        if (n !== 0) throw new Error(`${t} still has ${n} rows`);
      }
      const periods = (await client.query(`select count(*)::int n, count(*) filter (where current_balance = $1 and year_month = $2 and status = 'open')::int fresh from petty_cash_periods`, [FLOAT, month])).rows[0];
      if (periods.n !== active.length || periods.fresh !== active.length) {
        throw new Error(`expected ${active.length} fresh periods, found ${periods.n} (${periods.fresh} fresh)`);
      }

      await client.query('COMMIT');
      console.log(`\n✅ Done. Petty cash on ${target.database} is fresh: ${active.length} stores start ${month} at Rp ${FLOAT.toLocaleString('id-ID')}.`);
      console.log(`   Backup: ${path.relative(process.cwd(), file)}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      die(`${err instanceof Error ? err.message : String(err)}\n\n   Rolled back — production petty cash is exactly as it was.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

// scripts/reset-petty-cash-all.ts
//
// Reset the petty cash USAGE of EVERY store — requests, refills, periods — and start fresh.
// It is the all-stores version of IT's "Reset Petty Cash ▸ all periods" page.
//
//   npm run db:reset-petty-cash                        # look only (staging = DATABASE_URL): counts, what would be lost
//   npm run db:reset-petty-cash -- --apply             # back up, confirm by typing the DB name, wipe + restart
//   npm run db:reset-petty-cash -- --apply --confirm=<database-name>   # same, without a terminal prompt
//
//   npm run db:reset-petty-cash:prod                   # same three forms against PRODUCTION_DATABASE_URL
//   npm run db:reset-petty-cash:prod -- --apply
//   (= `tsx scripts/reset-petty-cash-all.ts --prod …`)
//
// DELETED   petty_cash_transactions (requests), petty_cash_refill_requests, petty_cash_refills (legacy month-end),
//           petty_cash_periods, and the notifications about them (they would point at nothing).
// CREATED   for every ACTIVE store one open period at the full float (Rp 1.000.000) — the period of TODAY'S
//           Jakarta date: a period is named after the month it ENDS in and runs from the 16th of the month before
//           to the 15th, so from the 16th it is already next month's (`usagePeriodFor`, lib/petty-cash-period.ts) —
//           and stores.petty_cash_balance (legacy column) = the same. ready_to_open / close stores get no period:
//           the app provisions it when IT activates the store.
// UNTOUCHED categories, users, stores, Finance's verified Berita Acara snapshots (audit_cash_checks), and the
//           receipt / proof photos already in object storage (petty cash photos are never deleted — they just
//           stop being referenced, same as IT's reset).
//
// SAFETY    Looks only unless you pass --apply. Without --prod it uses DATABASE_URL and REFUSES to run if that
//           is the production database (use --prod, deliberately). Every run — even look-only — writes a JSON
//           backup of every row it would delete to backups/ (git-ignored) BEFORE changing anything. Applying needs
//           the database name typed back, locks every period (a PIC filing a request at that moment waits), runs
//           in ONE transaction and rolls back unless the result checks out (tables empty, exactly one fresh period
//           per active store, none for the rest).
//
// RESTORE   The backup is snake_case rows, one array per table. Per table, inside a transaction:
//             insert into petty_cash_periods select * from json_populate_recordset(null::petty_cash_periods, '<array>');
//           (periods first, then transactions / refill_requests / refills / notifications; delete the fresh
//           periods the reset created before re-inserting the old ones, and fix the id sequences afterwards).

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Pool } from 'pg';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { periodRangeLabel, usagePeriodFor } from '@/lib/petty-cash-period';
import { describeTarget, parseTarget, sameDatabase } from './lib/db-target';

const FLOAT = 1_000_000; // PETTY_CASH_MAX_BALANCE (lib/db/schema/petty-cash.ts)
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
const CONFIRM = args.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);

const TABLES = ['petty_cash_transactions', 'petty_cash_refill_requests', 'petty_cash_refills', 'petty_cash_periods'] as const;

// Every notification about petty cash: by type, and by the row it names (Ops / Finance / IT ones included).
const NOTIF_WHERE = `(type like 'petty\\_cash\\_%' escape '\\'
  or related_type in ('petty_cash_transaction', 'petty_cash_refill_request', 'petty_cash_refill'))`;

const line = () => console.log('─'.repeat(64));
const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

async function confirmByTyping(expected: string): Promise<boolean> {
  if (CONFIRM !== undefined) return CONFIRM === expected;
  if (!process.stdin.isTTY) die(`No terminal to confirm in. Re-run with --confirm=${expected} if you really mean it.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`Type the database name (${expected}) to WIPE petty cash of ALL stores — Enter alone cancels: `, resolve),
  );
  rl.close();
  return answer.trim() === expected;
}

/** The database this run is about: production only with --prod, otherwise the staging/dev DATABASE_URL. */
function resolveUrl(): string {
  const staging = process.env.DATABASE_URL;
  const production = process.env.PRODUCTION_DATABASE_URL;

  if (PROD) {
    if (!production) die('--prod needs PRODUCTION_DATABASE_URL in .env.local.');
    return production as string;
  }
  if (!staging) die('DATABASE_URL is not set in .env.local.');
  if (process.env.NODE_ENV === 'production' || (production && sameDatabase(staging as string, production))) {
    die(
      `DATABASE_URL points at PRODUCTION (${describeTarget(staging as string)}).\n` +
        '   This resets every store. Use `npm run db:reset-petty-cash:prod` (--prod) if production is what you mean,\n' +
        '   or point DATABASE_URL at staging.',
    );
  }
  return staging as string;
}

async function main() {
  const url = resolveUrl();
  const target = parseTarget(url);

  console.log(APPLY ? '🧨 RESET petty cash of ALL stores' : '🔍 LOOK ONLY — nothing will be changed (add --apply to wipe)');
  line();
  console.log(`${PROD ? 'PRODUCTION' : 'database  '} : ${describeTarget(url)}`);
  line();

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000, max: 2 });
  try {
    const dbName = String((await pool.query('select current_database() d')).rows[0].d);
    const period = usagePeriodFor(jakartaTodayKey());

    // ── What is there ───────────────────────────────────────────────────────
    const counts: Record<string, number> = {};
    for (const t of TABLES) counts[t] = Number((await pool.query(`select count(*)::int n from ${t}`)).rows[0].n);

    const txByStatus = (
      await pool.query(
        `select status, count(*)::int n, coalesce(sum(coalesce(actual_amount, amount)),0)::bigint total
           from petty_cash_transactions group by status order by status`,
      )
    ).rows;
    const refillByStatus = (
      await pool.query(
        `select status, count(*)::int n, count(balance_after)::int received
           from petty_cash_refill_requests group by status order by status`,
      )
    ).rows;
    const notifs = Number((await pool.query(`select count(*)::int n from notifications where ${NOTIF_WHERE}`)).rows[0].n);
    const stores = (await pool.query(`select id, store_no, name, status from stores order by store_no`)).rows as {
      id: number;
      store_no: string;
      name: string;
      status: string;
    }[];
    const active = stores.filter((s) => s.status === 'active');

    console.log('rows that will be DELETED');
    for (const t of TABLES) console.log(`  ${t.padEnd(30)} ${String(counts[t]).padStart(6)}`);
    console.log(`  ${'notifications (petty cash)'.padEnd(30)} ${String(notifs).padStart(6)}`);

    if (txByStatus.length) {
      console.log('\nrequests by status');
      for (const r of txByStatus) {
        console.log(`  ${String(r.status).padEnd(14)} ${String(r.n).padStart(5)}   Rp ${Number(r.total).toLocaleString('id-ID')}`);
      }
    }
    if (refillByStatus.length) {
      console.log('\nrefill requests by status');
      for (const r of refillByStatus) {
        console.log(`  ${String(r.status).padEnd(14)} ${String(r.n).padStart(5)}   (${r.received} already received by the store)`);
      }
    }
    const inFlight = txByStatus
      .filter((r) => ['draft', 'pending_ops', 'ops_approved'].includes(r.status))
      .reduce((a, r) => a + r.n, 0);
    const openRefills = refillByStatus
      .filter((r) => r.status === 'pending' || (r.status === 'approved' && r.received < r.n))
      .reduce((a, r) => a + r.n, 0);
    if (inFlight || openRefills) {
      console.log(
        `\n⚠️  still in flight and would be lost: ${inFlight} request(s) not yet completed, ${openRefills} refill request(s) not yet received`,
      );
    }

    console.log(
      `\nwill be CREATED: ${active.length} fresh period(s) — ${period} (${periodRangeLabel(period)}) at Rp ${FLOAT.toLocaleString('id-ID')}` +
        ` for the active stores (of ${stores.length}; the other ${stores.length - active.length} get none)`,
    );

    // ── Backup (always, even when only looking) ─────────────────────────────
    const dir = path.resolve(process.cwd(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `petty-cash-reset-all-${dbName}-${stamp}.json`);
    const backup: Record<string, unknown> = { takenAt: new Date().toISOString(), database: dbName };
    for (const t of TABLES) backup[t] = (await pool.query(`select * from ${t} order by id`)).rows;
    backup.notifications = (await pool.query(`select * from notifications where ${NOTIF_WHERE} order by id`)).rows;
    backup.storesPettyCashBalance = (await pool.query(`select id, store_no, petty_cash_balance from stores order by id`)).rows;
    fs.writeFileSync(file, JSON.stringify(backup, null, 1));
    console.log(`\n💾 backup written: ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);

    if (!APPLY) {
      console.log('\n🔍 Look-only run complete — nothing was changed.');
      return;
    }

    // ── Confirm + apply ─────────────────────────────────────────────────────
    console.log(`\nThis permanently deletes the rows above from ${PROD ? 'the LIVE PRODUCTION database' : 'this database'} (the JSON backup is your way back).`);
    if (!(await confirmByTyping(dbName))) die('Cancelled. Nothing was changed.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query(`SET LOCAL statement_timeout = '2min'`);

      // A PIC filing a request updates its store's period — lock them all so that waits until we commit.
      await client.query('select id from petty_cash_periods for update');

      // Notifications first (they name the rows), then children before parents (a request points at a period).
      await client.query(`delete from notifications where ${NOTIF_WHERE}`);
      await client.query('delete from petty_cash_transactions');
      await client.query('delete from petty_cash_refill_requests');
      await client.query('delete from petty_cash_refills');
      await client.query('delete from petty_cash_periods');

      // Fresh start: one full period of today's date per active store. Timestamps are explicit (the app's
      // convention) rather than DEFAULT NOW(), which reads back 7h off through Drizzle.
      const now = new Date();
      for (const s of active) {
        await client.query(
          `insert into petty_cash_periods (store_id, year_month, opening_balance, current_balance, status, created_at, updated_at)
           values ($1, $2, $3, $3, 'open', $4, $4)`,
          [s.id, period, FLOAT, now],
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
      const left = Number((await client.query(`select count(*)::int n from notifications where ${NOTIF_WHERE}`)).rows[0].n);
      if (left !== 0) throw new Error(`${left} petty cash notification(s) are still there`);

      const periods = (
        await client.query(
          `select count(*)::int n,
                  count(*) filter (where current_balance = $1 and opening_balance = $1 and year_month = $2 and status = 'open')::int fresh,
                  count(distinct store_id)::int stores
             from petty_cash_periods`,
          [FLOAT, period],
        )
      ).rows[0];
      if (periods.n !== active.length || periods.fresh !== active.length || periods.stores !== active.length) {
        throw new Error(`expected ${active.length} fresh periods (one per active store), found ${periods.n} (${periods.fresh} fresh, ${periods.stores} stores)`);
      }

      await client.query('COMMIT');
      console.log(`\n✅ Done. Petty cash on ${dbName} is fresh: ${active.length} active stores start period ${period} at Rp ${FLOAT.toLocaleString('id-ID')}, no requests, no refills.`);
      console.log(`   Backup: ${path.relative(process.cwd(), file)}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      die(`${err instanceof Error ? err.message : String(err)}\n\n   Rolled back — petty cash is exactly as it was.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

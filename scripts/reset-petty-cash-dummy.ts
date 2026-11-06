// scripts/reset-petty-cash-dummy.ts
//
// Reset petty cash for the DUMMY test store ONLY (default DUMMY-001), on whatever
// database DATABASE_URL points at (staging normally):
//
//   npx dotenv -e .env.local -- tsx scripts/reset-petty-cash-dummy.ts            # look only
//   npx dotenv -e .env.local -- tsx scripts/reset-petty-cash-dummy.ts --apply    # wipe + restart
//   ... --store=DUMMY-001                                                         # another store code
//
// Deleted (for that store): petty_cash_transactions, petty_cash_refill_requests,
//   petty_cash_refills, petty_cash_periods, and petty_cash_* notifications of
//   that store's own users.
// Recreated: one open period for this Jakarta month at Rp 1.000.000, and
//   stores.petty_cash_balance (legacy column) = Rp 1.000.000.
// Refuses any store that is not a DUMMY* store. Runs in one transaction.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { Pool } from 'pg';
import { describeTarget } from './lib/db-target';

const FLOAT = 1_000_000;
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STORE_NO = args.find((a) => a.startsWith('--store='))?.slice('--store='.length) ?? 'DUMMY-001';

const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

const jakartaMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) die('DATABASE_URL is not set.');
  if (!/^DUMMY/i.test(STORE_NO)) die(`Refusing: ${STORE_NO} is not a DUMMY store.`);

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000, max: 2 });
  try {
    const db = (await pool.query('select current_database() d')).rows[0].d as string;
    console.log(APPLY ? '🧨 RESET petty cash (dummy store)' : '🔍 LOOK ONLY — add --apply to wipe');
    console.log(`database : ${describeTarget(url as string)}  (current_database = ${db})`);

    const store = (await pool.query('select id, store_no, name, status from stores where store_no = $1', [STORE_NO])).rows[0];
    if (!store) die(`Store ${STORE_NO} not found.`);
    console.log(`store    : ${store.store_no} — ${store.name} (id ${store.id}, ${store.status})`);

    const count = async (sql: string) => Number((await pool.query(sql, [store.id])).rows[0].n);
    const n = {
      tx: await count('select count(*)::int n from petty_cash_transactions where store_id = $1'),
      refillReq: await count('select count(*)::int n from petty_cash_refill_requests where store_id = $1'),
      refills: await count('select count(*)::int n from petty_cash_refills where store_id = $1'),
      periods: await count('select count(*)::int n from petty_cash_periods where store_id = $1'),
      notifs: await count(
        `select count(*)::int n from notifications where type like 'petty\\_cash\\_%' escape '\\'
           and user_id in (select id from users where home_store_id = $1)`,
      ),
    };
    console.log('\nrows to DELETE', n);
    const month = jakartaMonth();
    console.log(`will CREATE : 1 open period ${month} at Rp ${FLOAT.toLocaleString('id-ID')}`);

    if (!APPLY) return console.log('\n🔍 Nothing changed.');

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('delete from petty_cash_transactions where store_id = $1', [store.id]);
      await c.query('delete from petty_cash_refill_requests where store_id = $1', [store.id]);
      await c.query('delete from petty_cash_refills where store_id = $1', [store.id]);
      await c.query('delete from petty_cash_periods where store_id = $1', [store.id]);
      await c.query(
        `delete from notifications where type like 'petty\\_cash\\_%' escape '\\'
           and user_id in (select id from users where home_store_id = $1)`,
        [store.id],
      );
      const now = new Date();
      await c.query(
        `insert into petty_cash_periods (store_id, year_month, opening_balance, current_balance, status, created_at, updated_at)
         values ($1, $2, $3, $3, 'open', $4, $4)`,
        [store.id, month, FLOAT, now],
      );
      await c.query('update stores set petty_cash_balance = $1 where id = $2', [FLOAT, store.id]);
      await c.query('COMMIT');
      console.log(`\n✅ Done. ${store.store_no} starts ${month} at Rp ${FLOAT.toLocaleString('id-ID')}, no requests.`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      die(`${e instanceof Error ? e.message : String(e)} — rolled back.`);
    } finally {
      c.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

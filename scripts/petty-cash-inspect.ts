// scripts/petty-cash-inspect.ts
//
// READ-ONLY look at the petty cash periods + refill requests of every store, for the Oct/Nov 2026 clean-up.
//
//   npx tsx scripts/petty-cash-inspect.ts [--from=2026-09] [--store=SS003] [--json=<file>]
//
// Reads DATABASE_URL (.env.local). Everything runs inside a READ ONLY transaction, so it cannot change anything
// — on staging or production alike. It prints which database it is looking at first.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import fs from 'node:fs';
import { Pool } from 'pg';
import { describeTarget } from './lib/db-target';

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const FROM = arg('from') ?? '2026-09';
const ONLY_STORE = arg('store');
const JSON_OUT = arg('json');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;

    const [{ db, now }] = await q(`select current_database() db, now()::text now`);
    console.log(`database : ${describeTarget(url)}  (current_database() = ${db})`);
    console.log(`db clock : ${now}`);

    const storeFilter = ONLY_STORE ? `and s.store_no = $2` : '';
    const params: unknown[] = ONLY_STORE ? [FROM, ONLY_STORE] : [FROM];

    const periods = await q(
      `select p.id, s.store_no, s.name store_name, s.status store_status, p.year_month, p.status, p.opening_balance::float opening,
              p.current_balance::float balance, p.closing_balance::float closing, p.closed_at::text closed_at, p.created_at::text created_at
         from petty_cash_periods p join stores s on s.id = p.store_id
        where p.year_month >= $1 ${storeFilter}
        order by s.store_no, p.year_month`,
      params,
    );

    const refills = await q(
      `select r.id, s.store_no, r.year_month, r.status, r.requested_at::text requested_at, r.approved_at::text approved_at,
              r.finance_verified_at::text verified_at, r.transfer_amount::float transfer_amount, r.balance_before::float balance_before,
              r.balance_after::float balance_after, r.rejected_at::text rejected_at, r.rejection_reason,
              (r.drawer_photo_url is not null) drawer, (r.signature_photo_url is not null) signature, r.proof_uploaded_at::text proof_at,
              r.rejected_count, r.rejected_amount::float rejected_amount
         from petty_cash_refill_requests r join stores s on s.id = r.store_id
        where r.year_month >= $1 ${storeFilter}
        order by s.store_no, r.year_month, r.requested_at`,
      params,
    );

    const monthEnd = await q(
      `select r.id, s.store_no, r.year_month, r.next_year_month, r.refill_amount::float refill_amount, r.balance_before::float balance_before,
              r.created_at::text created_at
         from petty_cash_refills r join stores s on s.id = r.store_id
        where r.year_month >= $1 ${storeFilter}
        order by s.store_no, r.year_month`,
      params,
    );

    const txs = await q(
      `select s.store_no, t.year_month, t.status, coalesce(t.finance_review,'-') finance_review, t.is_re_request,
              count(*)::int n, coalesce(sum(case when t.status='completed' then coalesce(t.actual_amount, t.amount) else 0 end),0)::float completed_sum,
              min(t.period_id) min_period_id, max(t.period_id) max_period_id,
              min(t.created_at)::text first_created, max(t.created_at)::text last_created
         from petty_cash_transactions t join stores s on s.id = t.store_id
        where t.year_month >= $1 ${storeFilter}
        group by s.store_no, t.year_month, t.status, t.finance_review, t.is_re_request
        order by s.store_no, t.year_month, t.status`,
      params,
    );

    const orphanTx = await q(
      `select s.store_no, t.id, t.year_month, t.status, t.period_id, p.year_month period_month, t.created_at::text created_at
         from petty_cash_transactions t join stores s on s.id = t.store_id
         left join petty_cash_periods p on p.id = t.period_id
        where t.year_month >= $1 ${storeFilter} and (t.period_id is null or p.year_month is distinct from t.year_month)
        order by s.store_no, t.id`,
      params,
    );

    const activeNoPeriod = await q(
      `select s.store_no, s.name, s.status from stores s
        where s.status = 'active' ${ONLY_STORE ? 'and s.store_no = $1' : ''}
          and not exists (select 1 from petty_cash_periods p where p.store_id = s.id and p.year_month >= '2026-10')
        order by s.store_no`,
      ONLY_STORE ? [ONLY_STORE] : [],
    );

    // Every request row (not only the groups) — for working out which period each one belongs to.
    const txRows = await q(
      `select t.id, s.store_no, t.period_id, t.year_month, t.status, t.finance_review, t.is_re_request, t.re_request_of_id,
              t.amount::float amount, t.actual_amount::float actual_amount,
              t.created_at::text created_at, t.approved_at::text approved_at, t.actual_amount_at::text actual_amount_at,
              t.request_date::text request_date, t.updated_at::text updated_at
         from petty_cash_transactions t join stores s on s.id = t.store_id
        where t.year_month >= $1 ${storeFilter}
        order by s.store_no, t.id`,
      params,
    );

    const out = { database: db, takenAt: now, from: FROM, periods, refills, monthEnd, txs, txRows, orphanTx, activeNoPeriod };
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));

    console.log(`\nperiods ${periods.length}, refill requests ${refills.length}, month-end refills ${monthEnd.length}, tx groups ${txs.length}, mismatched tx ${orphanTx.length}, active stores w/o Oct+ period ${activeNoPeriod.length}`);
    await client.query('ROLLBACK');
    return out;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

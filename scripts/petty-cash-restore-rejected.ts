// scripts/petty-cash-restore-rejected.ts
//
// One-off for requests Finance rejected BEFORE "a rejected request is not counted as used" shipped.
// Back then the period's balance kept the rejected amount deducted; now it is given back while the
// rejection stands (rejected or corrected-not-yet-accepted) — see lib/db/utils/petty-cash-review.ts.
// This adds the amount back to each open period once, so old rows match the new rule.
//
//   npx tsx scripts/petty-cash-restore-rejected.ts           # preview
//   npx tsx scripts/petty-cash-restore-rejected.ts --apply   # write
//
// Run it ONCE per database (it cannot tell an already-restored row from an old one). Refuses
// production: migration 0038 isn't there yet, so no request can be rejected there.

import './lib/not-production';

import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const MAX = 1_000_000;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query<{
    id: number;
    store_id: number;
    period_id: number;
    amount: string;
    finance_review: string;
    current_balance: string;
    year_month: string;
  }>(`
    SELECT t.id, t.store_id, t.period_id, COALESCE(t.actual_amount, t.amount) AS amount, t.finance_review,
           p.current_balance, p.year_month
      FROM petty_cash_transactions t
      JOIN petty_cash_periods p ON p.id = t.period_id AND p.status = 'open'
     WHERE t.status = 'completed' AND t.finance_review IN ('rejected', 'resubmitted')
     ORDER BY t.id
  `);

  if (rows.length === 0) {
    console.log('Nothing to restore.');
    await client.end();
    return;
  }

  for (const r of rows) {
    console.log(`#${r.id} store ${r.store_id} ${r.year_month} ${r.finance_review}: +${Number(r.amount).toLocaleString('id-ID')} (balance ${Number(r.current_balance).toLocaleString('id-ID')})`);
    if (APPLY) {
      await client.query(
        `UPDATE petty_cash_periods
            SET current_balance = LEAST($2::numeric, current_balance + $3::numeric), updated_at = now()
          WHERE id = $1`,
        [r.period_id, MAX, r.amount],
      );
    }
  }

  console.log(APPLY ? `\nRestored ${rows.length} request(s).` : `\n${rows.length} request(s) would be restored. Re-run with --apply.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

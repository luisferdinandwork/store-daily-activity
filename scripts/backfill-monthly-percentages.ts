// scripts/backfill-monthly-percentages.ts
//
// One-off backfill for the monthly-fixed-percentage redesign: the new
// `employee_monthly_targets.percentage` column defaults to 0 for rows that
// existed before this migration. This walks every distinct (storeId,
// yearMonth) currently on the roster and runs syncRosterPercentages() so
// each row gets its default-template percentage (or stays overridden if it
// already was, which pre-migration rows never are).

import { config } from 'dotenv';
config({ path: '.env.local' });

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { employeeMonthlyTargets } from '@/lib/db/schema';
import { syncRosterPercentages } from '@/lib/performance/target-utils';

async function main() {
  const rows = await db
    .selectDistinct({
      storeId: employeeMonthlyTargets.storeId,
      yearMonth: employeeMonthlyTargets.yearMonth,
    })
    .from(employeeMonthlyTargets)
    .where(eq(employeeMonthlyTargets.isActive, true));

  console.log(`Backfilling percentages for ${rows.length} store/month roster(s)...`);

  for (const row of rows) {
    const meta = await syncRosterPercentages({ storeId: row.storeId, yearMonth: row.yearMonth });
    console.log(
      `  store ${row.storeId} / ${row.yearMonth}: headcount=${meta.headcount}` +
        (meta.usedFallbackEqualSplit ? ' (fallback equal split — no template row)' : ''),
    );
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

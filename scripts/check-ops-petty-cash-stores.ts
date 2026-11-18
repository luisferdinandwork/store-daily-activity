// scripts/check-ops-petty-cash-stores.ts
//
// Read-only check: Ops · Petty Cash · Stores works out every store's cash in one batch
// (lib/db/utils/petty-cash-ops-stores.ts). This compares that, store by store, with the employee side's own
// per-store helpers (getRefillOutstanding / getRefillReceivedWithin — both read-only) for the same period, and
// the period in use with usageMonthOf + latestRefilledMonth. Writes nothing.
//
//   npx dotenv -e .env.local -- tsx scripts/check-ops-petty-cash-stores.ts

import { eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { pettyCashPeriods } from '@/lib/db/schema';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { getOpsPettyCashStores } from '@/lib/db/utils/petty-cash-ops-stores';
import { latestRefilledMonth, usageMonthOf } from '@/lib/db/utils/petty-cash-period';
import { getRefillOutstanding, getRefillReceivedWithin } from '@/lib/db/utils/petty-cash-refill';

async function main() {
  const [{ name }] = (await db.execute(sql`select current_database() as name`)).rows as { name: string }[];
  console.log(`DB: ${name}`);

  const today = jakartaTodayKey();
  const rows = await getOpsPettyCashStores({ areaId: null, today });
  let bad = 0;

  for (const r of rows) {
    const periods = await db.select().from(pettyCashPeriods).where(eq(pettyCashPeriods.storeId, r.storeId));
    const usage = usageMonthOf(periods, today, await latestRefilledMonth(r.storeId));
    const owed = await getRefillOutstanding(r.storeId, usage);
    const received = await getRefillReceivedWithin(r.storeId, usage);
    const period = periods.find((p) => p.yearMonth === usage);
    const balance = period ? Math.round(Number(period.currentBalance)) : 1_000_000;
    const spendable = Math.max(0, balance + received - owed);

    const ok = usage === r.periodMonth && owed === r.owed && spendable === r.spendable;
    if (!ok) {
      bad += 1;
      console.log(`MISMATCH ${r.storeNo}: page ${r.periodMonth} owed ${r.owed} cash ${r.spendable} · helpers ${usage} owed ${owed} cash ${spendable}`);
    }
  }

  console.log(`${rows.length} stores checked, ${bad} mismatch(es).`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// scripts/seed/store-dept-codes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Stamps the Business Central department dimension code (lib/store-dept-codes.ts,
// from "Dimension Values.xlsx") onto matching stores.
//
//   npm run db:seed -- --only=store-dept-codes
//   STORE_DEPT_DRY=1 npm run db:seed -- --only=store-dept-codes     # plan only, no writes
//
// • Match is by store code: SALES-02-01-001 → FS001 (see storeNoFromDeptCode).
// • Only EXISTING stores are touched — a dimension with no PRISM store yet is
//   listed in the report, never created (a store needs an area + address that
//   this sheet doesn't have). Create it in IT → Stores and re-run.
// • A BC-blocked dimension moves its store to `close` (through
//   changeStoreStatus, so the history row is written). Nothing is ever
//   re-opened by this script.
// • Idempotent — re-running only changes what differs.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { changeStoreStatus } from '@/lib/db/utils/store-status';
import { DEPT_CODE_ROWS, storeNoFromDeptCode } from '@/lib/store-dept-codes';

export async function seedStoreDeptCodes() {
  const dry = process.env.STORE_DEPT_DRY === '1';
  const storeRows = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, deptCode: stores.deptCode, status: stores.status })
    .from(stores);
  const byStoreNo = new Map(storeRows.map((s) => [s.storeNo.toUpperCase(), s]));

  const matched = new Set<string>();
  const unmatched: string[] = [];
  let stamped = 0;
  let closed = 0;

  for (const row of DEPT_CODE_ROWS) {
    const storeNo = storeNoFromDeptCode(row.code);
    const store = storeNo ? byStoreNo.get(storeNo) : undefined;

    if (!storeNo || !store) {
      unmatched.push(`${row.code}  ${row.name || '(no name)'}${storeNo ? `  → ${storeNo}` : ''}${row.blocked ? '  [blocked]' : ''}`);
      continue;
    }
    matched.add(store.storeNo);

    if (store.deptCode !== row.code) {
      console.log(`    ${dry ? '[dry] ' : ''}${store.storeNo}  dept code → ${row.code}   (${store.name})`);
      if (!dry) await db.update(stores).set({ deptCode: row.code, updatedAt: new Date() }).where(eq(stores.id, store.id));
      stamped++;
    }

    if (row.blocked && store.status !== 'close') {
      console.log(`    ${dry ? '[dry] ' : ''}${store.storeNo}  blocked in BC → status close`);
      if (!dry) {
        const res = await changeStoreStatus({
          storeId: store.id,
          to: 'close',
          actorId: null,
          note: 'Blocked in Business Central dimension values',
        });
        if (!res.success) console.warn(`    ! ${store.storeNo}: ${res.error}`);
      }
      closed++;
    }
  }

  const withoutCode = storeRows.filter((s) => !matched.has(s.storeNo));

  console.log(`    ${matched.size}/${DEPT_CODE_ROWS.length} dimensions matched a store · ${stamped} dept code(s) written · ${closed} store(s) closed${dry ? '  (DRY RUN)' : ''}`);
  if (unmatched.length) {
    console.log(`    ${unmatched.length} dimension(s) have no PRISM store yet:`);
    for (const line of unmatched) console.log(`      - ${line}`);
  }
  if (withoutCode.length) {
    console.log(`    ${withoutCode.length} store(s) with no dimension: ${withoutCode.map((s) => s.storeNo).join(', ')}`);
  }
}

// Allow `npx dotenv -e .env.local -- tsx scripts/seed/store-dept-codes.ts` directly.
if (process.argv[1] && /store-dept-codes\.[tj]s$/.test(process.argv[1])) {
  seedStoreDeptCodes().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

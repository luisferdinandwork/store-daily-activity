// scripts/seed/transfer-order-demo.ts
//
// Example Transfer Orders for the DUMMY-001 test store: 2 open Item Return + 2 open Item Receiving,
// so the employee Transfer page and the Ops Transfer Order pages have something to show.
//
//   npx dotenv -e .env.local -- tsx scripts/seed/transfer-order-demo.ts            # preview only
//   npx dotenv -e .env.local -- tsx scripts/seed/transfer-order-demo.ts --apply    # write
//   ... --apply --replace                                                          # redo: remove the earlier demo rows first
//
// Item Return    = a TO leaving DUMMY-001 that its staff hasn't handed to the courier yet
//                  (from_store = DUMMY-001, return_submitted_at NULL).
// Item Receiving = a TO arriving at DUMMY-001 with a Warehouse Shipment its staff hasn't confirmed yet
//                  (to_store = DUMMY-001, whse_shipment_no set, dropping_submitted_at NULL).
//
// All demo TOs are numbered TOA-DUMMY-*. Heads-up: the full Business Central sweep (every 6 h, only where BC
// credentials are set) deletes unconfirmed TOs that BC doesn't know — these fake ones included. Confirm them
// in the app, or just run this again with --replace.
//
// Refuses to run against production (scripts/lib/not-production.ts).

import '../lib/not-production';

import { inArray, like } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  itemDroppingEntries,
  itemReturnEntries,
  itemTransferOrders,
  stores,
  type NewItemTransferOrder,
} from '@/lib/db/schema';

const DUMMY_STORE_NO = 'DUMMY-001';
const DEMO_PREFIX = 'TOA-DUMMY-';

const apply = process.argv.includes('--apply');
const replace = process.argv.includes('--replace');

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function main() {
  const storeRows = await db.select({ id: stores.id, storeNo: stores.storeNo, name: stores.name }).from(stores);
  const byNo = new Map(storeRows.map((s) => [s.storeNo, s]));

  const dummy = byNo.get(DUMMY_STORE_NO);
  if (!dummy) throw new Error(`Store ${DUMMY_STORE_NO} not found — run \`npm run db:seed\` first.`);

  // The other end of each TO: a real seeded store when there is one, else just the BC code (no store row).
  const other1 = byNo.get('FF001');
  const other2 = byNo.get('FO001');
  const code = (s: { storeNo: string } | undefined, fallback: string) => s?.storeNo ?? fallback;

  const today = new Date();

  const rows: NewItemTransferOrder[] = [
    // ── Item Return: leaving DUMMY-001, waiting for its staff to hand it to the courier ─────────────────
    {
      toaNo: `${DEMO_PREFIX}RET-1`,
      transferFromCode: DUMMY_STORE_NO,
      transferToCode: code(other1, 'FF001'),
      fromStoreId: dummy.id,
      toStoreId: other1?.id ?? null,
      qtyOrdered: 12,
      bcStatus: 'Released',
      postingDate: today,
      returnDetectedAt: hoursAgo(3),
    },
    {
      toaNo: `${DEMO_PREFIX}RET-2`,
      transferFromCode: DUMMY_STORE_NO,
      // A central warehouse — not a store we manage, so only the return leg exists.
      transferToCode: 'DM-RETURN',
      fromStoreId: dummy.id,
      toStoreId: null,
      qtyOrdered: 30,
      bcStatus: 'Released',
      postingDate: today,
      returnDetectedAt: hoursAgo(1),
    },

    // ── Item Receiving: arriving at DUMMY-001, waiting for its staff to confirm the drop-off ─────────────
    {
      toaNo: `${DEMO_PREFIX}RCV-1`,
      transferFromCode: code(other1, 'FF001'),
      transferToCode: DUMMY_STORE_NO,
      fromStoreId: other1?.id ?? null,
      toStoreId: dummy.id,
      qtyOrdered: 8,
      bcStatus: 'Released',
      postingDate: today,
      returnDetectedAt: hoursAgo(30),
      returnSubmittedAt: hoursAgo(20),
      whseShipmentNo: 'WSHPT-DUMMY-0001',
      whseShipmentLines: JSON.stringify([
        { itemNo: '1000001', variantCode: '42', description: 'Running Shoes Pegasus', quantity: 5 },
        { itemNo: '1000002', variantCode: 'M', description: 'Dri-FIT Training Tee', quantity: 3 },
      ]),
      droppingDetectedAt: hoursAgo(2),
    },
    {
      toaNo: `${DEMO_PREFIX}RCV-2`,
      transferFromCode: code(other2, 'FO001'),
      transferToCode: DUMMY_STORE_NO,
      fromStoreId: other2?.id ?? null,
      toStoreId: dummy.id,
      qtyOrdered: 6,
      bcStatus: 'Released',
      postingDate: today,
      returnDetectedAt: hoursAgo(28),
      returnSubmittedAt: hoursAgo(18),
      whseShipmentNo: 'WSHPT-DUMMY-0002',
      whseShipmentLines: JSON.stringify([
        { itemNo: '2000001', variantCode: 'ALL', description: 'Sports Backpack 25L', quantity: 4 },
        { itemNo: '2000002', variantCode: 'ALL', description: 'Training Socks 3-Pack', quantity: 2 },
      ]),
      droppingDetectedAt: hoursAgo(1),
    },
  ];

  console.log(`Target store : ${dummy.name} (${DUMMY_STORE_NO}, id ${dummy.id})`);
  for (const r of rows) {
    const leg = r.fromStoreId === dummy.id ? 'Item Return   ' : 'Item Receiving';
    console.log(`  ${leg}  ${r.toaNo}  ${r.transferFromCode} → ${r.transferToCode}  qty ${r.qtyOrdered}`);
  }

  if (!apply) {
    console.log('\nPreview only — nothing written. Add --apply to seed' + (replace ? ' (and --replace is set).' : '.'));
    return;
  }

  if (replace) {
    const old = await db
      .select({ id: itemTransferOrders.id })
      .from(itemTransferOrders)
      .where(like(itemTransferOrders.toaNo, `${DEMO_PREFIX}%`));
    if (old.length) {
      const ids = old.map((o) => o.id);
      // Entries point at the TO without a cascade, so they go first.
      await db.delete(itemReturnEntries).where(inArray(itemReturnEntries.transferOrderId, ids));
      await db.delete(itemDroppingEntries).where(inArray(itemDroppingEntries.transferOrderId, ids));
      await db.delete(itemTransferOrders).where(inArray(itemTransferOrders.id, ids));
      console.log(`\nRemoved ${old.length} earlier demo TO(s).`);
    }
  }

  const inserted = await db
    .insert(itemTransferOrders)
    .values(rows.map((r) => ({ ...r, createdAt: new Date(), updatedAt: new Date() })))
    .onConflictDoNothing({ target: itemTransferOrders.toaNo })
    .returning({ toaNo: itemTransferOrders.toaNo });

  console.log(`\n✅ Seeded ${inserted.length} of ${rows.length} TO(s)` + (inserted.length < rows.length ? ' (the rest already exist — use --replace to redo them).' : '.'));
  console.log('Open the employee Transfer page as a DUMMY-001 user (e.g. DUMMY-PIC1), or Ops → Transfer Order.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit(0));

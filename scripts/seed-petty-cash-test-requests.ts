// scripts/seed-petty-cash-test-requests.ts
//
// A handful of petty cash requests in the period in use of ONE store (default FF001), one per state Finance and
// the employee page show — for trying the Finance tab / Report / employee page by hand. Staging only.
//
//   npx dotenv -e .env.local -- tsx scripts/seed-petty-cash-test-requests.ts            # preview
//   npx dotenv -e .env.local -- tsx scripts/seed-petty-cash-test-requests.ts --apply    # write
//   … --store=FO001                                                                      # another store
//
// What it makes (filed by the store's PIC 1, over the last days):
//   Waiting OPS · Awaiting actual amount · Rejected OPS · Pending Finance · Diterima · Ditolak · Perlu Perbaikan
// The completed ones are cut from the period's balance like a real confirm; Finance's three decisions go through
// the app's own financeAcceptTransaction / financeRejectTransaction, so balances, the draft after Perlu Perbaikan
// and the notifications behave exactly as in the app (a Ditolak before the Refill is sent sends no message).
// Refuses to run twice on the same store + period (looks for its Keterangan texts).

import './lib/not-production';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { pettyCashPeriods, pettyCashTransactions, stores } from '@/lib/db/schema';
import { getActivePeriod } from '@/lib/db/utils/petty-cash-period';
import { listPettyCashCategories } from '@/lib/db/utils/petty-cash-categories';
import {
  financeAcceptTransaction,
  financeRejectTransaction,
  financeUserIds,
} from '@/lib/db/utils/petty-cash-review';

/** Rows of a raw db.execute() result (node-postgres returns { rows }). */
const getRows = (result: unknown): unknown[] =>
  Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);

type Plan = {
  status: 'pending_ops' | 'ops_approved' | 'ops_rejected' | 'completed';
  amount: number;
  category: string;
  description: string;
  daysAgo: number;
  /** Finance's decision on a completed one (none = Pending Finance). */
  finance?: 'accepted' | 'rejected' | 'needs_fix';
  comment?: string;
  rejectionReason?: string;
};

const PLAN: Plan[] = [
  { status: 'pending_ops', amount: 25_000, category: 'STATIONERY & OFFICE SUPPLIES', description: 'BELI PULPEN DAN BUKU NOTA', daysAgo: 0 },
  { status: 'ops_approved', amount: 40_000, category: 'HOUSEKEEPING EXPS / SUPPLIES', description: 'SABUN LANTAI DAN KAIN PEL', daysAgo: 1 },
  {
    status: 'ops_rejected', amount: 150_000, category: 'PRINTING', description: 'CETAK BANNER PROMO', daysAgo: 2,
    rejectionReason: 'Banner dipesan HO, bukan dari petty cash.',
  },
  { status: 'completed', amount: 35_000, category: 'POSTAGE / TELEGRAMS', description: 'KIRIM DOKUMEN KE HO', daysAgo: 3 },
  { status: 'completed', amount: 30_000, category: 'HOUSEKEEPING EXPS / SUPPLIES', description: 'GALON AIR MINUM', daysAgo: 4, finance: 'accepted' },
  {
    status: 'completed', amount: 45_000, category: 'STATIONERY & OFFICE SUPPLIES', description: 'MAKAN SIANG STAF', daysAgo: 5,
    finance: 'rejected', comment: 'Makan siang tidak termasuk petty cash.',
  },
  {
    status: 'completed', amount: 20_000, category: 'PRINTING', description: 'FOTOKOPI DOKUMEN SERAH TERIMA', daysAgo: 6,
    finance: 'needs_fix', comment: 'Foto struk tidak terbaca, mohon foto ulang.',
  },
];

const STATE_NAME: Record<string, string> = {
  pending_ops: 'Waiting OPS',
  ops_approved: 'Awaiting actual amount',
  ops_rejected: 'Rejected OPS',
  completed: 'Pending Finance',
  accepted: 'Diterima',
  rejected: 'Ditolak',
  needs_fix: 'Perlu Perbaikan',
};

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

async function main() {
  const apply = process.argv.includes('--apply');
  const storeNo = (process.argv.find((a) => a.startsWith('--store='))?.slice(8) ?? 'FF001').toUpperCase();

  const dbName = (getRows(await db.execute(sql`select current_database() as d`))[0] as { d: string }).d;
  console.log(`database : ${dbName}`);

  const [store] = await db.select().from(stores).where(eq(stores.storeNo, storeNo)).limit(1);
  if (!store) throw new Error(`Store ${storeNo} not found.`);
  if (store.status !== 'active') throw new Error(`${storeNo} is ${store.status} — petty cash needs an active store.`);

  // PIC 1 files them; an Ops user of the store's area (else any Ops / IT) decides on them; Finance reviews.
  const people = getRows(
    await db.execute(sql`
      select
        (select u.id from users u join employee_types et on et.id = u.employee_type_id
          where u.home_store_id = ${store.id} and et.code = 'pic_1' and u.is_active and u.deleted_at is null
          order by u.name limit 1) as pic,
        (select u.id from users u join user_roles r on r.id = u.role_id
          where r.code = 'ops' and u.is_active and u.deleted_at is null
          order by (u.area_id = ${store.areaId}) desc nulls last, u.name limit 1) as ops
    `),
  )[0] as { pic: string | null; ops: string | null };
  if (!people.pic) throw new Error(`${storeNo} has no active PIC 1.`);
  const financeId = (await financeUserIds())[0];
  if (!financeId) throw new Error('No Finance user found.');

  const categories = await listPettyCashCategories({ activeOnly: true });
  const categoryOf = (name: string) => {
    const c = categories.find((x) => x.name === name);
    if (!c) throw new Error(`Category "${name}" is not active.`);
    return c;
  };
  PLAN.forEach((p) => categoryOf(p.category));

  // The store's own receipt photos, so the Finance detail shows a real picture (none → no photo).
  const photos = getRows(
    await db.execute(sql`
      select distinct image_url from petty_cash_transactions
      where store_id = ${store.id} and image_url like 'https://%' and image_url not like '%example.test%'
      limit 3
    `),
  ).map((r) => (r as { image_url: string }).image_url);

  const period = await getActivePeriod(store.id);
  console.log(`store    : ${store.storeNo} — ${store.name}; period in use ${period.yearMonth} (balance ${rp(Number(period.currentBalance))})`);

  const already = await db
    .select({ id: pettyCashTransactions.id })
    .from(pettyCashTransactions)
    .where(
      and(
        eq(pettyCashTransactions.storeId, store.id),
        eq(pettyCashTransactions.yearMonth, period.yearMonth),
        inArray(pettyCashTransactions.description, PLAN.map((p) => p.description)),
      ),
    );
  if (already.length > 0) {
    console.log(`\n${storeNo} already has these test requests in ${period.yearMonth} (#${already.map((r) => r.id).join(', #')}) — nothing done.`);
    return;
  }

  console.log('');
  for (const p of PLAN) {
    console.log(`  ${STATE_NAME[p.finance ?? p.status].padEnd(24)} ${rp(p.amount).padStart(11)}  ${p.category} · ${p.description}`);
  }
  if (!apply) {
    console.log('\nPreview only — re-run with --apply to write.');
    return;
  }

  const day = 86_400_000;
  const created: { id: number; plan: Plan }[] = [];
  for (const [i, p] of PLAN.entries()) {
    const filed = new Date(Date.now() - p.daysAgo * day - 2 * 3_600_000);
    const later = new Date(filed.getTime() + 3 * 3_600_000);
    const c = categoryOf(p.category);
    const photo = photos.length > 0 && (p.status === 'completed' || p.status === 'ops_approved') ? photos[i % photos.length] : null;
    const [row] = await db
      .insert(pettyCashTransactions)
      .values({
        periodId: period.id,
        userId: people.pic,
        storeId: store.id,
        amount: p.amount.toFixed(2),
        description: p.description,
        categoryId: c.id,
        categoryName: c.name,
        status: p.status,
        imageUrl: photo,
        imageKey: photo,
        yearMonth: period.yearMonth,
        approvedBy: p.status === 'ops_approved' || p.status === 'completed' ? people.ops : null,
        approvedAt: p.status === 'ops_approved' || p.status === 'completed' ? later : null,
        rejectedBy: p.status === 'ops_rejected' ? people.ops : null,
        rejectedAt: p.status === 'ops_rejected' ? later : null,
        rejectionReason: p.rejectionReason ?? null,
        actualAmount: p.status === 'completed' ? p.amount.toFixed(2) : null,
        actualAmountBy: p.status === 'completed' ? people.pic : null,
        actualAmountAt: p.status === 'completed' ? new Date(later.getTime() + 3_600_000) : null,
        createdAt: filed,
        updatedAt: later,
      })
      .returning({ id: pettyCashTransactions.id });
    created.push({ id: row.id, plan: p });

    // Confirming what was spent cuts it from the period, as in the app.
    if (p.status === 'completed') {
      await db
        .update(pettyCashPeriods)
        .set({ currentBalance: sql`${pettyCashPeriods.currentBalance} - ${p.amount}`, updatedAt: new Date() })
        .where(eq(pettyCashPeriods.id, period.id));
    }
  }

  // Finance's decisions through the app's own logic.
  for (const { id, plan } of created) {
    if (!plan.finance) continue;
    const result =
      plan.finance === 'accepted'
        ? await financeAcceptTransaction({ txId: id, actorId: financeId })
        : await financeRejectTransaction({ txId: id, actorId: financeId, kind: plan.finance, comment: plan.comment });
    if (!result.success) throw new Error(`#${id} ${plan.finance}: ${result.error}`);
  }

  const [after] = await db.select().from(pettyCashPeriods).where(eq(pettyCashPeriods.id, period.id));
  console.log(`\ncreated  : #${created.map((c) => c.id).join(', #')}`);
  console.log(`balance  : ${period.yearMonth} now ${rp(Number(after.currentBalance))}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

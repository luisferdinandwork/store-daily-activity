// scripts/seed/performance-targets.ts
//
// Seeds the September 2026 performance target for every store in
// scripts/seed/dataset.ts that has one:
//
//   FF001  Rp 1.000.000.000 / 1.000 trx   (PIC 7,60% · SA 10,60%)
//   FO001  Rp   271.000.000 /   271 trx   (PIC1 10% · PIC2 45% · SA 45%)
//   DUMMY  Rp   100.000.000 /   400 trx   (PIC1 20% · PIC2 30% · SA 50%)  ← synthetic
//
// Per-employee % is stored as an override (isPercentageOverridden), so the
// headcount template can't clobber the sheet's real numbers.
//
// Also seeds target_allocation_templates (the default PIC/SA % grid keyed by
// headcount) — shared with the production seed via seedAllocationTemplate().

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  employeeMonthlyTargets,
  storeMonthlyTargets,
  stores,
  targetAllocationTemplates,
  users,
} from '@/lib/db/schema';
import { syncRosterPercentages } from '@/lib/performance/target-utils';
import { STORES, YEAR_MONTH, rosterSlots } from './dataset';

const TARGET_YEAR_MONTH = process.env.SEED_TARGET_YEAR_MONTH ?? YEAR_MONTH;

// ─────────────────────────────────────────────────────────────────────────────
// Default monthly allocation % template — transcribed from the printed
// PIC1/PIC2/SA1-5(+) × Man-Power grid (headcount 3-13). Headcounts not
// listed here fall back to an equal split across the roster; add rows here
// (or use the IT-only /it/target-allocation admin page) for others.
// ─────────────────────────────────────────────────────────────────────────────

// Headcount 8-13: PIC1/PIC2 fixed at 7.3% each, remaining SA slots split the
// rest evenly (one decimal, matching the printed grid).
const UNIFORM_SA_TEMPLATES: Array<{ headcount: number; saPercentage: number }> = [
  { headcount: 8, saPercentage: 14.3 },
  { headcount: 9, saPercentage: 12.2 },
  { headcount: 10, saPercentage: 10.7 },
  { headcount: 11, saPercentage: 9.5 },
  { headcount: 12, saPercentage: 8.6 },
  { headcount: 13, saPercentage: 7.8 },
];

function buildUniformSaRows() {
  const rows: Array<{ headcount: number; slotCode: string; percentage: number }> = [];
  for (const { headcount, saPercentage } of UNIFORM_SA_TEMPLATES) {
    rows.push({ headcount, slotCode: 'PIC1', percentage: 7.3 });
    rows.push({ headcount, slotCode: 'PIC2', percentage: 7.3 });
    for (let i = 1; i <= headcount - 2; i++) {
      rows.push({ headcount, slotCode: `SA${i}`, percentage: saPercentage });
    }
  }
  return rows;
}

const ALLOCATION_TEMPLATE: Array<{ headcount: number; slotCode: string; percentage: number }> = [
  ...buildUniformSaRows(),

  // 7 orang
  { headcount: 7, slotCode: 'PIC1', percentage: 7.3 },
  { headcount: 7, slotCode: 'PIC2', percentage: 7.3 },
  { headcount: 7, slotCode: 'SA1', percentage: 17.0 },
  { headcount: 7, slotCode: 'SA2', percentage: 17.1 },
  { headcount: 7, slotCode: 'SA3', percentage: 17.1 },
  { headcount: 7, slotCode: 'SA4', percentage: 17.1 },
  { headcount: 7, slotCode: 'SA5', percentage: 17.1 },

  // 6 orang
  { headcount: 6, slotCode: 'PIC1', percentage: 7.3 },
  { headcount: 6, slotCode: 'PIC2', percentage: 7.3 },
  { headcount: 6, slotCode: 'SA1', percentage: 21.3 },
  { headcount: 6, slotCode: 'SA2', percentage: 21.4 },
  { headcount: 6, slotCode: 'SA3', percentage: 21.4 },
  { headcount: 6, slotCode: 'SA4', percentage: 21.4 },

  // 5 orang
  { headcount: 5, slotCode: 'PIC1', percentage: 7.3 },
  { headcount: 5, slotCode: 'PIC2', percentage: 7.3 },
  { headcount: 5, slotCode: 'SA1', percentage: 28.4 },
  { headcount: 5, slotCode: 'SA2', percentage: 28.5 },
  { headcount: 5, slotCode: 'SA3', percentage: 28.5 },

  // 4 orang
  { headcount: 4, slotCode: 'PIC1', percentage: 10.0 },
  { headcount: 4, slotCode: 'PIC2', percentage: 10.0 },
  { headcount: 4, slotCode: 'SA1', percentage: 40.0 },
  { headcount: 4, slotCode: 'SA2', percentage: 40.0 },

  // 3 orang
  { headcount: 3, slotCode: 'PIC1', percentage: 20.0 },
  { headcount: 3, slotCode: 'PIC2', percentage: 40.0 },
  { headcount: 3, slotCode: 'SA1', percentage: 40.0 },
];

export async function seedAllocationTemplate() {
  console.log('🎯 Seeding target_allocation_templates...');

  for (const row of ALLOCATION_TEMPLATE) {
    await db
      .insert(targetAllocationTemplates)
      .values({
        headcount: row.headcount,
        slotCode: row.slotCode,
        percentage: row.percentage.toFixed(2),
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [targetAllocationTemplates.headcount, targetAllocationTemplates.slotCode],
        set: { percentage: row.percentage.toFixed(2), isActive: true, updatedAt: new Date() },
      });
  }

  console.log(`✓ ${ALLOCATION_TEMPLATE.length} allocation template rows seeded (headcount 3-13).`);
}

function money(value: number) {
  return value.toLocaleString('id-ID');
}

async function deleteExistingTargetsForStore(params: { storeId: number; yearMonth: string }) {
  const { storeId, yearMonth } = params;

  // Child rows first — employee_monthly_targets references store_monthly_targets.
  await db
    .delete(employeeMonthlyTargets)
    .where(
      and(
        eq(employeeMonthlyTargets.storeId, storeId),
        eq(employeeMonthlyTargets.yearMonth, yearMonth),
      ),
    );

  await db
    .delete(storeMonthlyTargets)
    .where(
      and(
        eq(storeMonthlyTargets.storeId, storeId),
        eq(storeMonthlyTargets.yearMonth, yearMonth),
      ),
    );
}

async function seedStoreTarget(storeNo: string) {
  const def = STORES.find((s) => s.storeNo === storeNo);
  if (!def || !def.target) return;

  const [store] = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
    .from(stores)
    .where(eq(stores.storeNo, storeNo))
    .limit(1);

  if (!store) {
    console.warn(`⚠️ Store ${storeNo} not found — run the setup seed step first. Skipping.`);
    return;
  }

  await deleteExistingTargetsForStore({ storeId: store.id, yearMonth: TARGET_YEAR_MONTH });

  const [storePlan] = await db
    .insert(storeMonthlyTargets)
    .values({
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,
      monthlySalesTarget: String(def.target.monthlySalesTarget),
      monthlyTransactionTarget: def.target.monthlyTransactionTarget,
      targetSource: 'manual',
      notes:
        `Seeded from the Sep 2026 break-down sheet. Store target Rp ${money(def.target.monthlySalesTarget)} / ` +
        `${def.target.monthlyTransactionTarget} trx. Per-employee % transcribed from the sheet.`,
      isActive: true,
    })
    .returning({ id: storeMonthlyTargets.id });

  const slots = rosterSlots(def.employees);
  const niks = slots.map((s) => s.nik);

  const userRows = await db
    .select({ id: users.id, nik: users.nik })
    .from(users)
    .where(inArray(users.nik, niks));

  const idByNik = new Map(userRows.map((u) => [u.nik, u.id]));
  const missing = niks.filter((n) => !idByNik.has(n));
  if (missing.length) {
    throw new Error(
      `${storeNo}: roster NIK(s) not found in users: ${missing.join(', ')}. Run the setup seed step first.`,
    );
  }

  await db.insert(employeeMonthlyTargets).values(
    slots.map((slot) => ({
      storeMonthlyTargetId: storePlan.id,
      userId: idByNik.get(slot.nik)!,
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,
      targetRoleCode: slot.roleCode,
      sortOrder: slot.sortOrder,
      percentage: slot.percentage.toFixed(2),
      isPercentageOverridden: true,
      notes: `Seeded ${slot.roleCode} at ${slot.percentage.toFixed(2)}% (from the Sep 2026 break-down sheet).`,
      isActive: true,
    })),
  );

  // Re-run the standard sync so derived bookkeeping matches the app. Every row
  // is locked and the set already sums to 100%, so the stored percentages are
  // preserved as-is.
  await syncRosterPercentages({ storeId: store.id, yearMonth: TARGET_YEAR_MONTH });

  const picCount = slots.filter((s) => s.roleCode !== 'SA').length;
  console.log(
    [
      `✓ ${store.storeNo} ${store.name}`,
      `${slots.length} roster rows (${picCount} PIC, ${slots.length - picCount} SA)`,
      `Rp ${money(def.target.monthlySalesTarget)} / ${def.target.monthlyTransactionTarget} trx`,
    ].join(' · '),
  );
}

export async function seedPerformanceTargets() {
  console.log(`🎯 Seeding performance targets for ${TARGET_YEAR_MONTH}...`);

  await seedAllocationTemplate();

  for (const s of STORES) {
    if (s.target) await seedStoreTarget(s.storeNo);
  }

  console.log('✅ Performance targets + allocation template seeded.');
}

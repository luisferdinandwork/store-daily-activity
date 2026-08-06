// scripts/seed/performance-targets.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  employeeMonthlyTargets,
  storeMonthlyTargets,
  stores,
  targetAllocationTemplates,
  users,
} from '@/lib/db/schema';
import { syncRosterPercentages } from '@/lib/performance/target-utils';

const TARGET_YEAR_MONTH =
  process.env.SEED_TARGET_YEAR_MONTH ?? new Date().toISOString().slice(0, 7);

type StoreCode = 'FF001' | 'FS033' | 'FF012' | 'FS020';

type StoreTotalDef = {
  /** Store-wide monthly sales target — set directly on store_monthly_targets now. */
  totalSalesTarget: number;
  /** Store-wide monthly transaction target — set directly on store_monthly_targets now. */
  totalTransactionTarget: number;
};

/**
 * Ops sets these numbers directly now (no more "sum of employee rows").
 * Daily target = totalSalesTarget / days-in-month, then split across
 * whoever is scheduled that day via target_allocation_templates below.
 */
const storeTotalTargetDefs: Record<StoreCode, StoreTotalDef> = {
  FF001: { totalSalesTarget: 100_000_000, totalTransactionTarget: 400 },
  FS033: { totalSalesTarget: 80_000_000, totalTransactionTarget: 320 },
  FF012: { totalSalesTarget: 85_000_000, totalTransactionTarget: 340 },
  FS020: { totalSalesTarget: 75_000_000, totalTransactionTarget: 300 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Default monthly allocation % template — transcribed from the printed
// PIC1/PIC2/SA1-5(+) × Man-Power grid (headcount 3-13). Headcounts not
// listed here fall back to an equal split across the whole roster; add rows
// here (or use the IT-only /it/target-allocation admin page) if you want an
// exact split for those too.
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

// ─────────────────────────────────────────────────────────────────────────────
// Roster roles: "PIC1/PIC2 fixed, rest are SA". Only ROLE + sortOrder are
// assigned here — the fixed monthly `percentage` is filled in afterwards by
// syncRosterPercentages() from target_allocation_templates, keyed by the
// roster's total headcount. sortOrder ranks the SAs into SA1, SA2, ... for
// the whole month (see assignMonthlySlots in target-utils.ts).
// ─────────────────────────────────────────────────────────────────────────────

type RosterRole = { code: 'PIC1' | 'PIC2' | 'SA'; sortOrder: number };

function buildRosterRoles(totalEmployees: number): RosterRole[] {
  if (totalEmployees <= 0) return [];

  // 1 employee → just SA (no PIC split); 2+ employees → up to 2 PICs, rest SA.
  const picCount = totalEmployees === 1 ? 0 : Math.min(2, totalEmployees - 1);

  const roles: RosterRole[] = [];
  if (picCount >= 1) roles.push({ code: 'PIC1', sortOrder: 0 });
  if (picCount >= 2) roles.push({ code: 'PIC2', sortOrder: 0 });

  const saCount = totalEmployees - picCount;
  for (let i = 0; i < saCount; i++) {
    roles.push({ code: 'SA', sortOrder: i + 1 });
  }

  return roles;
}

function money(value: number) {
  return value.toLocaleString('id-ID');
}

async function getStoreByNo(storeNo: StoreCode) {
  const [store] = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
    .from(stores)
    .where(eq(stores.storeNo, storeNo))
    .limit(1);

  return store ?? null;
}

async function deleteExistingTargetsForStore(params: { storeId: number; yearMonth: string }) {
  const { storeId, yearMonth } = params;

  // Delete child rows first (employee_monthly_targets references store_monthly_targets).
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

async function getActiveUsersForStore(storeId: number) {
  return db
    .select({ id: users.id, nik: users.nik, name: users.name })
    .from(users)
    .where(and(eq(users.homeStoreId, storeId), eq(users.isActive, true)))
    .orderBy(asc(users.name));
}

async function seedStoreTargets(params: { storeNo: StoreCode; total: StoreTotalDef }) {
  const { storeNo, total } = params;

  const store = await getStoreByNo(storeNo);
  if (!store) {
    console.warn(`⚠️ Store ${storeNo} not found. Skipping.`);
    return;
  }

  await deleteExistingTargetsForStore({ storeId: store.id, yearMonth: TARGET_YEAR_MONTH });

  // Ops sets the monthly target directly — no more "header/plan only" row.
  const [storePlan] = await db
    .insert(storeMonthlyTargets)
    .values({
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,
      monthlySalesTarget: String(total.totalSalesTarget),
      monthlyTransactionTarget: total.totalTransactionTarget,
      targetSource: 'manual',
      notes:
        `Seeded target: Rp ${money(total.totalSalesTarget)} / ${total.totalTransactionTarget} trx per month. ` +
        'Split across the roster below by a fixed monthly percentage from target_allocation_templates.',
      isActive: true,
    })
    .returning({ id: storeMonthlyTargets.id });

  const storeUsers = await getActiveUsersForStore(store.id);
  if (storeUsers.length === 0) {
    console.warn(`⚠️ ${store.storeNo} ${store.name}: no active users found.`);
    return;
  }

  const roles = buildRosterRoles(storeUsers.length);

  const rosterRows = storeUsers.map((user, index) => {
    const role = roles[index];
    return {
      storeMonthlyTargetId: storePlan.id,
      userId: user.id,
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,
      targetRoleCode: role.code,
      sortOrder: role.sortOrder,
      notes: `Seeded as ${role.code}${role.code === 'SA' ? ` (sortOrder ${role.sortOrder})` : ''}.`,
      isActive: true,
    };
  });

  await db.insert(employeeMonthlyTargets).values(rosterRows);
  await syncRosterPercentages({ storeId: store.id, yearMonth: TARGET_YEAR_MONTH });

  const picCount = roles.filter((r) => r.code !== 'SA').length;
  const saCount = roles.length - picCount;

  console.log(
    [
      `✓ ${store.storeNo} ${store.name}`,
      `${rosterRows.length} roster rows (${picCount} PIC, ${saCount} SA)`,
      `monthly target Rp ${money(total.totalSalesTarget)} / ${total.totalTransactionTarget} trx`,
    ].join(' · '),
  );
}

export async function seedPerformanceTargets() {
  console.log(`🎯 Seeding monthly-fixed-percentage performance targets for ${TARGET_YEAR_MONTH}...`);

  await seedAllocationTemplate();

  for (const [storeNo, total] of Object.entries(storeTotalTargetDefs) as Array<[StoreCode, StoreTotalDef]>) {
    await seedStoreTargets({ storeNo, total });
  }

  console.log('✅ Performance targets + allocation template seeded.');
}
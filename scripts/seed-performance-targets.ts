// scripts/seed-performance-targets.ts
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
// Default daily allocation % template — transcribed from the printed
// PIC1/PIC2/SA1-5 × Man-Power grid. Headcounts not listed here (1, 2, 8+)
// fall back to an equal split across everyone scheduled that day; add rows
// here (or edit target_allocation_templates directly) if you want an exact
// split for those too.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOCATION_TEMPLATE: Array<{ headcount: number; slotCode: string; percentage: number }> = [
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

async function seedAllocationTemplate() {
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

  console.log(`✓ ${ALLOCATION_TEMPLATE.length} allocation template rows seeded (headcount 3-7).`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Roster roles: same "PIC1/PIC2 fixed, rest are SA" shape as before, but we
// only assign a ROLE + sortOrder now — no weight%, no amounts. sortOrder
// ranks the SAs into SA1, SA2, ... on days everyone is present; if someone
// is off, the remaining SAs just shift up (see assignDailySlots in
// target-utils.ts).
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
        'Daily target = monthly target / days in month, split across the roster below by target_allocation_templates.',
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

async function main() {
  console.log(`🎯 Seeding daily-allocation performance targets for ${TARGET_YEAR_MONTH}...`);

  await seedAllocationTemplate();

  for (const [storeNo, total] of Object.entries(storeTotalTargetDefs) as Array<[StoreCode, StoreTotalDef]>) {
    await seedStoreTargets({ storeNo, total });
  }

  console.log('✅ Performance targets + allocation template seeded.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ seed-performance-targets failed:', err);
    process.exit(1);
  });
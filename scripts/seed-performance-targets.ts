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
  users,
} from '@/lib/db/schema';
import { calculateAtvTarget } from '@/lib/performance/target-utils';

const TARGET_YEAR_MONTH =
  process.env.SEED_TARGET_YEAR_MONTH ?? new Date().toISOString().slice(0, 7);

type StoreCode = 'FF001' | 'FS033' | 'FF012' | 'FS020';

type StoreTotalDef = {
  /** Store-wide monthly sales target (the 100% total to be split by weight). */
  totalSalesTarget: number;
  /** Store-wide monthly transaction target (the 100% total to be split by weight). */
  totalTransactionTarget: number;
};

/**
 * Store target is employee-rollup only:
 *
 *   store_monthly_target = SUM(employee_monthly_targets.monthlySalesTarget)
 *
 * These `totalSalesTarget` / `totalTransactionTarget` values represent the
 * STORE'S WHOLE monthly target (the 100% figure). Each employee then gets a
 * `targetWeightPct` share of this total:
 *
 *   employee.monthlySalesTarget = totalSalesTarget * weightPct / 100
 *
 * All active employees' weightPct for a store + month should sum to 100,
 * so the rollup equals the store total exactly.
 */
const storeTotalTargetDefs: Record<StoreCode, StoreTotalDef> = {
  FF001: { totalSalesTarget: 100_000_000, totalTransactionTarget: 400 },
  FS033: { totalSalesTarget: 80_000_000, totalTransactionTarget: 320 },
  FF012: { totalSalesTarget: 85_000_000, totalTransactionTarget: 340 },
  FS020: { totalSalesTarget: 75_000_000, totalTransactionTarget: 300 },
};

type TargetRole = {
  code: 'PIC1' | 'PIC2' | 'SA';
  weightPct: number;
};

/**
 * Weight distribution rule (must sum to exactly 100 across all active
 * employees in the store + month):
 *
 * - PIC1 and PIC2 each get a fixed 10% (if present).
 * - The remaining percentage (100 - 10*numPics) is split EQUALLY among the
 *   remaining SA employees.
 *
 * Examples:
 *   1 employee (no PIC)        → SA 100%
 *   2 employees (1 PIC, 1 SA)  → PIC1 10%, SA 90%
 *   3 employees (1 PIC, 2 SA)  → PIC1 10%, SA 45%, SA 45%
 *   4 employees (2 PIC, 2 SA)  → PIC1 10%, PIC2 10%, SA 40%, SA 40%
 *   5 employees (2 PIC, 3 SA)  → PIC1 10%, PIC2 10%, SA ~26.67% each
 *
 * If there are PIC slots but zero SA employees, the PIC weights are
 * rescaled so they still sum to 100% (edge case, e.g. a store with only
 * PIC1 + PIC2).
 */
function buildTargetRoles(totalEmployees: number): TargetRole[] {
  if (totalEmployees <= 0) return [];

  if (totalEmployees === 1) {
    return [{ code: 'SA', weightPct: 100 }];
  }

  const picCount = Math.min(2, totalEmployees - 1);
  const saCount = totalEmployees - picCount;

  const picWeightEach = 10;
  const picTotalWeight = picWeightEach * picCount;
  const saTotalWeight = 100 - picTotalWeight;

  const roles: TargetRole[] = [];

  if (picCount >= 1) roles.push({ code: 'PIC1', weightPct: picWeightEach });
  if (picCount >= 2) roles.push({ code: 'PIC2', weightPct: picWeightEach });

  if (saCount > 0) {
    // Split remaining weight equally among SA employees. To keep the total
    // exactly 100, give any rounding remainder to the last SA.
    const rawShare = saTotalWeight / saCount;
    let assigned = 0;

    for (let i = 0; i < saCount; i++) {
      const isLast = i === saCount - 1;
      const weight = isLast
        ? Math.round((saTotalWeight - assigned) * 100) / 100
        : Math.round(rawShare * 100) / 100;

      roles.push({ code: 'SA', weightPct: weight });
      assigned += weight;
    }
  } else {
    // No SA employees — rescale PIC weights to sum to 100%.
    return roles.map((role) => ({ ...role, weightPct: 100 / roles.length }));
  }

  return roles;
}

function applyWeight(total: number, weightPct: number) {
  return Math.round((total * weightPct) / 100);
}

function money(value: number) {
  return value.toLocaleString('id-ID');
}

async function getStoreByNo(storeNo: StoreCode) {
  const [store] = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
    })
    .from(stores)
    .where(eq(stores.storeNo, storeNo))
    .limit(1);

  return store ?? null;
}

async function deleteExistingTargetsForStore(params: {
  storeId: number;
  yearMonth: string;
}) {
  const { storeId, yearMonth } = params;

  /**
   * Delete child rows first because employee_monthly_targets can reference
   * store_monthly_targets.
   */
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
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
    })
    .from(users)
    .where(and(eq(users.homeStoreId, storeId), eq(users.isActive, true)))
    .orderBy(asc(users.name));
}

async function seedStoreTargets(params: {
  storeNo: StoreCode;
  total: StoreTotalDef;
}) {
  const { storeNo, total } = params;

  const store = await getStoreByNo(storeNo);

  if (!store) {
    console.warn(`⚠️ Store ${storeNo} not found. Skipping.`);
    return;
  }

  await deleteExistingTargetsForStore({
    storeId: store.id,
    yearMonth: TARGET_YEAR_MONTH,
  });

  /**
   * This row is only the monthly plan/header.
   * It does NOT store target amount anymore.
   */
  const [storePlan] = await db
    .insert(storeMonthlyTargets)
    .values({
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,
      targetSource: 'employee_rollup',
      notes:
        'Seeded target plan. Store target is calculated from employee target rollup ' +
        `(store total: Rp ${money(total.totalSalesTarget)} / ${total.totalTransactionTarget} trx).`,
      isActive: true,
    })
    .returning({
      id: storeMonthlyTargets.id,
    });

  const storeUsers = await getActiveUsersForStore(store.id);

  if (storeUsers.length === 0) {
    console.warn(`⚠️ ${store.storeNo} ${store.name}: no active users found.`);
    return;
  }

  const roles = buildTargetRoles(storeUsers.length);

  const employeeRows = storeUsers.map((user, index) => {
    const role = roles[index];

    const monthlySalesTarget = applyWeight(total.totalSalesTarget, role.weightPct);
    const monthlyTransactionTarget = applyWeight(total.totalTransactionTarget, role.weightPct);

    // ATV target is always derived: sales target / transaction target.
    const monthlyAtvTarget = calculateAtvTarget(
      monthlySalesTarget,
      monthlyTransactionTarget,
    );

    return {
      storeMonthlyTargetId: storePlan.id,

      userId: user.id,
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,

      targetRoleCode: role.code,
      targetWeightPct: role.weightPct.toFixed(2),

      monthlySalesTarget: String(monthlySalesTarget),
      monthlyTransactionTarget,
      monthlyAtvTarget: String(monthlyAtvTarget),

      notes:
        role.code === 'SA'
          ? `Seeded SA target at ${role.weightPct.toFixed(2)}% of store total.`
          : `Seeded ${role.code} target at ${role.weightPct.toFixed(2)}% of store total.`,

      isActive: true,
    };
  });

  await db.insert(employeeMonthlyTargets).values(employeeRows);

  /**
   * This is the actual store target.
   * It is calculated from employee rows, not inserted into store_monthly_targets.
   * With weights summing to 100%, this should equal `total` (modulo rounding).
   */
  const storeSalesTarget = employeeRows.reduce(
    (sum, row) => sum + Number(row.monthlySalesTarget),
    0,
  );

  const storeTransactionTarget = employeeRows.reduce(
    (sum, row) => sum + Number(row.monthlyTransactionTarget),
    0,
  );

  const weightTotal = roles.reduce((sum, role) => sum + role.weightPct, 0);

  const storeAtvTarget = calculateAtvTarget(
    storeSalesTarget,
    storeTransactionTarget,
  );

  console.log(
    [
      `✓ ${store.storeNo} ${store.name}`,
      `${employeeRows.length} employees`,
      `weights sum ${weightTotal.toFixed(2)}%`,
      `rollup Rp ${money(storeSalesTarget)} (target Rp ${money(total.totalSalesTarget)})`,
      `${storeTransactionTarget} trx (target ${total.totalTransactionTarget})`,
      `ATV Rp ${money(storeAtvTarget)}`,
    ].join(' · '),
  );
}

async function main() {
  console.log(
    `🎯 Seeding employee-rollup performance targets for ${TARGET_YEAR_MONTH}...`,
  );

  for (const [storeNo, total] of Object.entries(storeTotalTargetDefs) as Array<
    [StoreCode, StoreTotalDef]
  >) {
    await seedStoreTargets({ storeNo, total });
  }

  console.log('✅ Employee-rollup performance targets seeded.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ seed-performance-targets failed:', err);
    process.exit(1);
  });
// scripts/seed/roster-demo-performance.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dummy performance TARGETS for stores that have none yet — the counterpart to
// roster-demo.ts, so the PIC / Ops performance screens aren't empty.
//
//   npm run db:seed -- --only=roster-demo-performance
//   ROSTER_DEMO_DRY=1 npm run db:seed -- --only=roster-demo-performance   # plan only
//   ROSTER_DEMO_ONLY=FF002,FS001 …                                        # just these stores
//
// Only the targets live in this database. ACTUAL sales are read live from
// Business Central by store code, matched to employees by NIK — nothing here
// fabricates them. To keep the dummy targets believable next to those real
// numbers, each store's monthly target is sized from its real month-to-date
// run-rate (± a per-store factor, so some stores run ahead and some behind),
// and the PIC's share of the target is their real share of the store's sales.
// If Business Central has nothing for a store, a per-brand default is used.
//
// Per eligible store (active employees, NO store_monthly_targets / roster rows
// for the current month, never FF001/FO001): one store_monthly_targets row +
// one employee_monthly_targets row per active employee, then the app's own
// syncRosterPercentages() to keep its bookkeeping consistent. A failure rolls
// that store back (it had no target rows before, so deleting by store+month
// removes exactly what this run wrote).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { employeeMonthlyTargets, employeeTypes, storeMonthlyTargets, stores, userRoles, users } from '@/lib/db/schema';
import { getStoreActuals } from '@/lib/performance/employee-actuals';
import { syncRosterPercentages } from '@/lib/performance/target-utils';
import { CAL, PROTECTED_STORE_NOS, makeRng } from './roster-demo';

const DRY = process.env.ROSTER_DEMO_DRY === '1';
const ONLY = process.env.ROSTER_DEMO_ONLY
  ? new Set(process.env.ROSTER_DEMO_ONLY.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean))
  : null;

/** Monthly sales target used when Business Central has no usable run-rate for a store. */
const BRAND_DEFAULT_TARGET: Record<string, number> = { FF: 500_000_000, FS: 400_000_000, OD: 350_000_000, FO: 250_000_000, SS: 200_000_000 };
const FALLBACK_TARGET = 300_000_000;
const FALLBACK_ATV = 1_000_000;
const FALLBACK_PIC_SHARE_PCT = 10;
/** Below this month-to-date total (or before this day of the month) the run-rate isn't trustworthy. */
const MIN_MTD_SALES = 5_000_000;
const MIN_DAY_FOR_RUN_RATE = 3;

export const ROLE_BY_TYPE: Record<string, 'PIC1' | 'PIC2' | 'SA'> = { pic_1: 'PIC1', pic_2: 'PIC2', sa: 'SA' };

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export interface Candidate {
  store: { id: number; storeNo: string; name: string };
  employees: Array<{ id: string; nik: string; name: string; role: 'PIC1' | 'PIC2' | 'SA' }>;
}

async function findCandidates(): Promise<{ candidates: Candidate[]; skipped: string[] }> {
  const [storeRows, targetRows, rosterRows, employeeRows] = await Promise.all([
    db.select({ id: stores.id, storeNo: stores.storeNo, name: stores.name }).from(stores),
    db.select({ storeId: storeMonthlyTargets.storeId }).from(storeMonthlyTargets).where(eq(storeMonthlyTargets.yearMonth, CAL.yearMonth)),
    db.select({ storeId: employeeMonthlyTargets.storeId }).from(employeeMonthlyTargets).where(eq(employeeMonthlyTargets.yearMonth, CAL.yearMonth)),
    db
      .select({ id: users.id, nik: users.nik, name: users.name, storeId: users.homeStoreId, typeCode: employeeTypes.code })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.id, users.roleId))
      .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
      .where(and(eq(userRoles.code, 'employee'), eq(users.isActive, true), isNotNull(users.homeStoreId))),
  ]);

  const hasTarget = new Set([...targetRows, ...rosterRows].map((r) => r.storeId));
  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  for (const s of storeRows.sort((a, b) => a.storeNo.localeCompare(b.storeNo))) {
    const staff = employeeRows.filter((e) => e.storeId === s.id && e.typeCode && ROLE_BY_TYPE[e.typeCode]);
    if (staff.length === 0) continue;
    if (ONLY && !ONLY.has(s.storeNo.toUpperCase())) continue;
    if (PROTECTED_STORE_NOS.has(s.storeNo)) { skipped.push(`${s.storeNo} (protected)`); continue; }
    if (hasTarget.has(s.id)) { skipped.push(`${s.storeNo} (already has a target)`); continue; }
    candidates.push({
      store: s,
      employees: staff.map((e) => ({ id: e.id, nik: e.nik, name: e.name, role: ROLE_BY_TYPE[e.typeCode!] })),
    });
  }
  return { candidates, skipped };
}

interface Plan {
  salesTarget: number;
  transactionTarget: number;
  picSharePct: number;
  basis: string;
}

export async function planStore(c: Candidate): Promise<Plan> {
  const rng = makeRng(`roster-demo-performance|${CAL.yearMonth}|${c.store.storeNo}`);
  const factor = rng.range(0.85, 1.2); // some stores ahead of target, some behind
  const brand = c.store.storeNo.replace(/\d+$/, '');
  const fallbackTarget = roundTo((BRAND_DEFAULT_TARGET[brand] ?? FALLBACK_TARGET) * rng.range(0.8, 1.2), 10_000_000);

  const actuals = await getStoreActuals({ storeNo: c.store.storeNo, period: 'monthly', yearMonth: CAL.yearMonth });
  const usable = actuals.available && actuals.storeActualSales >= MIN_MTD_SALES && CAL.day >= MIN_DAY_FOR_RUN_RATE;
  if (!usable) {
    return { salesTarget: fallbackTarget, transactionTarget: roundTo(fallbackTarget / FALLBACK_ATV, 10), picSharePct: FALLBACK_PIC_SHARE_PCT, basis: 'brand default (no usable BC run-rate)' };
  }

  // Month-to-date run-rate, treating today as half a day (it is only partly over).
  const runRate = (actuals.storeActualSales / (CAL.day - 0.5)) * CAL.daysInMonth;
  const salesTarget = Math.max(50_000_000, roundTo(runRate * factor, 10_000_000));
  const atv = actuals.storeActualTransactionCount > 0 ? clamp(actuals.storeActualSales / actuals.storeActualTransactionCount, 300_000, 3_000_000) : FALLBACK_ATV;
  const transactionTarget = Math.max(10, roundTo(salesTarget / atv, 10));

  const pic = c.employees.find((e) => e.role === 'PIC1') ?? c.employees[0];
  const picSales = actuals.byEmployee.get(pic.nik)?.actualSales ?? 0;
  const picSharePct = picSales > 0 ? clamp(roundTo((picSales / actuals.storeActualSales) * 100, 0.5), 5, 40) : FALLBACK_PIC_SHARE_PCT;

  return {
    salesTarget, transactionTarget, picSharePct,
    basis: `BC MTD ${rp(Math.round(actuals.storeActualSales))} / ${actuals.storeActualTransactionCount} trx → run-rate ${rp(Math.round(runRate))} × ${factor.toFixed(2)}`,
  };
}

async function rollback(storeId: number) {
  await db.delete(employeeMonthlyTargets).where(and(eq(employeeMonthlyTargets.storeId, storeId), eq(employeeMonthlyTargets.yearMonth, CAL.yearMonth)));
  await db.delete(storeMonthlyTargets).where(and(eq(storeMonthlyTargets.storeId, storeId), eq(storeMonthlyTargets.yearMonth, CAL.yearMonth)));
}

export async function writeStore(c: Candidate, plan: Plan) {
  const [target] = await db
    .insert(storeMonthlyTargets)
    .values({
      storeId: c.store.id,
      yearMonth: CAL.yearMonth,
      monthlySalesTarget: String(plan.salesTarget),
      monthlyTransactionTarget: plan.transactionTarget,
      targetSource: 'manual',
      notes: `Dummy target for user socialization (seeded). ${plan.basis}.`,
      isActive: true,
    })
    .returning({ id: storeMonthlyTargets.id });

  let saOrder = 0;
  await db.insert(employeeMonthlyTargets).values(
    c.employees.map((e) => ({
      storeMonthlyTargetId: target.id,
      userId: e.id,
      storeId: c.store.id,
      yearMonth: CAL.yearMonth,
      targetRoleCode: e.role,
      sortOrder: e.role === 'SA' ? ++saOrder : 0,
      // Only the PIC 1 is locked at a realistic share; anyone else follows the
      // app's headcount template, so adding colleagues later still rebalances.
      percentage: (e.role === 'PIC1' ? plan.picSharePct : 0).toFixed(2),
      isPercentageOverridden: e.role === 'PIC1',
      notes: e.role === 'PIC1' ? `Dummy PIC 1 share (${plan.picSharePct.toFixed(2)}%) — seeded.` : null,
      isActive: true,
    })),
  );

  await syncRosterPercentages({ storeId: c.store.id, yearMonth: CAL.yearMonth });
}

export async function seedRosterDemoPerformance() {
  console.log(`\n📈 roster-demo-performance ${DRY ? '(DRY RUN — nothing is written)' : ''}: ${CAL.yearMonth} (day ${CAL.day}/${CAL.daysInMonth})`);

  const { candidates, skipped } = await findCandidates();
  if (skipped.length) console.log(`   skipped: ${skipped.join(', ')}`);
  if (candidates.length === 0) {
    console.log('   No eligible stores (every store with employees already has a target for this month). Nothing to do.');
    return;
  }
  console.log(`   ${candidates.length} eligible store(s)\n`);

  const failed: string[] = [];
  let done = 0;
  for (const c of candidates) {
    try {
      const plan = await planStore(c);
      if (!DRY) await writeStore(c, plan);
      done++;
      console.log(`   ✓ ${c.store.storeNo.padEnd(6)} target ${rp(plan.salesTarget).padStart(18)} · ${String(plan.transactionTarget).padStart(5)} trx · PIC ${plan.picSharePct.toFixed(1).padStart(4)}%   [${plan.basis}]`);
    } catch (err) {
      failed.push(c.store.storeNo);
      console.error(`   ✗ ${c.store.storeNo} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!DRY) {
        try { await rollback(c.store.id); console.error(`     rolled back ${c.store.storeNo}`); }
        catch (rbErr) { console.error(`     ROLLBACK FAILED for ${c.store.storeNo} — clean up manually:`, rbErr); }
      }
    }
  }

  console.log(`\n   ${done}/${candidates.length} store(s) ${DRY ? 'planned' : 'seeded'}.`);
  if (failed.length) throw new Error(`roster-demo-performance failed for: ${failed.join(', ')}`);
  console.log('\n✅ roster-demo-performance complete.');
}

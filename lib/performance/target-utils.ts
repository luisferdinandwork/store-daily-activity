// lib/performance/target-utils.ts
import { and, asc, eq, gte, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  employeeMonthlyTargets,
  schedules,
  storeMonthlyTargets,
  stores,
  users,
} from '@/lib/db/schema';

export type TargetSource = 'employee' | 'store_rollup_only' | 'none';

export type StoreMonthlyTargetRollup = {
  storeMonthlyTargetId: number | null;
  storeId: number;
  yearMonth: string;
  storeMonthlySalesTarget: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyAtvTarget: number;
  employeeTargetCount: number;
};

export type PerformanceTargetResult = StoreMonthlyTargetRollup & {
  employeeMonthlyTargetId: number | null;
  employeeMonthlySalesTarget: number;
  employeeMonthlyTransactionTarget: number;
  employeeMonthlyAtvTarget: number;
  employeeTargetRoleCode: string | null;
  employeeTargetWeightPct: number;

  scheduledDaysInMonth: number;

  dailySalesTarget: number;
  dailyTransactionTarget: number;

  /** employee = employee has a target, store_rollup_only = store has other employee targets, none = no targets. */
  source: TargetSource;
};

export type StoreEmployeeTargetRow = {
  id: number;
  userId: string;
  nik: string;
  name: string;
  storeId: number;
  storeNo: string;
  storeName: string;
  yearMonth: string;
  targetRoleCode: string;
  targetWeightPct: number;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  /** Always derived as monthlySalesTarget / monthlyTransactionTarget — never read from storage. */
  monthlyAtvTarget: number;
  isActive: boolean;
};

export function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function toYearMonth(date: Date) {
  return date.toISOString().slice(0, 7);
}

export function getMonthRange(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  return { start, end };
}

/** Number of calendar days in a YYYY-MM month. */
export function getDaysInMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function safeNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function safePct(actual: number, target: number) {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

/**
 * Like safePct but does not cap at 100 — useful when overshooting the
 * target should be visible (e.g. "118%").
 */
export function uncappedPct(actual: number, target: number) {
  if (!target || target <= 0) return 0;
  return Math.round((actual / target) * 100);
}

export function safeContribution(part: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

/**
 * ATV target is ALWAYS derived from sales/transaction targets — it is never
 * read from a stored column. This keeps ATV consistent if sales or
 * transaction targets are edited independently.
 */
export function calculateAtvTarget(salesTarget: number, transactionTarget: number) {
  if (!transactionTarget || transactionTarget <= 0) return 0;
  return Math.round(salesTarget / transactionTarget);
}

export function calculateDailyTarget(monthlyTarget: number, scheduledDays: number) {
  if (!scheduledDays || scheduledDays <= 0) return 0;
  return Math.round(monthlyTarget / scheduledDays);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rebalancing helpers
//
// These implement the two edit modes for employee_monthly_targets rows:
//
//   - "amount" mode: the edited employee's monthlySalesTarget /
//     monthlyTransactionTarget changes directly. The store total shifts by
//     the same delta; every employee's weightPct (including the edited one
//     and PIC1/PIC2) is recomputed as `amount / newStoreTotal * 100` so the
//     weights still describe each employee's share of the new total.
//
//   - "weight" mode: the edited employee's targetWeightPct changes directly.
//     The store total stays FIXED. PIC1/PIC2 weights for OTHER employees are
//     left untouched; the remaining "SA pool" (100 - sumOfOtherPicWeights -
//     newWeightOfEditedEmployeeIfItIsAPic) is redistributed across the other
//     SA employees proportionally to their current weights. All employees'
//     monthlySalesTarget / monthlyTransactionTarget are then re-derived as
//     `storeTotal * weightPct / 100`.
//
// Both helpers operate on a plain array of rows and return a new array with
// updated `targetWeightPct`, `monthlySalesTarget`, `monthlyTransactionTarget`
// for every row (the caller persists each row's changes).
// ─────────────────────────────────────────────────────────────────────────────

export type RebalanceRow = {
  id: number;
  targetRoleCode: string;
  targetWeightPct: number;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
};

const PIC_ROLE_CODES = new Set(['PIC1', 'PIC2']);

/**
 * Amount-edit mode: one employee's sales and/or transaction target amount
 * changed directly. The store total (sum of all amounts) shifts by the
 * delta, and every row's weightPct is recomputed as its (possibly
 * unchanged) amount divided by the new store total.
 */
export function rebalanceAfterAmountEdit(params: {
  rows: RebalanceRow[];
  editedId: number;
  newMonthlySalesTarget: number;
  newMonthlyTransactionTarget: number;
}): RebalanceRow[] {
  const { rows, editedId, newMonthlySalesTarget, newMonthlyTransactionTarget } = params;

  const updatedAmounts = rows.map((row) =>
    row.id === editedId
      ? {
          ...row,
          monthlySalesTarget: newMonthlySalesTarget,
          monthlyTransactionTarget: newMonthlyTransactionTarget,
        }
      : row,
  );

  const storeTotalSales = updatedAmounts.reduce((sum, row) => sum + row.monthlySalesTarget, 0);

  return updatedAmounts.map((row) => ({
    ...row,
    targetWeightPct: safeContribution(row.monthlySalesTarget, storeTotalSales),
  }));
}

/**
 * Weight-edit mode: one employee's weightPct changed directly. The store
 * total (sales + transactions) stays fixed.
 *
 * - If the edited row is PIC1/PIC2: its new weight is applied as-is. Other
 *   PIC rows are untouched. The SA pool = 100 - sum(all PIC weights
 *   including the edited one) is redistributed across SA rows
 *   proportionally to their current weights.
 *
 * - If the edited row is an SA (or any non-PIC role): PIC rows are
 *   untouched. The SA pool = 100 - sum(PIC weights). The edited SA gets its
 *   new weight (clamped to the SA pool); the remaining SA pool is
 *   distributed across the OTHER SA rows proportionally to their current
 *   weights. If there are no other SA rows, the edited row simply takes the
 *   full SA pool.
 *
 * All rows' monthlySalesTarget / monthlyTransactionTarget are then
 * re-derived as `storeTotal * weightPct / 100`, rounded to whole numbers,
 * with any rounding remainder assigned to the edited row so totals still
 * reconcile to the (fixed) store total.
 */
export function rebalanceAfterWeightEdit(params: {
  rows: RebalanceRow[];
  editedId: number;
  newWeightPct: number;
}): RebalanceRow[] {
  const { rows, editedId, newWeightPct } = params;

  const storeTotalSales = rows.reduce((sum, row) => sum + row.monthlySalesTarget, 0);
  const storeTotalTransactions = rows.reduce((sum, row) => sum + row.monthlyTransactionTarget, 0);

  const editedRow = rows.find((row) => row.id === editedId);
  if (!editedRow) return rows;

  const editedIsPic = PIC_ROLE_CODES.has(editedRow.targetRoleCode);

  const weights = new Map<number, number>();

  if (editedIsPic) {
    // Other PIC rows keep their weight; edited PIC gets the new weight.
    const otherPicTotal = rows
      .filter((row) => PIC_ROLE_CODES.has(row.targetRoleCode) && row.id !== editedId)
      .reduce((sum, row) => sum + row.targetWeightPct, 0);

    const clampedNewWeight = Math.max(0, Math.min(100 - otherPicTotal, newWeightPct));
    weights.set(editedId, clampedNewWeight);

    const saPool = 100 - otherPicTotal - clampedNewWeight;
    const saRows = rows.filter((row) => !PIC_ROLE_CODES.has(row.targetRoleCode));
    const saCurrentTotal = saRows.reduce((sum, row) => sum + row.targetWeightPct, 0);

    for (const row of saRows) {
      const share = saCurrentTotal > 0 ? row.targetWeightPct / saCurrentTotal : 1 / Math.max(saRows.length, 1);
      weights.set(row.id, saPool * share);
    }
  } else {
    // Non-PIC (SA) row edited. PIC rows keep their weight.
    const picTotal = rows
      .filter((row) => PIC_ROLE_CODES.has(row.targetRoleCode))
      .reduce((sum, row) => sum + row.targetWeightPct, 0);

    const saPool = 100 - picTotal;
    const clampedNewWeight = Math.max(0, Math.min(saPool, newWeightPct));
    weights.set(editedId, clampedNewWeight);

    const otherSaRows = rows.filter(
      (row) => !PIC_ROLE_CODES.has(row.targetRoleCode) && row.id !== editedId,
    );
    const remainingPool = saPool - clampedNewWeight;
    const otherSaCurrentTotal = otherSaRows.reduce((sum, row) => sum + row.targetWeightPct, 0);

    for (const row of otherSaRows) {
      const share = otherSaCurrentTotal > 0
        ? row.targetWeightPct / otherSaCurrentTotal
        : 1 / Math.max(otherSaRows.length, 1);
      weights.set(row.id, remainingPool * share);
    }

    // PIC rows keep their weight as-is.
    for (const row of rows) {
      if (PIC_ROLE_CODES.has(row.targetRoleCode)) weights.set(row.id, row.targetWeightPct);
    }
  }

  // Derive amounts from the new weights, fixing store totals exactly by
  // giving any rounding remainder to the edited row.
  const result: RebalanceRow[] = rows.map((row) => {
    const weightPct = weights.get(row.id) ?? row.targetWeightPct;
    return {
      ...row,
      targetWeightPct: Math.round(weightPct * 100) / 100,
      monthlySalesTarget: Math.round((storeTotalSales * weightPct) / 100),
      monthlyTransactionTarget: Math.round((storeTotalTransactions * weightPct) / 100),
    };
  });

  const salesDelta = storeTotalSales - result.reduce((sum, row) => sum + row.monthlySalesTarget, 0);
  const txDelta = storeTotalTransactions - result.reduce((sum, row) => sum + row.monthlyTransactionTarget, 0);

  return result.map((row) =>
    row.id === editedId
      ? {
          ...row,
          monthlySalesTarget: row.monthlySalesTarget + salesDelta,
          monthlyTransactionTarget: row.monthlyTransactionTarget + txDelta,
        }
      : row,
  );
}

export async function getScheduledDaysForEmployeeInStore(params: {
  userId: string;
  storeId: number;
  yearMonth: string;
}) {
  const { start, end } = getMonthRange(params.yearMonth);

  const rows = await db
    .select({ date: schedules.date })
    .from(schedules)
    .where(
      and(
        eq(schedules.userId, params.userId),
        eq(schedules.storeId, params.storeId),
        gte(schedules.date, start),
        lt(schedules.date, end),
      ),
    );

  return new Set(rows.map((row) => toDateOnly(row.date))).size;
}

export async function ensureStoreMonthlyTargetPlan(params: {
  storeId: number;
  yearMonth: string;
  createdBy?: string | null;
  notes?: string | null;
}) {
  const [existing] = await db
    .select({ id: storeMonthlyTargets.id })
    .from(storeMonthlyTargets)
    .where(
      and(
        eq(storeMonthlyTargets.storeId, params.storeId),
        eq(storeMonthlyTargets.yearMonth, params.yearMonth),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(storeMonthlyTargets)
    .values({
      storeId: params.storeId,
      yearMonth: params.yearMonth,
      targetSource: 'employee_rollup',
      notes: params.notes ?? 'Store target is automatically calculated from employee targets.',
      createdBy: params.createdBy ?? undefined,
      updatedBy: params.createdBy ?? undefined,
      isActive: true,
    })
    .returning({ id: storeMonthlyTargets.id });

  return created.id;
}

/**
 * Store target source of truth:
 * Sum all active employee targets for this store + month.
 *
 * storeMonthlyAtvTarget is derived from the summed sales/transaction
 * totals (not averaged from individual employee ATV values).
 */
export async function getStoreMonthlyTargetRollup(params: {
  storeId: number;
  yearMonth: string;
}): Promise<StoreMonthlyTargetRollup> {
  const [plan] = await db
    .select({ id: storeMonthlyTargets.id })
    .from(storeMonthlyTargets)
    .where(
      and(
        eq(storeMonthlyTargets.storeId, params.storeId),
        eq(storeMonthlyTargets.yearMonth, params.yearMonth),
        eq(storeMonthlyTargets.isActive, true),
      ),
    )
    .limit(1);

  const employeeTargets = await db
    .select({
      monthlySalesTarget: employeeMonthlyTargets.monthlySalesTarget,
      monthlyTransactionTarget: employeeMonthlyTargets.monthlyTransactionTarget,
    })
    .from(employeeMonthlyTargets)
    .where(
      and(
        eq(employeeMonthlyTargets.storeId, params.storeId),
        eq(employeeMonthlyTargets.yearMonth, params.yearMonth),
        eq(employeeMonthlyTargets.isActive, true),
      ),
    );

  const storeMonthlySalesTarget = employeeTargets.reduce(
    (sum, row) => sum + safeNumber(row.monthlySalesTarget),
    0,
  );

  const storeMonthlyTransactionTarget = employeeTargets.reduce(
    (sum, row) => sum + safeNumber(row.monthlyTransactionTarget),
    0,
  );

  return {
    storeMonthlyTargetId: plan?.id ?? null,
    storeId: params.storeId,
    yearMonth: params.yearMonth,
    storeMonthlySalesTarget,
    storeMonthlyTransactionTarget,
    storeMonthlyAtvTarget: calculateAtvTarget(
      storeMonthlySalesTarget,
      storeMonthlyTransactionTarget,
    ),
    employeeTargetCount: employeeTargets.length,
  };
}

/**
 * Per-employee target rows for a store + month.
 *
 * monthlyAtvTarget is ALWAYS derived from monthlySalesTarget /
 * monthlyTransactionTarget — the stored employee_monthly_targets.monthlyAtvTarget
 * column is ignored here so edits to sales/transaction targets are
 * immediately reflected without a separate ATV update.
 */
export async function listStoreEmployeeTargets(params: {
  storeId: number;
  yearMonth: string;
}): Promise<StoreEmployeeTargetRow[]> {
  const rows = await db
    .select({
      id: employeeMonthlyTargets.id,
      userId: users.id,
      nik: users.nik,
      name: users.name,
      storeId: stores.id,
      storeNo: stores.storeNo,
      storeName: stores.name,
      yearMonth: employeeMonthlyTargets.yearMonth,
      targetRoleCode: employeeMonthlyTargets.targetRoleCode,
      targetWeightPct: employeeMonthlyTargets.targetWeightPct,
      monthlySalesTarget: employeeMonthlyTargets.monthlySalesTarget,
      monthlyTransactionTarget: employeeMonthlyTargets.monthlyTransactionTarget,
      isActive: employeeMonthlyTargets.isActive,
    })
    .from(employeeMonthlyTargets)
    .innerJoin(users, eq(users.id, employeeMonthlyTargets.userId))
    .innerJoin(stores, eq(stores.id, employeeMonthlyTargets.storeId))
    .where(
      and(
        eq(employeeMonthlyTargets.storeId, params.storeId),
        eq(employeeMonthlyTargets.yearMonth, params.yearMonth),
      ),
    )
    .orderBy(asc(employeeMonthlyTargets.targetRoleCode), asc(users.name));

  return rows.map((row) => {
    const monthlySalesTarget = safeNumber(row.monthlySalesTarget);
    const monthlyTransactionTarget = safeNumber(row.monthlyTransactionTarget);

    return {
      ...row,
      targetWeightPct: safeNumber(row.targetWeightPct),
      monthlySalesTarget,
      monthlyTransactionTarget,
      monthlyAtvTarget: calculateAtvTarget(monthlySalesTarget, monthlyTransactionTarget),
    };
  });
}

export async function resolvePerformanceTargets(params: {
  userId: string;
  storeId: number;
  yearMonth: string;
}): Promise<PerformanceTargetResult> {
  const [employeeTarget] = await db
    .select()
    .from(employeeMonthlyTargets)
    .where(
      and(
        eq(employeeMonthlyTargets.userId, params.userId),
        eq(employeeMonthlyTargets.storeId, params.storeId),
        eq(employeeMonthlyTargets.yearMonth, params.yearMonth),
        eq(employeeMonthlyTargets.isActive, true),
      ),
    )
    .limit(1);

  const [rollup, scheduledDaysInMonth] = await Promise.all([
    getStoreMonthlyTargetRollup({
      storeId: params.storeId,
      yearMonth: params.yearMonth,
    }),
    getScheduledDaysForEmployeeInStore({
      userId: params.userId,
      storeId: params.storeId,
      yearMonth: params.yearMonth,
    }),
  ]);

  const employeeMonthlySalesTarget = safeNumber(employeeTarget?.monthlySalesTarget);
  const employeeMonthlyTransactionTarget = safeNumber(
    employeeTarget?.monthlyTransactionTarget,
  );

  // ATV target is always derived — never read from the stored column.
  const employeeMonthlyAtvTarget = calculateAtvTarget(
    employeeMonthlySalesTarget,
    employeeMonthlyTransactionTarget,
  );

  const dailySalesTarget = calculateDailyTarget(
    employeeMonthlySalesTarget,
    scheduledDaysInMonth,
  );

  const dailyTransactionTarget = calculateDailyTarget(
    employeeMonthlyTransactionTarget,
    scheduledDaysInMonth,
  );

  const source: TargetSource = employeeTarget
    ? 'employee'
    : rollup.employeeTargetCount > 0
      ? 'store_rollup_only'
      : 'none';

  return {
    ...rollup,

    employeeMonthlyTargetId: employeeTarget?.id ?? null,
    employeeMonthlySalesTarget,
    employeeMonthlyTransactionTarget,
    employeeMonthlyAtvTarget,
    employeeTargetRoleCode: employeeTarget?.targetRoleCode ?? null,
    employeeTargetWeightPct: safeNumber(employeeTarget?.targetWeightPct),

    scheduledDaysInMonth,

    dailySalesTarget,
    dailyTransactionTarget,

    source,
  };
}
// lib/performance/target-utils.ts
// ─────────────────────────────────────────────────────────────────────────────
// New target model (replaces the old "employee rollup" model):
//
//   1. Ops sets ONE number per store + month: monthlySalesTarget /
//      monthlyTransactionTarget, directly on store_monthly_targets.
//
//   2. That monthly figure is split evenly across every calendar day:
//        storeDailyTarget = storeMonthlyTarget / daysInMonth
//
//   3. Each day, the store's roster (employee_monthly_targets) is filtered
//      down to whoever is actually scheduled to work that day (`schedules`
//      table). Headcount = how many roster employees are present.
//
//   4. The daily target is split across those present employees using
//      target_allocation_templates — a % table keyed by (headcount,
//      slotCode), matching the printed PIC1/PIC2/SA1../SA5 grid. PIC1/PIC2
//      keep a fixed identity; SA employees are ranked into SA1, SA2, ... by
//      sortOrder among whoever is present that day (so if someone is off,
//      everyone else just shifts up a slot).
//
//   5. Ops can override one employee's % for one specific day
//      (daily_target_overrides). Every other employee scheduled that same
//      day is automatically rebalanced, proportional to the default
//      template, so the day always sums to 100%.
//
// Nothing about an employee's nominal target is stored directly anymore —
// it's always derived from steps 2-5, computed on read.
// ─────────────────────────────────────────────────────────────────────────────

import { and, asc, eq, gte, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  dailyTargetOverrides,
  employeeMonthlyTargets,
  schedules,
  storeMonthlyTargets,
  targetAllocationTemplates,
  users,
} from "@/lib/db/schema";

// ─── Basic date / number helpers ─────────────────────────────────────────────

const APP_TIME_ZONE = "Asia/Jakarta";

function getDatePartsInAppTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to resolve date in Asia/Jakarta.");
  }

  return { year, month, day };
}

/** Calendar date in the application's Asia/Jakarta business timezone. */
export function toDateOnly(date: Date) {
  const { year, month, day } = getDatePartsInAppTimeZone(date);
  return `${year}-${month}-${day}`;
}

/** Calendar month in the application's Asia/Jakarta business timezone. */
export function toYearMonth(date: Date) {
  const { year, month } = getDatePartsInAppTimeZone(date);
  return `${year}-${month}`;
}

export function getMonthRange(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  return { start, end };
}

/** Number of calendar days in a YYYY-MM month. */
export function getDaysInMonth(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

/** Every YYYY-MM-DD date key in a YYYY-MM month. */
export function listDateKeysInMonth(yearMonth: string): string[] {
  const days = getDaysInMonth(yearMonth);
  return Array.from({ length: days }, (_, i) => {
    const d = String(i + 1).padStart(2, "0");
    return `${yearMonth}-${d}`;
  });
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
export function calculateAtvTarget(
  salesTarget: number,
  transactionTarget: number,
) {
  if (!transactionTarget || transactionTarget <= 0) return 0;
  return Math.round(salesTarget / transactionTarget);
}

/** Store's whole-month target, expressed as its unrounded daily average. */
export function getStoreDailyTarget(params: {
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  yearMonth: string;
}) {
  const daysInMonth = getDaysInMonth(params.yearMonth);
  if (!daysInMonth) {
    return { dailySalesTarget: 0, dailyTransactionTarget: 0, daysInMonth: 0 };
  }

  return {
    dailySalesTarget: params.monthlySalesTarget / daysInMonth,
    dailyTransactionTarget: params.monthlyTransactionTarget / daysInMonth,
    daysInMonth,
  };
}

/**
 * Returns the exact whole-number store target for one date.
 *
 * The old implementation rounded the same monthly/day average independently
 * on every date. Over a full month that could add up to more or less than the
 * monthly target. This uses a deterministic cumulative distribution instead,
 * spreading any remainder across the month while guaranteeing that all dates
 * add back to the exact Ops-set store monthly target.
 */
function distributeMonthlyTargetToDate(params: {
  monthlyTarget: number;
  yearMonth: string;
  date: string;
}) {
  const daysInMonth = getDaysInMonth(params.yearMonth);
  const monthlyTarget = Math.max(
    0,
    Math.round(safeNumber(params.monthlyTarget)),
  );

  if (daysInMonth <= 0 || monthlyTarget <= 0) return 0;

  const day = Number(params.date.slice(8, 10));
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    throw new Error(
      `Invalid date ${params.date} for month ${params.yearMonth}.`,
    );
  }

  const allocatedBeforeToday = Math.floor(
    (monthlyTarget * (day - 1)) / daysInMonth,
  );
  const allocatedThroughToday = Math.floor((monthlyTarget * day) / daysInMonth);

  return allocatedThroughToday - allocatedBeforeToday;
}

export function getStoreDailyTargetForDate(params: {
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  yearMonth: string;
  date: string;
}) {
  return {
    dailySalesTarget: distributeMonthlyTargetToDate({
      monthlyTarget: params.monthlySalesTarget,
      yearMonth: params.yearMonth,
      date: params.date,
    }),
    dailyTransactionTarget: distributeMonthlyTargetToDate({
      monthlyTarget: params.monthlyTransactionTarget,
      yearMonth: params.yearMonth,
      date: params.date,
    }),
    daysInMonth: getDaysInMonth(params.yearMonth),
  };
}

/**
 * Largest-remainder allocation for a whole-number target. Every employee gets
 * their percentage share, while the final rounded rows still sum exactly to
 * the store target for that date.
 */
function allocateRoundedTarget<
  T extends { userId: string; effectivePct: number },
>(total: number, rows: T[]): Map<string, number> {
  const roundedTotal = Math.max(0, Math.round(safeNumber(total)));
  if (rows.length === 0) return new Map();

  const weightTotal = rows.reduce(
    (sum, row) => sum + Math.max(0, safeNumber(row.effectivePct)),
    0,
  );

  const weighted = rows.map((row, index) => {
    const weight =
      weightTotal > 0
        ? Math.max(0, safeNumber(row.effectivePct)) / weightTotal
        : 1 / rows.length;
    const raw = roundedTotal * weight;
    const floor = Math.floor(raw);

    return {
      userId: row.userId,
      index,
      floor,
      fraction: raw - floor,
    };
  });

  let remainder =
    roundedTotal - weighted.reduce((sum, row) => sum + row.floor, 0);

  const priority = [...weighted].sort(
    (a, b) => b.fraction - a.fraction || a.index - b.index,
  );

  const result = new Map(weighted.map((row) => [row.userId, row.floor]));

  for (let index = 0; index < priority.length && remainder > 0; index += 1) {
    const row = priority[index];
    result.set(row.userId, (result.get(row.userId) ?? 0) + 1);
    remainder -= 1;
  }

  return result;
}

// ─── Store monthly target (source of truth, set directly by Ops) ────────────

export type StoreMonthlyTargetInfo = {
  storeMonthlyTargetId: number | null;
  storeId: number;
  yearMonth: string;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  monthlyAtvTarget: number;
  isLocked: boolean;
  notes: string | null;
};

export async function getStoreMonthlyTarget(params: {
  storeId: number;
  yearMonth: string;
}): Promise<StoreMonthlyTargetInfo> {
  const [row] = await db
    .select()
    .from(storeMonthlyTargets)
    .where(
      and(
        eq(storeMonthlyTargets.storeId, params.storeId),
        eq(storeMonthlyTargets.yearMonth, params.yearMonth),
      ),
    )
    .limit(1);

  const monthlySalesTarget = safeNumber(row?.monthlySalesTarget);
  const monthlyTransactionTarget = safeNumber(row?.monthlyTransactionTarget);

  return {
    storeMonthlyTargetId: row?.id ?? null,
    storeId: params.storeId,
    yearMonth: params.yearMonth,
    monthlySalesTarget,
    monthlyTransactionTarget,
    monthlyAtvTarget: calculateAtvTarget(
      monthlySalesTarget,
      monthlyTransactionTarget,
    ),
    isLocked: row?.isLocked ?? false,
    notes: row?.notes ?? null,
  };
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
      targetSource: "manual",
      notes: params.notes ?? null,
      createdBy: params.createdBy ?? undefined,
      updatedBy: params.createdBy ?? undefined,
      isActive: true,
    })
    .returning({ id: storeMonthlyTargets.id });

  return created.id;
}

// ─── Roster (employee_monthly_targets, no amounts anymore) ──────────────────

export type RosterRow = {
  id: number;
  userId: string;
  nik: string;
  name: string;
  targetRoleCode: string; // PIC1 | PIC2 | SA
  sortOrder: number;
  isActive: boolean;
};

export async function listStoreRoster(params: {
  storeId: number;
  yearMonth: string;
}): Promise<RosterRow[]> {
  const rows = await db
    .select({
      id: employeeMonthlyTargets.id,
      userId: users.id,
      nik: users.nik,
      name: users.name,
      targetRoleCode: employeeMonthlyTargets.targetRoleCode,
      sortOrder: employeeMonthlyTargets.sortOrder,
      isActive: employeeMonthlyTargets.isActive,
    })
    .from(employeeMonthlyTargets)
    .innerJoin(users, eq(users.id, employeeMonthlyTargets.userId))
    .where(
      and(
        eq(employeeMonthlyTargets.storeId, params.storeId),
        eq(employeeMonthlyTargets.yearMonth, params.yearMonth),
        eq(employeeMonthlyTargets.isActive, true),
      ),
    )
    .orderBy(
      asc(employeeMonthlyTargets.targetRoleCode),
      asc(employeeMonthlyTargets.sortOrder),
      asc(users.name),
    );

  return rows;
}

// ─── Who's actually working a given store + day ──────────────────────────────

export async function getScheduledUserIdsForStoreDate(params: {
  storeId: number;
  date: string; // YYYY-MM-DD
}): Promise<Set<string>> {
  const dayStart = new Date(`${params.date}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const rows = await db
    .selectDistinct({ userId: schedules.userId })
    .from(schedules)
    .where(
      and(
        eq(schedules.storeId, params.storeId),
        gte(schedules.date, dayStart),
        lt(schedules.date, dayEnd),
      ),
    );

  return new Set(rows.map((row) => row.userId));
}

/** Whole month at once — used by the batched monthly rollup below. */
async function getScheduledUserIdsByDateForMonth(params: {
  storeId: number;
  yearMonth: string;
}): Promise<Map<string, Set<string>>> {
  const { start, end } = getMonthRange(params.yearMonth);

  const rows = await db
    .select({ userId: schedules.userId, date: schedules.date })
    .from(schedules)
    .where(
      and(
        eq(schedules.storeId, params.storeId),
        gte(schedules.date, start),
        lt(schedules.date, end),
      ),
    );

  const byDate = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = toDateOnly(row.date);
    const set = byDate.get(key) ?? new Set<string>();
    set.add(row.userId);
    byDate.set(key, set);
  }
  return byDate;
}

// ─── Slot assignment (pure — no DB access) ───────────────────────────────────

const PIC_SLOT_CODES = new Set(["PIC1", "PIC2"]);

export type SlotAssignment = RosterRow & {
  employeeMonthlyTargetId: number;
  slotCode: string; // PIC1 | PIC2 | SA1 | SA2 | ...
};

/**
 * Filters the monthly roster down to whoever is scheduled on a given day,
 * then assigns each present employee a slotCode: PIC1/PIC2 keep their fixed
 * identity, SA employees are re-ranked into SA1, SA2, ... by sortOrder among
 * only those present (so someone being off just shifts everyone else up).
 */
export function assignDailySlots(
  roster: RosterRow[],
  scheduledUserIds: Set<string>,
): SlotAssignment[] {
  const present = roster.filter((r) => scheduledUserIds.has(r.userId));

  const pics = present
    .filter((r) => PIC_SLOT_CODES.has(r.targetRoleCode))
    .sort((a, b) => a.targetRoleCode.localeCompare(b.targetRoleCode));

  const sas = present
    .filter((r) => !PIC_SLOT_CODES.has(r.targetRoleCode))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const assignments: SlotAssignment[] = [];

  for (const pic of pics) {
    assignments.push({
      ...pic,
      employeeMonthlyTargetId: pic.id,
      slotCode: pic.targetRoleCode,
    });
  }

  sas.forEach((sa, index) => {
    assignments.push({
      ...sa,
      employeeMonthlyTargetId: sa.id,
      slotCode: `SA${index + 1}`,
    });
  });

  return assignments;
}

// ─── Default % template lookup ───────────────────────────────────────────────

/** slotCode -> percentage, for one specific headcount. Empty map = no template row found. */
export async function getAllocationTemplateForHeadcount(
  headcount: number,
): Promise<Map<string, number>> {
  if (headcount <= 0) return new Map();

  const rows = await db
    .select({
      slotCode: targetAllocationTemplates.slotCode,
      percentage: targetAllocationTemplates.percentage,
    })
    .from(targetAllocationTemplates)
    .where(
      and(
        eq(targetAllocationTemplates.headcount, headcount),
        eq(targetAllocationTemplates.isActive, true),
      ),
    );

  return new Map(rows.map((r) => [r.slotCode, safeNumber(r.percentage)]));
}

/** The WHOLE template table at once, grouped by headcount. Used for batched monthly rollups. */
async function getFullAllocationTemplate(): Promise<
  Map<number, Map<string, number>>
> {
  const rows = await db
    .select({
      headcount: targetAllocationTemplates.headcount,
      slotCode: targetAllocationTemplates.slotCode,
      percentage: targetAllocationTemplates.percentage,
    })
    .from(targetAllocationTemplates)
    .where(eq(targetAllocationTemplates.isActive, true));

  const byHeadcount = new Map<number, Map<string, number>>();
  for (const row of rows) {
    const inner = byHeadcount.get(row.headcount) ?? new Map<string, number>();
    inner.set(row.slotCode, safeNumber(row.percentage));
    byHeadcount.set(row.headcount, inner);
  }
  return byHeadcount;
}

// ─── Rebalancing: locked (overridden) rows keep their %, the rest share the remainder ──

export type RebalanceInput = {
  id: string;
  defaultPct: number;
  /** null = not overridden, follows the default. A number = locked at that %. */
  lockedPct: number | null;
};

/**
 * Generalized "one person's % changed, everyone else auto-adjusts" helper.
 * Any number of rows can be locked (via daily_target_overrides). Locked rows
 * keep their set percentage (scaled down proportionally only in the edge
 * case where locked percentages alone would exceed 100%). The remaining pool
 * (100 - sum of locked %) is distributed across the unlocked rows,
 * proportional to their default template share.
 */
export function rebalanceDailyPercentages(
  slots: RebalanceInput[],
): { id: string; pct: number }[] {
  const locked = slots.filter((s) => s.lockedPct != null);
  const unlocked = slots.filter((s) => s.lockedPct == null);

  const lockedTotalRaw = locked.reduce(
    (sum, row) => sum + (row.lockedPct as number),
    0,
  );
  const lockedScale =
    lockedTotalRaw > 100 && lockedTotalRaw > 0 ? 100 / lockedTotalRaw : 1;

  const result = new Map<string, number>();
  for (const row of locked) {
    result.set(row.id, (row.lockedPct as number) * lockedScale);
  }

  const lockedTotal = lockedTotalRaw * lockedScale;
  const pool = Math.max(0, 100 - lockedTotal);
  const unlockedDefaultTotal = unlocked.reduce(
    (sum, row) => sum + row.defaultPct,
    0,
  );

  for (const row of unlocked) {
    const share =
      unlockedDefaultTotal > 0
        ? row.defaultPct / unlockedDefaultTotal
        : 1 / Math.max(unlocked.length, 1);
    result.set(row.id, pool * share);
  }

  return slots.map((s) => ({ id: s.id, pct: result.get(s.id) ?? 0 }));
}

/**
 * Pure combinator: given the day's present roster (already slot-assigned),
 * a template map (or null/empty => equal split), and any overrides, produce
 * each employee's default % and effective (post-rebalance) %.
 */
function resolveEffectivePercentages(
  assignments: SlotAssignment[],
  templateForHeadcount: Map<string, number> | undefined,
  overrideMap: Map<string, number>,
) {
  const headcount = assignments.length;
  if (headcount === 0)
    return {
      usedFallbackEqualSplit: false,
      rows: [] as (SlotAssignment & {
        defaultPct: number;
        effectivePct: number;
        isOverridden: boolean;
      })[],
    };

  const usedFallbackEqualSplit =
    !templateForHeadcount || templateForHeadcount.size === 0;
  const equalShare = 100 / headcount;

  const withDefaults = assignments.map((a) => ({
    ...a,
    defaultPct: usedFallbackEqualSplit
      ? equalShare
      : (templateForHeadcount!.get(a.slotCode) ?? equalShare),
  }));

  // Normalize so the defaults always sum to exactly 100, even if the source
  // template rows don't add up perfectly (rounding in the printed grid).
  const defaultSum =
    withDefaults.reduce((sum, r) => sum + r.defaultPct, 0) || 1;
  const normalized = withDefaults.map((r) => ({
    ...r,
    defaultPct: (r.defaultPct / defaultSum) * 100,
  }));

  const rebalanced = rebalanceDailyPercentages(
    normalized.map((r) => ({
      id: r.userId,
      defaultPct: r.defaultPct,
      lockedPct: overrideMap.has(r.userId)
        ? Math.max(0, Math.min(100, overrideMap.get(r.userId)!))
        : null,
    })),
  );

  const effectiveMap = new Map(rebalanced.map((r) => [r.id, r.pct]));

  return {
    usedFallbackEqualSplit,
    rows: normalized.map((r) => ({
      ...r,
      effectivePct: effectiveMap.get(r.userId) ?? r.defaultPct,
      isOverridden: overrideMap.has(r.userId),
    })),
  };
}

// ─── Single-day allocation (used by the "Harian" view + override editing) ───

export type DailyAllocationRow = {
  employeeMonthlyTargetId: number;
  userId: string;
  nik: string;
  name: string;
  targetRoleCode: string;
  slotCode: string;
  defaultPct: number;
  effectivePct: number;
  isOverridden: boolean;
  dailySalesTarget: number;
  dailyTransactionTarget: number;
};

export type DailyAllocationResult = {
  date: string;
  headcount: number;
  usedFallbackEqualSplit: boolean;
  storeDailySalesTarget: number;
  storeDailyTransactionTarget: number;
  rows: DailyAllocationRow[];
};

export async function computeDailyAllocations(params: {
  storeId: number;
  date: string; // YYYY-MM-DD
  yearMonth: string;
}): Promise<DailyAllocationResult> {
  const [storeMonthly, roster, scheduledUserIds] = await Promise.all([
    getStoreMonthlyTarget({
      storeId: params.storeId,
      yearMonth: params.yearMonth,
    }),
    listStoreRoster({ storeId: params.storeId, yearMonth: params.yearMonth }),
    getScheduledUserIdsForStoreDate({
      storeId: params.storeId,
      date: params.date,
    }),
  ]);

  const { dailySalesTarget, dailyTransactionTarget } =
    getStoreDailyTargetForDate({
      monthlySalesTarget: storeMonthly.monthlySalesTarget,
      monthlyTransactionTarget: storeMonthly.monthlyTransactionTarget,
      yearMonth: params.yearMonth,
      date: params.date,
    });

  const assignments = assignDailySlots(roster, scheduledUserIds);
  const headcount = assignments.length;

  const base: DailyAllocationResult = {
    date: params.date,
    headcount,
    usedFallbackEqualSplit: false,
    storeDailySalesTarget: dailySalesTarget,
    storeDailyTransactionTarget: dailyTransactionTarget,
    rows: [],
  };

  if (headcount === 0) return base;

  const [template, overrides] = await Promise.all([
    getAllocationTemplateForHeadcount(headcount),
    db
      .select({
        userId: dailyTargetOverrides.userId,
        percentage: dailyTargetOverrides.percentage,
      })
      .from(dailyTargetOverrides)
      .where(
        and(
          eq(dailyTargetOverrides.storeId, params.storeId),
          eq(dailyTargetOverrides.date, params.date),
        ),
      ),
  ]);

  const overrideMap = new Map<string, number>(
    overrides.map((override) => [
      override.userId,
      safeNumber(override.percentage),
    ]),
  );
  const { usedFallbackEqualSplit, rows } = resolveEffectivePercentages(
    assignments,
    template,
    overrideMap,
  );

  const salesTargets = allocateRoundedTarget(dailySalesTarget, rows);
  const transactionTargets = allocateRoundedTarget(
    dailyTransactionTarget,
    rows,
  );

  return {
    ...base,
    usedFallbackEqualSplit,
    rows: rows.map((row) => ({
      employeeMonthlyTargetId: row.employeeMonthlyTargetId,
      userId: row.userId,
      nik: row.nik,
      name: row.name,
      targetRoleCode: row.targetRoleCode,
      slotCode: row.slotCode,
      defaultPct: Math.round(row.defaultPct * 100) / 100,
      effectivePct: Math.round(row.effectivePct * 100) / 100,
      isOverridden: row.isOverridden,
      dailySalesTarget: salesTargets.get(row.userId) ?? 0,
      dailyTransactionTarget: transactionTargets.get(row.userId) ?? 0,
    })),
  };
}

// ─── Batched monthly rollup (used by the "Bulanan" view — one pass, no N+1) ──

export type MonthlyAllocationSummary = {
  storeMonthlySalesTarget: number;
  storeMonthlyTransactionTarget: number;
  byUserId: Map<
    string,
    {
      userId: string;
      monthlySalesTarget: number;
      monthlyTransactionTarget: number;
      scheduledDays: number;
    }
  >;
};

/**
 * Walks every day of the month IN MEMORY (schedules, overrides, and the
 * template are each fetched once) and sums each roster employee's daily
 * allocation. Used for the "Bulanan" (monthly) view and for an employee's
 * own monthly total in employee-performance.ts.
 */
export async function computeMonthlyAllocationSummary(params: {
  storeId: number;
  yearMonth: string;
}): Promise<MonthlyAllocationSummary> {
  const [storeMonthly, roster, scheduledByDate, fullTemplate] =
    await Promise.all([
      getStoreMonthlyTarget({
        storeId: params.storeId,
        yearMonth: params.yearMonth,
      }),
      listStoreRoster({ storeId: params.storeId, yearMonth: params.yearMonth }),
      getScheduledUserIdsByDateForMonth({
        storeId: params.storeId,
        yearMonth: params.yearMonth,
      }),
      getFullAllocationTemplate(),
    ]);

  // `date` is stored as YYYY-MM-DD text, so lexicographic bounds double as a
  // date range — no need to parse into a real Date for this comparison.
  const monthStartKey = `${params.yearMonth}-01`;
  const monthEndKey = `${params.yearMonth}-32`; // exclusive upper bound, covers day 31

  const overrideRows = await db
    .select({
      date: dailyTargetOverrides.date,
      userId: dailyTargetOverrides.userId,
      percentage: dailyTargetOverrides.percentage,
    })
    .from(dailyTargetOverrides)
    .where(
      and(
        eq(dailyTargetOverrides.storeId, params.storeId),
        gte(dailyTargetOverrides.date, monthStartKey),
        lt(dailyTargetOverrides.date, monthEndKey),
      ),
    );

  const overridesByDate = new Map<string, Map<string, number>>();
  for (const row of overrideRows) {
    const inner = overridesByDate.get(row.date) ?? new Map<string, number>();
    inner.set(row.userId, safeNumber(row.percentage));
    overridesByDate.set(row.date, inner);
  }

  const byUserId = new Map<
    string,
    {
      userId: string;
      monthlySalesTarget: number;
      monthlyTransactionTarget: number;
      scheduledDays: number;
    }
  >();

  for (const [date, scheduledUserIds] of scheduledByDate.entries()) {
    const assignments = assignDailySlots(roster, scheduledUserIds);
    if (assignments.length === 0) continue;

    const templateForHeadcount = fullTemplate.get(assignments.length);
    const overrideMap = overridesByDate.get(date) ?? new Map<string, number>();
    const { rows } = resolveEffectivePercentages(
      assignments,
      templateForHeadcount,
      overrideMap,
    );

    const { dailySalesTarget, dailyTransactionTarget } =
      getStoreDailyTargetForDate({
        monthlySalesTarget: storeMonthly.monthlySalesTarget,
        monthlyTransactionTarget: storeMonthly.monthlyTransactionTarget,
        yearMonth: params.yearMonth,
        date,
      });

    const salesTargets = allocateRoundedTarget(dailySalesTarget, rows);
    const transactionTargets = allocateRoundedTarget(
      dailyTransactionTarget,
      rows,
    );

    for (const row of rows) {
      const entry = byUserId.get(row.userId) ?? {
        userId: row.userId,
        monthlySalesTarget: 0,
        monthlyTransactionTarget: 0,
        scheduledDays: 0,
      };
      entry.monthlySalesTarget += salesTargets.get(row.userId) ?? 0;
      entry.monthlyTransactionTarget += transactionTargets.get(row.userId) ?? 0;
      entry.scheduledDays += 1;
      byUserId.set(row.userId, entry);
    }
  }

  return {
    storeMonthlySalesTarget: storeMonthly.monthlySalesTarget,
    storeMonthlyTransactionTarget: storeMonthly.monthlyTransactionTarget,
    byUserId,
  };
}

/** Convenience wrapper for a single employee (e.g. their own dashboard). */
export async function computeEmployeeMonthlyTargetFromDailyAllocations(params: {
  storeId: number;
  userId: string;
  yearMonth: string;
}) {
  const summary = await computeMonthlyAllocationSummary({
    storeId: params.storeId,
    yearMonth: params.yearMonth,
  });
  return (
    summary.byUserId.get(params.userId) ?? {
      userId: params.userId,
      monthlySalesTarget: 0,
      monthlyTransactionTarget: 0,
      scheduledDays: 0,
    }
  );
}

// ─── Daily override CRUD ─────────────────────────────────────────────────────

export async function setDailyTargetOverride(params: {
  storeId: number;
  date: string; // YYYY-MM-DD
  userId: string;
  percentage: number;
  updatedBy?: string | null;
}) {
  const clamped = Math.max(0, Math.min(100, safeNumber(params.percentage)));

  const [existing] = await db
    .select({ id: dailyTargetOverrides.id })
    .from(dailyTargetOverrides)
    .where(
      and(
        eq(dailyTargetOverrides.storeId, params.storeId),
        eq(dailyTargetOverrides.date, params.date),
        eq(dailyTargetOverrides.userId, params.userId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(dailyTargetOverrides)
      .set({
        percentage: clamped.toFixed(2),
        updatedBy: params.updatedBy ?? undefined,
      })
      .where(eq(dailyTargetOverrides.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(dailyTargetOverrides)
    .values({
      storeId: params.storeId,
      date: params.date,
      userId: params.userId,
      percentage: clamped.toFixed(2),
      createdBy: params.updatedBy ?? undefined,
      updatedBy: params.updatedBy ?? undefined,
    })
    .returning({ id: dailyTargetOverrides.id });

  return created.id;
}

export async function clearDailyTargetOverride(params: {
  storeId: number;
  date: string;
  userId: string;
}) {
  await db
    .delete(dailyTargetOverrides)
    .where(
      and(
        eq(dailyTargetOverrides.storeId, params.storeId),
        eq(dailyTargetOverrides.date, params.date),
        eq(dailyTargetOverrides.userId, params.userId),
      ),
    );
}

// ─── Employee-facing resolver (used by employee-performance.ts) ─────────────

export type PerformanceTargetResult = {
  storeMonthlyTargetId: number | null;
  storeId: number;
  yearMonth: string;
  storeMonthlySalesTarget: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyAtvTarget: number;

  employeeMonthlyTargetId: number | null;
  employeeTargetRoleCode: string | null;
  /** Today's slot (e.g. "SA2") — null if the employee isn't scheduled today. */
  employeeSlotCode: string | null;

  employeeMonthlySalesTarget: number;
  employeeMonthlyTransactionTarget: number;
  employeeMonthlyAtvTarget: number;
  scheduledDaysInMonth: number;

  /** Employee target for the selected day. */
  dailySalesTarget: number;
  dailyTransactionTarget: number;
  /** Employee's target share of the store daily target. */
  dailyAllocationPct: number;
  /** Employee's target share of the store monthly target. */
  monthlyAllocationPct: number;
  isScheduledToday: boolean;

  /** The STORE's whole daily target (monthly ÷ days-in-month) — not the employee's own slice. */
  storeDailySalesTarget: number;
  storeDailyTransactionTarget: number;

  /** roster = on the store's target roster this month; not_on_roster = employee has no roster row; no_store_target = Ops hasn't set a monthly target yet. */
  source: "roster" | "not_on_roster" | "no_store_target";
};

export async function resolvePerformanceTargets(params: {
  userId: string;
  storeId: number;
  yearMonth: string;
  /** The day used for the "today" figures — defaults to today if omitted. */
  date?: string;
}): Promise<PerformanceTargetResult> {
  const date = params.date ?? toDateOnly(new Date());

  const [storeMonthly, roster, todayAllocations, monthly] = await Promise.all([
    getStoreMonthlyTarget({
      storeId: params.storeId,
      yearMonth: params.yearMonth,
    }),
    listStoreRoster({ storeId: params.storeId, yearMonth: params.yearMonth }),
    computeDailyAllocations({
      storeId: params.storeId,
      date,
      yearMonth: params.yearMonth,
    }),
    computeEmployeeMonthlyTargetFromDailyAllocations({
      storeId: params.storeId,
      userId: params.userId,
      yearMonth: params.yearMonth,
    }),
  ]);

  const rosterRow = roster.find((r) => r.userId === params.userId) ?? null;
  const todayRow =
    todayAllocations.rows.find((r) => r.userId === params.userId) ?? null;

  const source: PerformanceTargetResult["source"] =
    !storeMonthly.storeMonthlyTargetId
      ? "no_store_target"
      : rosterRow
        ? "roster"
        : "not_on_roster";

  return {
    storeMonthlyTargetId: storeMonthly.storeMonthlyTargetId,
    storeId: params.storeId,
    yearMonth: params.yearMonth,
    storeMonthlySalesTarget: storeMonthly.monthlySalesTarget,
    storeMonthlyTransactionTarget: storeMonthly.monthlyTransactionTarget,
    storeMonthlyAtvTarget: storeMonthly.monthlyAtvTarget,

    employeeMonthlyTargetId: rosterRow?.id ?? null,
    employeeTargetRoleCode: rosterRow?.targetRoleCode ?? null,
    employeeSlotCode: todayRow?.slotCode ?? null,

    employeeMonthlySalesTarget: monthly.monthlySalesTarget,
    employeeMonthlyTransactionTarget: monthly.monthlyTransactionTarget,
    employeeMonthlyAtvTarget: calculateAtvTarget(
      monthly.monthlySalesTarget,
      monthly.monthlyTransactionTarget,
    ),
    scheduledDaysInMonth: monthly.scheduledDays,

    dailySalesTarget: todayRow?.dailySalesTarget ?? 0,
    dailyTransactionTarget: todayRow?.dailyTransactionTarget ?? 0,
    dailyAllocationPct: todayRow?.effectivePct ?? 0,
    monthlyAllocationPct: safeContribution(
      monthly.monthlySalesTarget,
      storeMonthly.monthlySalesTarget,
    ),
    isScheduledToday: Boolean(todayRow),

    storeDailySalesTarget: todayAllocations.storeDailySalesTarget,
    storeDailyTransactionTarget: todayAllocations.storeDailyTransactionTarget,

    source,
  };
}

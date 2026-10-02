// lib/performance/target-view.ts
//
// Pure, client-safe view logic for /ops/performance-targets: the API payload
// types, number formatting, the month's progress, store health, search and sort.
// No DB / server imports — the page and its components import from here.
//
// Vocabulary
//   • pct      sales achieved ÷ the store's monthly sales target (not capped).
//   • pace     where the store *should* be now: elapsed days ÷ days in month,
//              with today as half a day (a past month is expected at 100%, a
//              future month at 0%). It only decides a store's health bucket
//              (on track / watch / behind) — the number itself is not shown.

import { daysInMonthKey, jakartaTodayKey } from '@/lib/day-bucket';
import type { StoreStatus } from '@/lib/store-status';

// ─── API payloads ─────────────────────────────────────────────────────────────

export type ViewPeriod = 'daily' | 'monthly';

export type StoreRollup = {
  storeMonthlyTargetId: number | null;
  storeId: number;
  yearMonth: string;
  storeMonthlySalesTarget: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyAtvTarget: number;
  rosterCount: number;
  storeActualSales: number;
  storeActualTransactionCount: number;
  actualsAvailable: boolean;
};

export type StoreRow = {
  id: number;
  storeNo: string;
  name: string;
  address: string;
  areaId: number | null;
  areaName: string | null;
  /** Lifecycle — closed stores are hidden from the list by default. */
  status: StoreStatus;
  rollup: StoreRollup;
};

export type OverviewResponse = {
  success: boolean;
  error?: string;
  yearMonth: string;
  scope: 'area' | 'all_areas';
  areaId: number | null;
  stores: StoreRow[];
};

export type PlanRow = {
  id: number;
  storeId: number;
  yearMonth: string;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  notes: string | null;
};

export type EmployeeTargetRow = {
  id: number;
  userId: string;
  nik: string;
  name: string;
  targetRoleCode: string; // PIC1 | PIC2 | SA
  slotCode: string; // PIC1 | PIC2 | SA1... — fixed for the whole month
  percentage: number; // fixed monthly % share of the store's monthly target
  isPercentageOverridden: boolean;
  scheduledDays: number;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  dailySalesTarget: number; // flat: monthlySalesTarget / scheduledDays
  dailyTransactionTarget: number;
  isScheduledToday: boolean;
  displaySalesTarget: number;
  displayTransactionTarget: number;
  actualSales: number;
  actualTransactionCount: number;
};

export type DetailResponse = {
  success: boolean;
  error?: string;
  yearMonth: string;
  period: ViewPeriod;
  date: string | null;
  scope: 'area' | 'all_areas';
  store: { id: number; storeNo: string; name: string; address: string; areaId: number | null; areaName: string | null };
  plan: PlanRow | null;
  rollup: {
    storeMonthlyTargetId: number | null;
    storeId: number;
    yearMonth: string;
    storeMonthlySalesTarget: number;
    storeMonthlyTransactionTarget: number;
    storeMonthlyAtvTarget: number;
    rosterCount: number;
  };
  rosterMeta: { headcount: number; usedFallbackEqualSplit: boolean } | null;
  employeeTargets: EmployeeTargetRow[];
  actuals: {
    available: boolean;
    error?: string;
    storeActualSales: number;
    storeActualTransactionCount: number;
  };
  storeDisplaySalesTarget: number;
  storeDisplayTransactionTarget: number;
};

export type EligibleEmployee = {
  id: string;
  nik: string;
  name: string;
  hasTarget: boolean;
};

// ─── Formatting ───────────────────────────────────────────────────────────────

const idNumber = (n: number, maxFraction = 0) =>
  n.toLocaleString('id-ID', { maximumFractionDigits: maxFraction });

/** "Rp 1.234.567" */
export function fmtRp(value: number): string {
  return `Rp ${idNumber(Math.round(value))}`;
}

/** "Rp 1,2M" · "Rp 186jt" · "Rp 18,6jt" · "Rp 850rb" — for tight spaces. */
export function fmtRpCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `Rp ${idNumber(value / 1e9, 1)}M`;
  if (abs >= 1e8) return `Rp ${idNumber(value / 1e6, 0)}jt`;
  if (abs >= 1e6) return `Rp ${idNumber(value / 1e6, 1)}jt`;
  if (abs >= 1e3) return `Rp ${idNumber(value / 1e3, 0)}rb`;
  return fmtRp(value);
}

export function fmtCount(value: number): string {
  return idNumber(Math.round(value));
}

export function pctOf(actual: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.round((actual / target) * 100);
}

/** "2026-10" → "Oktober 2026" */
export function fmtMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

/** "2026-10" → "Okt 2026" */
export function fmtMonthShort(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

/** "2026-10-02" → "Jumat, 02 Oktober 2026" */
export function fmtDateLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

/** "2026-10-02" → "Jum, 02 Okt 2026" */
export function fmtDayShort(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function shiftYearMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Month progress ───────────────────────────────────────────────────────────

export type MonthPhase = {
  phase: 'past' | 'current' | 'future';
  /** Days in the month. */
  days: number;
  /** Days elapsed including today (current), all (past) or none (future). */
  elapsed: number;
  /** Days still to sell, including today (current), 0 (past) or all (future). */
  daysLeft: number;
  /** Where a store should be by now, % of the month's target. */
  expectedPct: number;
};

export function monthPhase(yearMonth: string, todayKey: string = jakartaTodayKey()): MonthPhase {
  const days = daysInMonthKey(yearMonth);
  const todayMonth = todayKey.slice(0, 7);

  if (yearMonth < todayMonth) return { phase: 'past', days, elapsed: days, daysLeft: 0, expectedPct: 100 };
  if (yearMonth > todayMonth) return { phase: 'future', days, elapsed: 0, daysLeft: days, expectedPct: 0 };

  const day = Number(todayKey.slice(8, 10));
  return {
    phase: 'current',
    days,
    elapsed: day,
    daysLeft: days - day + 1,
    // Today is only partly sold, so it counts as half a day — otherwise every
    // store looks behind on the 1st and 2nd.
    expectedPct: Math.round(((day - 0.5) / days) * 100),
  };
}

/** What is still missing, and the daily run-rate needed to close it. */
export function runRate(target: number, actual: number, phase: MonthPhase) {
  const remaining = Math.max(0, target - actual);
  const perDay = phase.phase === 'current' && phase.daysLeft > 0 ? remaining / phase.daysLeft : null;
  return { remaining, perDay };
}

// ─── Store health ─────────────────────────────────────────────────────────────

export type Tone = 'emerald' | 'amber' | 'rose' | 'indigo' | 'slate';

export type StoreHealth =
  | 'achieved' // ≥ 100% of the monthly target
  | 'on_track' // at or near pace
  | 'watch' // somewhat behind pace
  | 'behind' // clearly behind pace
  | 'upcoming' // future month, target set — nothing sold yet
  | 'no_target' // no sales target for the month
  | 'no_data'; // target set but Business Central actuals unavailable

/** A current-month store this close to (or past) pace still counts as on track. */
export const ON_TRACK_TOLERANCE_PT = 4;
/** Further behind than this (percentage points) is "behind", not just "watch". */
export const WATCH_BAND_PT = 12;

export const HEALTH_META: Record<StoreHealth, { label: string; tone: Tone; rank: number }> = {
  behind: { label: 'Tertinggal', tone: 'rose', rank: 0 },
  watch: { label: 'Waspada', tone: 'amber', rank: 1 },
  no_target: { label: 'Belum target', tone: 'amber', rank: 2 },
  no_data: { label: 'Tanpa data', tone: 'slate', rank: 3 },
  upcoming: { label: 'Siap', tone: 'indigo', rank: 4 },
  on_track: { label: 'On track', tone: 'emerald', rank: 5 },
  achieved: { label: 'Tercapai', tone: 'emerald', rank: 6 },
};

export type StoreAssessment = {
  health: StoreHealth;
  hasTarget: boolean;
  /** Sales % of target, uncapped (0 without a target). */
  pct: number;
  /** Transaction % of target (0 without a target). */
  txPct: number;
  /** Nobody on the month's Team — per-employee targets can't be split. */
  noTeam: boolean;
  /** Needs Ops action: no target and/or no Team. */
  needsSetup: boolean;
};

export type ProgressHealth = Extract<StoreHealth, 'achieved' | 'on_track' | 'watch' | 'behind'>;

/**
 * Health of a progress figure (sales %, or a network total) against the
 * month's pace. Only meaningful for a current or past month that has actuals.
 */
export function classifyProgress(pct: number, phase: MonthPhase): ProgressHealth {
  const gapPt = pct - phase.expectedPct;
  if (pct >= 100) return 'achieved';
  if (phase.phase === 'current' && gapPt >= -ON_TRACK_TOLERANCE_PT) return 'on_track';
  if (gapPt >= -WATCH_BAND_PT) return 'watch';
  return 'behind';
}

export function assessStore(row: StoreRow, phase: MonthPhase): StoreAssessment {
  const r = row.rollup;
  const hasTarget = r.storeMonthlySalesTarget > 0;
  const pct = hasTarget ? pctOf(r.storeActualSales, r.storeMonthlySalesTarget) : 0;
  const txPct = r.storeMonthlyTransactionTarget > 0
    ? pctOf(r.storeActualTransactionCount, r.storeMonthlyTransactionTarget)
    : 0;
  const noTeam = r.rosterCount === 0;

  let health: StoreHealth;

  if (!hasTarget) {
    health = 'no_target';
  } else if (phase.phase === 'future') {
    health = 'upcoming';
  } else if (!r.actualsAvailable) {
    health = 'no_data';
  } else {
    health = classifyProgress(pct, phase);
  }

  return { health, hasTarget, pct, txPct, noTeam, needsSetup: !hasTarget || noTeam };
}

export type AssessedStore = { row: StoreRow; a: StoreAssessment };

// ─── Filters ──────────────────────────────────────────────────────────────────

export type HealthFilter = 'all' | 'good' | 'watch' | 'behind' | 'setup' | 'upcoming' | 'nodata';

export const HEALTH_FILTERS: { key: HealthFilter; label: string; tone: Tone | null }[] = [
  { key: 'all', label: 'Semua', tone: null },
  { key: 'good', label: 'On track', tone: 'emerald' },
  { key: 'watch', label: 'Waspada', tone: 'amber' },
  { key: 'behind', label: 'Tertinggal', tone: 'rose' },
  { key: 'upcoming', label: 'Siap', tone: 'indigo' },
  { key: 'setup', label: 'Perlu setup', tone: 'amber' },
  { key: 'nodata', label: 'Tanpa data', tone: 'slate' },
];

export function matchesHealthFilter(a: StoreAssessment, filter: HealthFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'good': return a.health === 'achieved' || a.health === 'on_track';
    case 'watch': return a.health === 'watch';
    case 'behind': return a.health === 'behind';
    case 'upcoming': return a.health === 'upcoming';
    case 'setup': return a.needsSetup;
    case 'nodata': return a.health === 'no_data';
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Every word must match the store's code, name, area or address. Codes match
 * however they're typed: "ff001", "FF 001" and "ff-001" all find FF001.
 */
export function matchesSearch(row: StoreRow, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const hay = `${row.storeNo} ${row.name} ${row.areaName ?? ''} ${row.address}`.toLowerCase();
  const hayNorm = norm(hay);
  return tokens.every((t) => {
    const tn = norm(t);
    return hay.includes(t) || (tn.length > 0 && hayNorm.includes(tn));
  });
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

export type SortKey = 'name' | 'storeNo' | 'priority' | 'achievement' | 'sales' | 'target' | 'transactions' | 'team';
export type SortDir = 'asc' | 'desc';

export const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'name', label: 'Nama', defaultDir: 'asc' },
  { key: 'storeNo', label: 'Kode toko', defaultDir: 'asc' },
  { key: 'priority', label: 'Prioritas', defaultDir: 'asc' },
  { key: 'achievement', label: 'Pencapaian', defaultDir: 'desc' },
  { key: 'sales', label: 'Sales aktual', defaultDir: 'desc' },
  { key: 'target', label: 'Target sales', defaultDir: 'desc' },
  { key: 'transactions', label: 'Transaksi', defaultDir: 'desc' },
  { key: 'team', label: 'Jumlah Team', defaultDir: 'desc' },
];

export function defaultSortDir(key: SortKey): SortDir {
  return SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? 'asc';
}

const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });

function sortValue({ row, a }: AssessedStore, key: SortKey): number | string | null {
  const r = row.rollup;
  switch (key) {
    case 'name': return row.name;
    case 'storeNo': return row.storeNo;
    // Most urgent first; the store furthest below target leads within a bucket.
    case 'priority': return HEALTH_META[a.health].rank + a.pct / 10_000;
    case 'achievement': return a.hasTarget ? a.pct : null;
    case 'sales': return r.actualsAvailable ? r.storeActualSales : null;
    case 'target': return a.hasTarget ? r.storeMonthlySalesTarget : null;
    case 'transactions': return r.storeMonthlyTransactionTarget > 0 ? a.txPct : null;
    case 'team': return r.rosterCount;
  }
}

/** Rows without a value for the key always sort last, in either direction. */
export function compareStores(x: AssessedStore, y: AssessedStore, key: SortKey, dir: SortDir): number {
  const vx = sortValue(x, key);
  const vy = sortValue(y, key);
  const byName = () => collator.compare(x.row.name, y.row.name);

  if (vx === null && vy === null) return byName();
  if (vx === null) return 1;
  if (vy === null) return -1;

  const cmp = typeof vx === 'number' && typeof vy === 'number'
    ? vx - vy
    : collator.compare(String(vx), String(vy));
  if (cmp === 0) return byName();
  return dir === 'asc' ? cmp : -cmp;
}

// ─── Network summary ──────────────────────────────────────────────────────────

export type NetworkSummary = {
  storeCount: number;
  /** Stores with a sales target for the month. */
  plannedCount: number;
  noTeamCount: number;
  /** Sales / transactions only over stores that have a target, so % is like-for-like. */
  salesTarget: number;
  salesActual: number;
  transactionTarget: number;
  transactionActual: number;
  /** Plain totals over every store in scope — what to show when none has a target yet. */
  salesActualAll: number;
  transactionActualAll: number;
  counts: Record<StoreHealth, number>;
};

export function summarize(items: AssessedStore[]): NetworkSummary {
  const s: NetworkSummary = {
    storeCount: items.length,
    plannedCount: 0,
    noTeamCount: 0,
    salesTarget: 0,
    salesActual: 0,
    transactionTarget: 0,
    transactionActual: 0,
    salesActualAll: 0,
    transactionActualAll: 0,
    counts: { achieved: 0, on_track: 0, watch: 0, behind: 0, upcoming: 0, no_target: 0, no_data: 0 },
  };

  for (const { row, a } of items) {
    const r = row.rollup;
    s.counts[a.health] += 1;
    if (a.noTeam) s.noTeamCount += 1;
    s.salesActualAll += r.storeActualSales;
    s.transactionActualAll += r.storeActualTransactionCount;
    if (a.hasTarget) {
      s.plannedCount += 1;
      s.salesTarget += r.storeMonthlySalesTarget;
      s.salesActual += r.storeActualSales;
    }
    if (r.storeMonthlyTransactionTarget > 0) {
      s.transactionTarget += r.storeMonthlyTransactionTarget;
      s.transactionActual += r.storeActualTransactionCount;
    }
  }
  return s;
}

// ─── Team (employee) sorting ──────────────────────────────────────────────────

export type TeamSortKey = 'slot' | 'sales' | 'achievement' | 'name';

export const TEAM_SORT_OPTIONS: { key: TeamSortKey; label: string }[] = [
  { key: 'slot', label: 'Slot' },
  { key: 'sales', label: 'Sales aktual' },
  { key: 'achievement', label: 'Pencapaian' },
  { key: 'name', label: 'Nama' },
];

export function sortTeam(rows: EmployeeTargetRow[], key: TeamSortKey): EmployeeTargetRow[] {
  const bySlot = (a: EmployeeTargetRow, b: EmployeeTargetRow) =>
    collator.compare(a.slotCode, b.slotCode) || collator.compare(a.name, b.name);
  const achievement = (e: EmployeeTargetRow) => pctOf(e.actualSales, e.displaySalesTarget);

  return [...rows].sort((a, b) => {
    switch (key) {
      case 'slot': return bySlot(a, b);
      case 'name': return collator.compare(a.name, b.name);
      case 'sales': return b.actualSales - a.actualSales || bySlot(a, b);
      case 'achievement': return achievement(b) - achievement(a) || bySlot(a, b);
    }
  });
}

/** Targets the detail hero compares actuals against. */
export function heroTargets(detail: DetailResponse): { sales: number; transactions: number } {
  if (detail.period === 'monthly') {
    return {
      sales: detail.rollup.storeMonthlySalesTarget,
      transactions: detail.rollup.storeMonthlyTransactionTarget,
    };
  }
  // Daily: the scheduled employees' flat daily targets; with nobody on the Team
  // yet, fall back to an even slice of the monthly plan.
  const days = daysInMonthKey(detail.yearMonth);
  return {
    sales: detail.storeDisplaySalesTarget > 0
      ? detail.storeDisplaySalesTarget
      : Math.round(detail.rollup.storeMonthlySalesTarget / days),
    transactions: detail.storeDisplayTransactionTarget > 0
      ? detail.storeDisplayTransactionTarget
      : Math.round(detail.rollup.storeMonthlyTransactionTarget / days),
  };
}

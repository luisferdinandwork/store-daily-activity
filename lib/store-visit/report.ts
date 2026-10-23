import { jakartaDateKey } from '@/lib/day-bucket';
import { visitCycleView, type CycleSummary } from './cycles';
import type { VisitPolicy } from './types';

// Pure view logic for the Ops "Report Visit" page (/ops/store-visits/report).
// The server hands over raw visits; everything about cycles + ordering lives
// here so it can be tested without a database.

export interface ReportVisit {
  id: string;
  /** ISO instant. */
  at: string;
  byId?: string;
  by: string | null;
}

export interface ReportCycle {
  start: string;
  end: string;
  count: number;
  met: boolean;
}

export interface ReportStore {
  id: number;
  storeNo: string;
  name: string;
  areaId: number;
  areaName: string;
  /** The Ops Area user(s) assigned to the store's area. */
  opsNames: string[];
  policy: VisitPolicy | null;
  /** Current cycle — null while the store has no visit policy. */
  cycle: {
    start: string;
    end: string;
    daysLeft: number;
    count: number;
    remaining: number;
    met: boolean;
  } | null;
  /** Finished cycles, oldest first. */
  history: ReportCycle[];
  /** Visits that fall inside the current cycle, newest first. */
  visits: ReportVisit[];
  lastVisit: ReportVisit | null;
}

export interface ReportOps {
  id: string;
  name: string;
  areaId?: number | null;
  areaName: string | null;
  /** Visits in the last OPS_ACTIVITY_DAYS days. */
  visits: number;
  /** Distinct stores among those visits. */
  stores: number;
  lastVisitAt: string | null;
}

/** One visit, for the calendar. */
export interface CalendarVisit {
  id: string;
  storeId: number;
  /** ISO instant. */
  at: string;
  /** Jakarta day "YYYY-MM-DD". */
  day: string;
  byId: string;
  by: string | null;
}

export interface VisitReport {
  /** 'area' = one Ops Area's own planner; 'all' = Ops HO / IT watching every area. */
  scope: 'area' | 'all';
  today: string;
  trackedFrom: string | null;
  activityDays: number;
  /** "YYYY-MM" the calendar shows. */
  month: string;
  /** Every visit to a store in scope whose day falls in the weeks the month's calendar shows. */
  calendarVisits: CalendarVisit[];
  areas: { id: number; name: string }[];
  stores: ReportStore[];
  ops: ReportOps[];
}

/** The Monday-to-Sunday weeks a month's calendar shows (first Monday on/before the 1st). */
export function calendarWeeks(month: string): string[][] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const last = new Date(Date.UTC(y, m, 0));
  const weeks: string[][] = [];
  for (const d = new Date(start); d <= last; ) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const OPS_ACTIVITY_DAYS = 28;

export type ReportState = 'open' | 'met' | 'unset';

export function reportState(store: ReportStore): ReportState {
  if (!store.cycle) return 'unset';
  return store.cycle.met ? 'met' : 'open';
}

/** The cycle that just ended without enough visits (null = fine, or nothing to judge yet). */
export function missedLastCycle(store: ReportStore): ReportCycle | null {
  const last = store.history[store.history.length - 1];
  return last && !last.met ? last : null;
}

/** Consecutive finished cycles, newest first, that ended short. */
export function missedStreak(store: ReportStore): number {
  let n = 0;
  for (let i = store.history.length - 1; i >= 0 && !store.history[i].met; i--) n++;
  return n;
}

/**
 * Needs-attention order: stores that already missed their last cycle and are still
 * owed a visit come first, then the other open stores by how soon their cycle ends,
 * then the stores that are done, then the ones with no policy.
 */
export function attentionOrder(a: ReportStore, b: ReportStore): number {
  const rank = (s: ReportStore) => {
    const state = reportState(s);
    if (state === 'unset') return 3;
    if (state === 'met') return 2;
    return missedLastCycle(s) ? 0 : 1;
  };
  const diff = rank(a) - rank(b);
  if (diff) return diff;
  if (a.cycle && b.cycle && !a.cycle.met) {
    return missedStreak(b) - missedStreak(a) || a.cycle.daysLeft - b.cycle.daysLeft || a.name.localeCompare(b.name);
  }
  return a.name.localeCompare(b.name);
}

export interface ReportTotals {
  withPolicy: number;
  open: number;
  met: number;
  unset: number;
  /** Stores whose last finished cycle ended short. */
  missed: number;
  /** Open stores whose cycle ends today or tomorrow. */
  endingSoon: number;
}

export function reportTotals(stores: ReportStore[]): ReportTotals {
  const totals: ReportTotals = { withPolicy: 0, open: 0, met: 0, unset: 0, missed: 0, endingSoon: 0 };
  for (const store of stores) {
    const state = reportState(store);
    if (state === 'unset') { totals.unset++; continue; }
    totals.withPolicy++;
    if (state === 'met') totals.met++;
    else {
      totals.open++;
      if (store.cycle && store.cycle.daysLeft <= 1) totals.endingSoon++;
    }
    if (missedLastCycle(store)) totals.missed++;
  }
  return totals;
}

export interface RawReportVisit {
  id: string;
  storeId: number;
  at: Date | string;
  byId?: string;
  by: string | null;
}

/** Build one store's report row from its policy and every visit it has had. */
export function buildReportStore(
  base: Pick<ReportStore, 'id' | 'storeNo' | 'name' | 'areaId' | 'areaName' | 'opsNames' | 'policy'>,
  visits: RawReportVisit[],
  today: string,
  trackedFrom: string | null,
): ReportStore {
  const sorted = visits
    .map((v) => ({ id: v.id, at: new Date(v.at).toISOString(), byId: v.byId, by: v.by }))
    .filter((v) => jakartaDateKey(v.at) <= today)
    .sort((a, b) => b.at.localeCompare(a.at));
  const lastVisit = sorted[0] ?? null;

  if (!base.policy) {
    return { ...base, cycle: null, history: [], visits: [], lastVisit };
  }

  const view = visitCycleView(base.policy, sorted.map((v) => v.at), today, trackedFrom);
  const toReportCycle = (c: CycleSummary): ReportCycle => ({ start: c.start, end: c.end, count: c.count, met: c.met });
  return {
    ...base,
    cycle: {
      start: view.current.start,
      end: view.current.end,
      daysLeft: view.current.daysLeft,
      count: view.current.count,
      remaining: view.current.remaining,
      met: view.current.met,
    },
    history: view.past.map(toReportCycle),
    visits: sorted.filter((v) => {
      const day = jakartaDateKey(v.at);
      return day >= view.current.start && day <= view.current.end;
    }),
    lastVisit,
  };
}

export interface WeekCoverage {
  /** Stores on a 7-day duty in scope, each with the distinct days visited that week. */
  stores: { store: ReportStore; days: string[]; met: boolean }[];
  visited: number;
  total: number;
  /** The week hasn't started yet. */
  future: boolean;
  /** The week ended before visits were tracked — nothing to judge. */
  untracked: boolean;
}

/**
 * How a Monday–Sunday week went for the stores whose duty is weekly (their
 * cycles ARE these weeks — see cycles.ts). 60/90-day stores span many weeks and
 * are judged on their own cycle instead (the store list).
 */
export function weekCoverage(
  week: string[],
  stores: ReportStore[],
  visits: CalendarVisit[],
  today: string,
  trackedFrom: string | null,
): WeekCoverage {
  const [start, end] = [week[0], week[6]];
  const daysByStore = new Map<number, Set<string>>();
  for (const v of visits) {
    if (v.day < start || v.day > end || v.day > today) continue;
    const set = daysByStore.get(v.storeId) ?? new Set<string>();
    set.add(v.day);
    daysByStore.set(v.storeId, set);
  }
  const rows = stores
    .filter((s) => s.policy?.intervalDays === 7)
    .map((store) => {
      const days = [...(daysByStore.get(store.id) ?? [])].sort();
      return { store, days, met: days.length >= (store.policy?.minimumVisits ?? 1) };
    });
  return {
    stores: rows,
    visited: rows.filter((r) => r.met).length,
    total: rows.length,
    future: start > today,
    untracked: !!trackedFrom && end < trackedFrom,
  };
}

import { jakartaDateKey } from '@/lib/day-bucket';
import { visitCycleView, type CycleSummary } from './cycles';
import type { VisitPolicy } from './types';

// Pure view logic for the Ops "Report Visit" (/ops/store-visits/report) and "Upcoming
// Visit" (/ops/store-visits/upcoming) pages. The server hands over raw visits;
// everything about cycles + ordering lives here so it can be tested without a database.

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

/** One visit, for the calendar and the list. */
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
  /** 'area' = one Ops Area's own report; 'all' = Ops HO / IT watching every area. */
  scope: 'area' | 'all';
  today: string;
  trackedFrom: string | null;
  /** "YYYY-MM" the calendar shows. */
  month: string;
  /** Every visit to a store in scope whose day falls in the weeks the month's calendar shows. */
  calendarVisits: CalendarVisit[];
  areas: { id: number; name: string }[];
  stores: ReportStore[];
}

/** GET /api/ops/store-visits/upcoming — the stores in scope with their current cycle. */
export interface VisitUpcoming {
  scope: 'area' | 'all';
  today: string;
  areas: { id: number; name: string }[];
  stores: ReportStore[];
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

/** A cycle that ended without enough visits, placed on the day it ended. */
export interface MissedCycle {
  storeId: number;
  start: string;
  /** The day the period ended — where the calendar shows it. */
  day: string;
  count: number;
  needed: number;
}

/** Every finished-and-short cycle of `stores` that ended between `from` and `to` (Jakarta days), oldest first. */
export function missedCycles(stores: ReportStore[], from: string, to: string, today: string): MissedCycle[] {
  const out: MissedCycle[] = [];
  for (const store of stores) {
    const needed = store.policy?.minimumVisits;
    if (!needed) continue;
    for (const c of store.history) {
      if (c.met || c.end < from || c.end > to || c.end >= today) continue;
      out.push({ storeId: store.id, start: c.start, day: c.end, count: c.count, needed });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.storeId - b.storeId);
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

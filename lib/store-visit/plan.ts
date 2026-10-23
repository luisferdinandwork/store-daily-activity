import { addDaysKey } from '@/lib/day-bucket';
import { cycleContaining, daysBetween, type VisitCycle } from './cycles';
import { missedLastCycle, missedStreak, weekCoverage, type CalendarVisit, type ReportOps, type ReportStore } from './report';

// The visit PLANNER behind the Ops "Report Visit" calendar: which store should be
// visited on which day. Nothing is stored — it is derived from each store's cycle
// (cycles.ts) and what has already been visited, so it always follows the data.
//
//   • A store owes `minimumVisits` distinct days per cycle. The planner takes every
//     cycle that overlaps [today, today + PLAN_HORIZON_DAYS] and spreads the visits
//     still owed over the days left in that cycle, lightest day first, so a week
//     never piles onto one day. Stores in the same city prefer the same day.
//   • 60/90-day stores have a long window; they are only scheduled in the last
//     LONG_CYCLE_LEAD_DAYS before their deadline (earlier if they already missed
//     the previous cycle), so the calendar shows what is coming, not the whole year.
//   • Sundays are left free (Ops visits Monday–Saturday) unless a cycle ends on one
//     and nothing else is left.
//
// Colours are decided here once (PlanTone) — the page only maps tone → classes.

export type PlanTone = 'done' | 'planned' | 'soon' | 'overdue' | 'idle';

export const PLAN_HORIZON_DAYS = 56;
export const LONG_CYCLE_LEAD_DAYS = 28;
/** A cycle ending within this many days (today counts as 0) is "segera berakhir" — for a weekly store: Thursday on. */
export const SOON_DAYS = 3;

export interface PlanItem {
  key: string;
  storeId: number;
  /** Suggested visit day (Jakarta "YYYY-MM-DD"). */
  day: string;
  /** Which of the cycle's visits this is (1-based) and how many the cycle needs. */
  visitNo: number;
  of: number;
  /** Last day of the cycle this visit belongs to. */
  deadline: string;
  tone: Exclude<PlanTone, 'done' | 'idle'>;
}

const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const isSunday = (day: string) => dow(day) === 0;
const maxDay = (...days: string[]) => days.reduce((a, b) => (a > b ? a : b));
const minDay = (...days: string[]) => days.reduce((a, b) => (a < b ? a : b));

export function planHorizonEnd(today: string): string {
  return addDaysKey(today, PLAN_HORIZON_DAYS);
}

/** Where a store stands right now, from most to least urgent. */
export type Urgency = 'overdue' | 'soon' | 'open' | 'met' | 'unset';

export function storeUrgency(store: ReportStore): Urgency {
  if (!store.cycle) return 'unset';
  if (store.cycle.met) return 'met';
  if (missedLastCycle(store)) return 'overdue';
  return store.cycle.daysLeft <= SOON_DAYS ? 'soon' : 'open';
}

const URGENCY_TONE: Record<Urgency, PlanTone> = { overdue: 'overdue', soon: 'soon', open: 'planned', met: 'done', unset: 'idle' };
export const urgencyTone = (u: Urgency): PlanTone => URGENCY_TONE[u];

interface Job {
  store: ReportStore;
  cycle: VisitCycle;
  owed: number;
  from: string;
  to: string;
  tone: PlanItem['tone'];
  streak: number;
}

/** Spread every visit still owed over the days it can happen on, from `today` to `horizonEnd`. */
export function buildPlan(stores: ReportStore[], today: string, horizonEnd = planHorizonEnd(today)): PlanItem[] {
  const jobs: Job[] = [];
  for (const store of stores) {
    const policy = store.policy;
    if (!policy || !store.cycle) continue;
    const interval = policy.intervalDays;
    const overdue = !!missedLastCycle(store);
    let cycle = cycleContaining(today, interval);
    for (let guard = 0; guard < 16 && cycle.start <= horizonEnd; guard++) {
      const current = cycle.start <= today;
      const owed = current ? store.cycle.remaining : policy.minimumVisits;
      if (owed > 0) {
        const lead = interval > 7 ? LONG_CYCLE_LEAD_DAYS : interval;
        const leadStart = current && overdue ? today : addDaysKey(cycle.end, 1 - lead);
        const from = maxDay(today, cycle.start, leadStart);
        const to = minDay(cycle.end, horizonEnd);
        if (from <= to) {
          const tone: PlanItem['tone'] = !current ? 'planned' : overdue ? 'overdue' : store.cycle.daysLeft <= SOON_DAYS ? 'soon' : 'planned';
          jobs.push({ store, cycle, owed, from, to, tone, streak: current ? missedStreak(store) : 0 });
        }
      }
      cycle = cycleContaining(addDaysKey(cycle.end, 1), interval);
    }
  }

  const windowDays = (job: Job) => {
    const all: string[] = [];
    for (let d = job.from; d <= job.to; d = addDaysKey(d, 1)) all.push(d);
    const work = all.filter((d) => !isSunday(d));
    return work.length ? work : all;
  };

  // Tightest windows first: they have the fewest places to go.
  const sorted = jobs
    .map((job) => ({ job, days: windowDays(job) }))
    .sort((a, b) =>
      (a.job.tone === 'overdue' ? 0 : 1) - (b.job.tone === 'overdue' ? 0 : 1)
      || b.job.streak - a.job.streak
      || a.days.length - b.days.length
      || a.job.to.localeCompare(b.job.to)
      || a.job.store.name.localeCompare(b.job.store.name));

  const load = new Map<string, number>();
  const cities = new Map<string, Set<string>>();
  const items: PlanItem[] = [];
  for (const { job, days } of sorted) {
    const city = (job.store.policy?.city ?? '').trim().toLowerCase();
    const used = new Set<string>();
    for (let n = 1; n <= Math.min(job.owed, days.length); n++) {
      let best: string | null = null;
      let bestCost = Infinity;
      days.forEach((day, i) => {
        if (used.has(day)) return;
        const cost = (load.get(day) ?? 0) + (city && cities.get(day)?.has(city) ? -0.75 : 0) + i * 0.02;
        if (cost < bestCost) { best = day; bestCost = cost; }
      });
      if (!best) break;
      used.add(best);
      load.set(best, (load.get(best) ?? 0) + 1);
      if (city) cities.set(best, (cities.get(best) ?? new Set<string>()).add(city));
      items.push({ key: `${job.store.id}:${job.cycle.start}:${n}`, storeId: job.store.id, day: best, visitNo: n, of: job.store.policy?.minimumVisits ?? 1, deadline: job.cycle.end, tone: job.tone });
    }
  }
  return items.sort((a, b) => a.day.localeCompare(b.day) || toneRank(a.tone) - toneRank(b.tone) || a.storeId - b.storeId);
}

/**
 * One plan per area: an area's Ops spreads their own stores, so a busy day in one area
 * must not push another area's visits around. Merged and ordered like buildPlan().
 */
export function buildPlanByArea(stores: ReportStore[], today: string, horizonEnd = planHorizonEnd(today)): PlanItem[] {
  const byArea = new Map<number, ReportStore[]>();
  for (const s of stores) byArea.set(s.areaId, [...(byArea.get(s.areaId) ?? []), s]);
  return [...byArea.values()]
    .flatMap((list) => buildPlan(list, today, horizonEnd))
    .sort((a, b) => a.day.localeCompare(b.day) || toneRank(a.tone) - toneRank(b.tone) || a.storeId - b.storeId);
}

const TONE_RANK: Record<PlanTone, number> = { overdue: 0, soon: 1, planned: 2, idle: 3, done: 4 };
export const toneRank = (tone: PlanTone) => TONE_RANK[tone];

/** The next stores to visit: everything on the earliest planned day(s), at least `min` items. */
export function nextUp(plan: PlanItem[], today: string, min = 3): PlanItem[] {
  const upcoming = plan.filter((p) => p.day >= today);
  const out: PlanItem[] = [];
  let lastDay = '';
  for (const item of upcoming) {
    if (out.length >= min && item.day !== lastDay) break;
    out.push(item);
    lastDay = item.day;
  }
  return out;
}

export interface WeekPlanSummary {
  /** Weekly-duty stores met / total (weekCoverage) — a weekly store's cycle IS this week. */
  visited: number;
  total: number;
  /** Plan items falling in the week. */
  planned: number;
  /** Visits actually made in the week (any store). */
  visits: number;
  /** Stores whose cycle ends in the week without the visit yet (long cycles included). */
  deadlines: number;
  future: boolean;
  past: boolean;
  untracked: boolean;
}

export function weekPlanSummary(
  week: string[],
  stores: ReportStore[],
  visits: CalendarVisit[],
  plan: PlanItem[],
  today: string,
  trackedFrom: string | null,
): WeekPlanSummary {
  const cov = weekCoverage(week, stores, visits, today, trackedFrom);
  const [start, end] = [week[0], week[6]];
  return {
    visited: cov.visited,
    total: cov.total,
    planned: plan.filter((p) => p.day >= start && p.day <= end).length,
    visits: visits.filter((v) => v.day >= start && v.day <= end && v.day <= today).length,
    deadlines: stores.filter((s) => s.cycle && !s.cycle.met && s.cycle.end >= start && s.cycle.end <= end && s.cycle.end >= today).length,
    future: cov.future,
    past: end < today,
    untracked: cov.untracked,
  };
}

export interface AreaRollup {
  areaId: number;
  areaName: string;
  opsNames: string[];
  /** Stores with a visit rule. */
  total: number;
  met: number;
  overdue: number;
  soon: number;
  open: number;
  unset: number;
  /** Visits planned in the next 7 days. */
  next7: number;
  /** Visits made by the area's Ops in the activity window. */
  visits: number;
  lastVisitAt: string | null;
  /** Worst thing about the area, for ordering and colour. */
  tone: PlanTone;
}

export function areaRollups(stores: ReportStore[], ops: ReportOps[], plan: PlanItem[], today: string): AreaRollup[] {
  const weekEnd = addDaysKey(today, 6);
  const byId = new Map(stores.map((s) => [s.id, s]));
  const map = new Map<number, AreaRollup>();
  for (const s of stores) {
    const row = map.get(s.areaId) ?? { areaId: s.areaId, areaName: s.areaName, opsNames: s.opsNames, total: 0, met: 0, overdue: 0, soon: 0, open: 0, unset: 0, next7: 0, visits: 0, lastVisitAt: null, tone: 'done' as PlanTone };
    const u = storeUrgency(s);
    if (u === 'unset') row.unset++;
    else {
      row.total++;
      if (u === 'met') row.met++;
      else if (u === 'overdue') row.overdue++;
      else if (u === 'soon') row.soon++;
      else row.open++;
    }
    if (s.lastVisit && (!row.lastVisitAt || s.lastVisit.at > row.lastVisitAt)) row.lastVisitAt = s.lastVisit.at;
    map.set(s.areaId, row);
  }
  for (const p of plan) {
    const s = byId.get(p.storeId);
    if (s && p.day <= weekEnd) map.get(s.areaId)!.next7++;
  }
  for (const o of ops) {
    const row = [...map.values()].find((r) => (o.areaId != null ? r.areaId === o.areaId : r.areaName === o.areaName));
    if (row) row.visits += o.visits;
  }
  for (const row of map.values()) {
    row.tone = row.overdue ? 'overdue' : row.soon ? 'soon' : row.open ? 'planned' : row.total ? 'done' : 'idle';
  }
  return [...map.values()].sort((a, b) =>
    toneRank(a.tone) - toneRank(b.tone) || b.overdue - a.overdue || b.soon - a.soon || b.open - a.open || a.areaName.localeCompare(b.areaName));
}

/** "Hari ini" / "Besok" / "Sen, 26 Okt" for a Jakarta day. */
export function relativeDay(day: string, today: string): string {
  const diff = daysBetween(today, day);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Besok';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Why a store sits where it does: "Terlewat 2 periode", "Batas Min, 25 Okt", … */
export function planReason(store: ReportStore, item?: Pick<PlanItem, 'deadline' | 'tone'>): string {
  const u = storeUrgency(store);
  const deadline = item?.deadline ?? store.cycle?.end;
  const dl = deadline ? new Date(`${deadline}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
  if (u === 'overdue') {
    const streak = missedStreak(store);
    const unit = store.policy?.intervalDays === 7 ? 'minggu' : 'periode';
    return `Terlewat ${streak > 1 ? `${streak} ${unit} berturut-turut` : `${unit} lalu`}`;
  }
  if (u === 'soon') return store.cycle?.daysLeft === 0 ? 'Batas hari ini' : `Batas ${dl}`;
  if (u === 'met') return 'Sudah terpenuhi';
  if (u === 'unset') return 'Belum diatur IT';
  return `Batas ${dl}`;
}

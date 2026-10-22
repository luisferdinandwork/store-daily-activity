import { addDaysKey, jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import type { VisitPolicy } from './types';

// A store's visit duty runs in back-to-back cycles of `intervalDays` (WIB days):
// 7 days = one Monday–Sunday week, and a visit on any day of a cycle counts for
// that cycle only. The next cycle starts the day after the last one ends — a
// visit never moves the boundaries. Every store counts from the same Monday, so
// all 7-day stores share the same weeks; 60/90-day stores use 60/90-day blocks
// counted from that Monday. (Change the constant to re-anchor every cycle.)
export const VISIT_CYCLE_ANCHOR = '2026-01-05';

/** How many finished cycles the report remembers per store, by cycle length. */
export function historyLength(intervalDays: number): number {
  return intervalDays <= 7 ? 8 : 4;
}

export interface VisitCycle {
  /** First day of the cycle (Jakarta "YYYY-MM-DD"). */
  start: string;
  /** Last day of the cycle, inclusive. */
  end: string;
}

const dayNumber = (key: string) => Math.floor(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The cycle that holds Jakarta day `dayKey`. */
export function cycleContaining(dayKey: string, intervalDays: number): VisitCycle {
  const index = Math.floor(daysBetween(VISIT_CYCLE_ANCHOR, dayKey) / intervalDays);
  const start = addDaysKey(VISIT_CYCLE_ANCHOR, index * intervalDays);
  return { start, end: addDaysKey(start, intervalDays - 1) };
}

/** The cycle right before `cycle`. */
export function previousCycle(cycle: VisitCycle, intervalDays: number): VisitCycle {
  return cycleContaining(addDaysKey(cycle.start, -1), intervalDays);
}

/** Distinct Jakarta visit days up to and including `today`, newest first. */
export function distinctVisitDays(visitDates: (Date | string)[], today = jakartaTodayKey()): string[] {
  return [...new Set(visitDates.map(jakartaDateKey).filter((d) => d && d <= today))].sort().reverse();
}

export interface CycleSummary extends VisitCycle {
  /** Distinct visit days inside the cycle, oldest first. */
  visitDays: string[];
  count: number;
  met: boolean;
}

export function summariseCycle(cycle: VisitCycle, visitDays: string[], minimumVisits: number): CycleSummary {
  const inside = visitDays.filter((d) => d >= cycle.start && d <= cycle.end).sort();
  return { ...cycle, visitDays: inside, count: inside.length, met: inside.length >= minimumVisits };
}

export interface VisitCycleView {
  current: CycleSummary & {
    /** Days left after today before the cycle ends (0 = today is the last day). */
    daysLeft: number;
    remaining: number;
  };
  /** Finished cycles, oldest first. Cycles that began before `trackedFrom` are left out unless they were met. */
  past: CycleSummary[];
  lastVisit: string | null;
}

/**
 * Where a store stands in its current cycle, plus how its finished cycles went.
 * `trackedFrom` is the first day visits were tracked (Jakarta day): a cycle that
 * began before it can't be judged, so it only shows when it was met.
 */
export function visitCycleView(
  policy: Pick<VisitPolicy, 'intervalDays' | 'minimumVisits'>,
  visitDates: (Date | string)[],
  today = jakartaTodayKey(),
  trackedFrom: string | null = null,
): VisitCycleView {
  const days = distinctVisitDays(visitDates, today);
  const { intervalDays, minimumVisits } = policy;

  const cycle = cycleContaining(today, intervalDays);
  const current = summariseCycle(cycle, days, minimumVisits);

  const past: CycleSummary[] = [];
  let cursor = cycle;
  for (let i = 0; i < historyLength(intervalDays); i++) {
    cursor = previousCycle(cursor, intervalDays);
    const summary = summariseCycle(cursor, days, minimumVisits);
    if (trackedFrom && cursor.start < trackedFrom && !summary.met) break;
    past.unshift(summary);
  }

  return {
    current: {
      ...current,
      daysLeft: daysBetween(today, cycle.end),
      remaining: Math.max(0, minimumVisits - current.count),
    },
    past,
    lastVisit: days[0] ?? null,
  };
}

/** "Minggu ini" for a 7-day cycle, "Periode 60 hari" otherwise. */
export function cycleName(intervalDays: number): string {
  return intervalDays === 7 ? 'Minggu ini' : `Periode ${intervalDays} hari`;
}

/** "19–25 Okt" / "28 Sep – 4 Okt" for a cycle. */
export function cycleRangeLabel(cycle: VisitCycle): string {
  const fmt = (key: string, withMonth: boolean) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC' });
  const sameMonth = cycle.start.slice(0, 7) === cycle.end.slice(0, 7);
  return sameMonth
    ? `${fmt(cycle.start, false)}–${fmt(cycle.end, true)}`
    : `${fmt(cycle.start, true)} – ${fmt(cycle.end, true)}`;
}

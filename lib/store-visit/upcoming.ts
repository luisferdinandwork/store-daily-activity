import { missedLastCycle, type ReportStore } from './report';

// View logic for the Ops "Upcoming Visit" page (/ops/store-visits/upcoming): the stores
// that still owe a visit in their current cycle, nearest deadline first. Nothing is
// stored or scheduled — "days left" is simply the days until the cycle ends.
//
// The one colour code of the visit pages (components/ops/store-visits/tones.ts) is keyed
// by VisitTone, decided here.

export type VisitTone = 'done' | 'planned' | 'soon' | 'overdue' | 'idle';

/** A cycle ending within this many days (today counts as 0) is "segera" — for a weekly store: Thursday on. */
export const SOON_DAYS = 3;

/** The closer the deadline, the hotter: today / tomorrow rose, up to SOON_DAYS amber, the rest indigo. */
export function dueTone(daysLeft: number): VisitTone {
  if (daysLeft <= 1) return 'overdue';
  if (daysLeft <= SOON_DAYS) return 'soon';
  return 'planned';
}

export interface UpcomingRow {
  store: ReportStore;
  /** Days after today before the cycle ends (0 = today is the last day). */
  daysLeft: number;
  /** Last day of the cycle. */
  deadline: string;
  /** Visits still owed this cycle. */
  remaining: number;
  tone: VisitTone;
  /** The previous cycle ended short too. */
  missedBefore: boolean;
}

/** Stores that still owe a visit this cycle — nearest deadline first. */
export function upcomingRows(stores: ReportStore[]): UpcomingRow[] {
  const rows: UpcomingRow[] = [];
  for (const store of stores) {
    const cycle = store.cycle;
    if (!store.policy || !cycle || cycle.met) continue;
    rows.push({
      store,
      daysLeft: cycle.daysLeft,
      deadline: cycle.end,
      remaining: cycle.remaining,
      tone: dueTone(cycle.daysLeft),
      missedBefore: !!missedLastCycle(store),
    });
  }
  return rows.sort((a, b) =>
    a.daysLeft - b.daysLeft
    || Number(b.missedBefore) - Number(a.missedBefore)
    || a.store.name.localeCompare(b.store.name));
}

/** "Hari ini" / "Besok" / "5 hari" — what the badge says. */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Hari ini';
  if (daysLeft === 1) return 'Besok';
  return `${daysLeft} hari`;
}

/** The deadline as "Min, 25 Okt". */
export function deadlineLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export interface UpcomingSummary {
  total: number;
  /** Per tone: how many rows. */
  byTone: Record<'overdue' | 'soon' | 'planned', number>;
}

export function upcomingSummary(rows: UpcomingRow[]): UpcomingSummary {
  const byTone = { overdue: 0, soon: 0, planned: 0 };
  for (const r of rows) byTone[r.tone as keyof typeof byTone]++;
  return { total: rows.length, byTone };
}

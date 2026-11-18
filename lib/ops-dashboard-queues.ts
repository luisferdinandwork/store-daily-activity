// lib/ops-dashboard-queues.ts
//
// Shape of GET /api/ops/dashboard/queues — what is waiting on Ops, longest first — plus
// the "how long" wording and colour the lists share. Client-safe.
//
//   petty cash   requests + refills still waiting for Ops to approve
//   issues       reported, not yet reviewed
//   transfers    Item Return · Item Receiving · Item Delivery: this month's STORES whose own
//                average time is above the month's average (the TO Report's numbers —
//                lib/transfer-order-report.ts — completed processes only), slowest first
//   visits       Ops HO / IT only: stores that still owe a visit before this week ends

import type { Tone } from '@/lib/status-theme';
import type { VisitTone } from '@/lib/store-visit/upcoming';

/** A store as the lists name it, with its area and the Ops Area user(s) who look after it. */
export interface QueueStore {
  id: number;
  /** BC / POS store code, e.g. FF001. */
  storeNo: string;
  name: string;
  areaName: string;
  opsNames: string[];
}

/** `items` are the longest-waiting few; `total` is how many there are in all. */
export interface QueueList<T> {
  total: number;
  items: T[];
}

export interface PettyCashWaitingRow {
  /** `request-12` / `refill-5` — unique across both kinds. */
  key: string;
  kind: 'request' | 'refill';
  store: QueueStore;
  /** Rupiah — what was asked (a request) or what the store needs refilled (a refill). */
  amount: number;
  /** The Keterangan (a request) or the period it settles (a refill). */
  note: string;
  /** ISO — when the PIC sent it. */
  since: string;
  /** A refill sent after its deadline. */
  late: boolean;
}

export interface IssueWaitingRow {
  id: string;
  title: string;
  store: QueueStore;
  reporterName: string;
  since: string;
}

/** A store slower than the month's average for one Transfer Order process. */
export interface TransferAverageRow {
  store: QueueStore;
  /** This store's mean minutes over its COMPLETED processes of the month. */
  avgMinutes: number;
  /** How many completed processes that mean is made of. */
  timed: number;
}

/** One process (Item Return / Item Receiving / Item Delivery) of the month. */
export interface TransferAverageList extends QueueList<TransferAverageRow> {
  /** Mean of every completed process of the month in scope (null = none finished yet). */
  monthAvgMinutes: number | null;
  /** How many completed processes the month mean is made of. */
  timed: number;
}

export interface VisitWaitingRow {
  store: QueueStore;
  /** Days after today before the visit cycle ends (0 = today is the last day). */
  daysLeft: number;
  /** Last day of the cycle (Jakarta YYYY-MM-DD). */
  deadline: string;
  /** Visits still owed this cycle. */
  remaining: number;
  /** Cycle length in days (7 = this week's Monday–Sunday). */
  intervalDays: number;
  tone: VisitTone;
}

export interface DashboardQueues {
  success: true;
  scope: 'all_areas' | 'area';
  pettyCash: QueueList<PettyCashWaitingRow> & { requests: number; refills: number };
  issues: QueueList<IssueWaitingRow>;
  transfers: {
    /** YYYY-MM — the Jakarta month the averages cover. */
    month: string;
    return: TransferAverageList;
    receiving: TransferAverageList;
    delivery: TransferAverageList;
  };
  /** Ops HO / IT only (null for Ops Area). */
  visits: (QueueList<VisitWaitingRow> & { weekStart: string; weekEnd: string }) | null;
}

/** How many rows each list sends / shows. */
export const QUEUE_LIMIT = 5;
/** The visit list is longer — it is the HO's whole to-do for the week. */
export const VISIT_QUEUE_LIMIT = 20;

// ─── Transfer Order averages ─────────────────────────────────────────────────

/**
 * The stores whose own average is ABOVE the pooled average of the month (every
 * completed process of every store, `minutes` ÷ `timed` — the TO Report's KPI),
 * slowest first. A store with nothing finished has no average and is never listed.
 */
export function storesAboveAverage<T extends { minutes: number; timed: number }>(
  reports: T[],
): { monthAvgMinutes: number | null; timed: number; above: { report: T; avgMinutes: number }[] } {
  let sum = 0;
  let timed = 0;
  for (const r of reports) {
    sum += r.minutes;
    timed += r.timed;
  }
  if (timed === 0) return { monthAvgMinutes: null, timed: 0, above: [] };
  const monthAvg = sum / timed;
  const above = reports
    .filter((r) => r.timed > 0 && r.minutes / r.timed > monthAvg)
    .map((report) => ({ report, avgMinutes: Math.round(report.minutes / report.timed) }))
    .sort((a, b) => b.avgMinutes - a.avgMinutes);
  return { monthAvgMinutes: Math.round(monthAvg), timed, above };
}

// ─── Waiting time ────────────────────────────────────────────────────────────

/** Whole minutes from `since` to now; null without a start. Never negative. */
export function waitingMinutes(since: string | null | undefined, now = Date.now()): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

/** "baru saja" · "45 mnt" · "5 jam" · "3 hari" — one unit is enough to tell what has waited longest. */
export function waitingLabel(minutes: number | null): string {
  if (minutes == null) return '—';
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} jam`;
  return `${Math.floor(minutes / 1440)} hari`;
}

/** Calm under a day, warning from a day, danger from three. */
export function waitingTone(minutes: number | null): Tone {
  if (minutes == null) return 'muted';
  if (minutes >= 3 * 1440) return 'danger';
  if (minutes >= 1440) return 'warning';
  return 'neutral';
}

// ─── This week ───────────────────────────────────────────────────────────────

const dayNumber = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000;
const keyOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** The Monday–Sunday week (Jakarta days) that holds `today` — the same weeks the 7-day visit cycles use. */
export function weekOf(today: string): { start: string; end: string } {
  const n = dayNumber(today);
  const sinceMonday = (new Date(n * 86_400_000).getUTCDay() + 6) % 7;
  return { start: keyOf(n - sinceMonday), end: keyOf(n - sinceMonday + 6) };
}

/** "16 – 22 Nov" / "30 Nov – 6 Des". */
export function weekRangeLabel(week: { start: string; end: string }): string {
  const fmt = (key: string, withMonth: boolean) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString('id-ID', {
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
      timeZone: 'UTC',
    });
  const sameMonth = week.start.slice(0, 7) === week.end.slice(0, 7);
  return sameMonth ? `${fmt(week.start, false)} – ${fmt(week.end, true)}` : `${fmt(week.start, true)} – ${fmt(week.end, true)}`;
}

/** Does a visit cycle that ends on `deadline` close on or before the end of this week? */
export function dueThisWeek(deadline: string, weekEnd: string): boolean {
  return deadline <= weekEnd;
}

/** "Rp 250.000". */
export function rupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

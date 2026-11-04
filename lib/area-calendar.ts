// lib/area-calendar.ts
//
// The Area Management calendar (/ops/areas, OPS HO + IT): a month where every
// day shows each AREA's attendance % or task-completion %, in the same colours
// as the Attendance calendar (health bands) and the Task Progress grids (heat
// steps). Pure + client-safe; the data comes from lib/db/utils/area-calendar.ts.
//
// The API sends figures per STORE per day; areas are rolled up here, so moving
// a store between areas never needs a different payload shape.

import {
  EMPTY_COUNTS,
  addCounts,
  attendanceRate,
  type AttendanceCounts,
} from '@/lib/attendance-health';

export type CalendarMetric = 'attendance' | 'task';

export interface CalendarStore {
  id: number;
  name: string;
  storeNo: string;
  areaId: number;
}

/** One store's numbers for one day. */
export interface StoreDayFigures {
  /** Scheduled people by attendance status (lib/attendance-health.ts rules). */
  att: AttendanceCounts;
  /** Task slots completed / scheduled (same counting as Ops Task Progress). */
  done: number;
  total: number;
}

/** GET /api/ops/areas/calendar?month=YYYY-MM — `days` keyed by Jakarta "YYYY-MM-DD", then store id. */
export interface AreaCalendarData {
  month: string;
  /** Today's Jakarta key — days after it carry no figures. */
  today: string;
  /** Every active store, with the area it belongs to right now. */
  stores: CalendarStore[];
  days: Record<string, Record<string, StoreDayFigures>>;
}

/** Figures of one area (or one store) over one day, or a whole month pooled. */
export interface Figures {
  att: AttendanceCounts;
  done: number;
  total: number;
}

export const EMPTY_FIGURES: Figures = { att: EMPTY_COUNTS, done: 0, total: 0 };

export function addFigures(a: Figures, b: Figures): Figures {
  return { att: addCounts(a.att, b.att), done: a.done + b.done, total: a.total + b.total };
}

/** Is there anything to judge for this metric? (no schedule / no task slot → nothing drawn) */
export function hasFigures(f: Figures | null | undefined, metric: CalendarMetric): f is Figures {
  if (!f) return false;
  return metric === 'attendance' ? f.att.total > 0 : f.total > 0;
}

/** Whole %, or null when nothing is countable yet (attendance: everyone still pending). */
export function figuresRate(f: Figures, metric: CalendarMetric): number | null {
  if (metric === 'attendance') return attendanceRate(f.att);
  return f.total > 0 ? Math.round((f.done / f.total) * 100) : null;
}

/** Day → area → figures, rolled up from the per-store payload. */
export type AreaDayMap = Map<string, Map<number, Figures>>;

export function rollUpByArea(data: AreaCalendarData): AreaDayMap {
  const areaOfStore = new Map(data.stores.map((s) => [s.id, s.areaId]));
  const out: AreaDayMap = new Map();
  for (const [day, perStore] of Object.entries(data.days)) {
    const perArea = new Map<number, Figures>();
    for (const [storeIdRaw, f] of Object.entries(perStore)) {
      const areaId = areaOfStore.get(Number(storeIdRaw));
      if (areaId == null) continue;
      perArea.set(areaId, addFigures(perArea.get(areaId) ?? EMPTY_FIGURES, f));
    }
    out.set(day, perArea);
  }
  return out;
}

/** An area's (or store's) figures pooled over every day it has data — the month average. */
export function pooled(list: Iterable<Figures | undefined>): Figures {
  let sum = EMPTY_FIGURES;
  for (const f of list) if (f) sum = addFigures(sum, f);
  return sum;
}

// ─── Months ──────────────────────────────────────────────────────────────────

/** "2026-11" shifted by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Monday-first month grid: leading/trailing nulls pad to whole weeks. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

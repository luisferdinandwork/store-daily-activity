// lib/ops-trend.ts
//
// The Ops Dashboard trend chart: task completion % and attendance % per day over
// a chosen period (GET /api/ops/dashboard/trend, components/ops/dashboard/TrendChart).
// Pure + client-safe.

import { addDaysKey } from '@/lib/day-bucket';

export const TREND_PERIODS = [
  { key: '7d', label: '7 hari' },
  { key: '30d', label: '30 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: '90d', label: '90 hari' },
] as const;

export type TrendPeriod = (typeof TREND_PERIODS)[number]['key'];

export function isTrendPeriod(value: unknown): value is TrendPeriod {
  return TREND_PERIODS.some((p) => p.key === value);
}

/** First and last Jakarta day of a period ending today (inclusive). */
export function trendRange(period: TrendPeriod, today: string): { from: string; to: string } {
  switch (period) {
    case '7d': return { from: addDaysKey(today, -6), to: today };
    case '30d': return { from: addDaysKey(today, -29), to: today };
    case '90d': return { from: addDaysKey(today, -89), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

export interface TrendPoint {
  /** Jakarta day "YYYY-MM-DD" (the bucket's first day when grouped by week). */
  date: string;
  /** Last day of the bucket (= date for daily points). */
  end: string;
  tasks: { completed: number; total: number; rate: number | null };
  /** Present + late over present + late + absent — the Ops Attendance rule. */
  attendance: { showed: number; counted: number; rate: number | null };
}

export interface TrendResponse {
  success: boolean;
  error?: string;
  period: TrendPeriod;
  from: string;
  to: string;
  points: TrendPoint[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export function makePoint(date: string, end: string, tasks: { completed: number; total: number }, att: { showed: number; counted: number }): TrendPoint {
  return {
    date,
    end,
    tasks: { ...tasks, rate: pct(tasks.completed, tasks.total) },
    attendance: { ...att, rate: pct(att.showed, att.counted) },
  };
}

/**
 * Long periods read better weekly: 90 days of daily points is a saw blade.
 * Weeks run Monday–Sunday; each week's rate is pooled (sum ÷ sum), not averaged.
 */
export function bucketTrend(points: TrendPoint[], period: TrendPeriod): TrendPoint[] {
  if (period !== '90d') return points;
  const weeks = new Map<string, TrendPoint[]>();
  for (const p of points) {
    const d = new Date(`${p.date}T00:00:00Z`);
    const monday = addDaysKey(p.date, -((d.getUTCDay() + 6) % 7));
    weeks.set(monday, [...(weeks.get(monday) ?? []), p]);
  }
  return [...weeks.entries()].map(([monday, list]) => {
    const tasks = list.reduce((a, p) => ({ completed: a.completed + p.tasks.completed, total: a.total + p.tasks.total }), { completed: 0, total: 0 });
    const att = list.reduce((a, p) => ({ showed: a.showed + p.attendance.showed, counted: a.counted + p.attendance.counted }), { showed: 0, counted: 0 });
    return makePoint(monday, list[list.length - 1].end, tasks, att);
  });
}

/** Pooled rate over every point (sum ÷ sum) — the number beside each legend key. */
export function trendAverage(points: TrendPoint[], series: 'tasks' | 'attendance'): number | null {
  let part = 0;
  let whole = 0;
  for (const p of points) {
    if (series === 'tasks') { part += p.tasks.completed; whole += p.tasks.total; }
    else { part += p.attendance.showed; whole += p.attendance.counted; }
  }
  return pct(part, whole);
}

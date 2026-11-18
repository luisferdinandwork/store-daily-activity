// lib/ops-dashboard.ts
//
// Shape of GET /api/ops/dashboard — the two rates of today (attendance + task
// completion) with every store's figure — shared by the Ops Dashboard's desktop
// layout (app/ops/page.tsx) and its phone layout (components/ops/mobile/DashboardMobile.tsx),
// plus the rule that picks the stores worth a look. Client-safe.
//
// The "waiting on Ops" lists (petty cash, issues, transfer orders, visits) have their own
// feed: lib/ops-dashboard-queues.ts.

import { rateTone as sharedRateTone } from '@/lib/status-theme';

export type TaskBucket = {
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  total: number;
  completionRate: number;
};

export type StoreTaskRow = {
  storeId: number;
  /** BC / POS store code, e.g. FF001. */
  storeNo: string;
  storeName: string;
  completed: number;
  total: number;
  completionRate: number;
};

export type StoreAttendanceRow = {
  storeId: string;
  /** BC / POS store code, e.g. FF001. */
  storeNo: string;
  storeName: string;
  total: number;
  present: number;
  late: number;
  absent: number;
  dinas: number;
  excused: number;
  unset: number;
  /** Roster people with no shift (not even OFF / leave) today. */
  noSchedule: number;
  /** null = nobody has a shift today, so there is no rate to show. */
  rate: number | null;
};

export type DashboardData = {
  date: string;
  scope: 'all_areas' | 'area';
  storeCount: number;
  tasks: {
    today: TaskBucket;
    todayByStore: StoreTaskRow[];
  };
  attendance: {
    total: number;
    present: number;
    late: number;
    absent: number;
    dinas: number;
    excused: number;
    unset: number;
    noSchedule: number;
    rate: number;
    stores: StoreAttendanceRow[];
  };
};

/** The three bands of a completion / attendance rate (80 / 50 — lib/status-theme.ts `rateTone`). */
export type RateBand = 'success' | 'warning' | 'danger';

export function rateBand(rate: number): RateBand {
  return sharedRateTone(rate) as RateBand;
}

export const RATE_WORD: Record<RateBand, string> = {
  success: 'On track',
  warning: 'In progress',
  danger: 'Behind',
};

/** How many stores each "needs attention" list shows. */
export const ATTENTION_LIMIT = 5;

/**
 * Stores worth a look today, worst first: tasks below 100%, and attendance below 100% or
 * with people the schedule doesn't cover (or no shifts at all). `*Total` is how many there
 * are before the list is cut to `limit`.
 */
export function storesBehind(data: DashboardData | null, limit = ATTENTION_LIMIT) {
  const tasks = (data?.tasks.todayByStore ?? [])
    .filter((s) => s.completionRate < 100)
    .sort(
      (a, b) =>
        a.completionRate - b.completionRate ||
        b.total - b.completed - (a.total - a.completed) ||
        a.storeNo.localeCompare(b.storeNo),
    );
  const attendance = (data?.attendance.stores ?? [])
    .filter((s) => s.rate === null || s.rate < 100 || s.noSchedule > 0)
    .sort(
      (a, b) =>
        (a.rate ?? 101) - (b.rate ?? 101) || b.noSchedule - a.noSchedule || a.storeNo.localeCompare(b.storeNo),
    );
  return {
    tasks: tasks.slice(0, limit),
    tasksTotal: tasks.length,
    attendance: attendance.slice(0, limit),
    attendanceTotal: attendance.length,
  };
}

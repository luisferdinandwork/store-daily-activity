// lib/ops-dashboard.ts
//
// Shape of GET /api/ops/dashboard, shared by the Ops Dashboard's desktop layout
// (app/ops/page.tsx) and its phone layout (components/ops/mobile/DashboardMobile.tsx),
// plus the one colour rule both use. Client-safe.

export type TaskBucket = {
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  total: number;
  completionRate: number;
};

export type ShiftBucket = {
  shift: string;
  /** shifts.label, e.g. "Morning" ("Other" for tasks without a shift). */
  label: string;
  completed: number;
  total: number;
  completionRate: number;
};

export type StoreTaskRow = {
  storeId: number;
  storeName: string;
  completed: number;
  total: number;
  completionRate: number;
};

export type StoreAttendanceRow = {
  storeId: string;
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

export type PettyCashRow = {
  id: number;
  amount: string;
  description: string;
  status: 'pending_ops' | 'ops_approved' | 'ops_rejected' | string;
  storeName: string;
  submittedByName: string;
  createdAt: string;
};

export type IssueRow = {
  id: string;
  title: string;
  storeName: string;
  reporterName: string;
  createdAt: string;
};

export type DashboardData = {
  date: string;
  scope: 'all_areas' | 'area';
  storeCount: number;
  tasks: {
    today: TaskBucket;
    todayByStore: StoreTaskRow[];
    shiftToday: ShiftBucket[];
    month: { completed: number; total: number; completionRate: number };
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
  pettyCash: {
    pendingCount: number;
    recent: PettyCashRow[];
  };
  issues: {
    unreviewedCount: number;
    recent: IssueRow[];
  };
};

/** Same bands (80 / 50) as the Stores page's task-progress legend. */
export function rateTone(rate: number): 'emerald' | 'amber' | 'rose' {
  if (rate >= 80) return 'emerald';
  if (rate >= 50) return 'amber';
  return 'rose';
}

export const RATE_WORD: Record<'emerald' | 'amber' | 'rose', string> = {
  emerald: 'On track',
  amber: 'In progress',
  rose: 'Behind',
};

/**
 * Stores worth a look today: tasks below 100%, and attendance below 100%, with
 * people the schedule doesn't cover, or with no shifts at all.
 */
export function storesBehind(data: DashboardData | null) {
  return {
    tasks: (data?.tasks.todayByStore ?? []).filter((s) => s.completionRate < 100),
    attendance: (data?.attendance.stores ?? []).filter(
      (s) => s.rate === null || s.rate < 100 || s.noSchedule > 0,
    ),
  };
}

// lib/attendance-health.ts
//
// How Ops reads "is attendance fine?" — one rule shared by the Attendance
// calendar, its day panel and the store detail, so the colour, the % and the
// label never disagree (client-safe — no DB imports).
//
// The rate only counts people whose day is decided:
//
//   rate = (present + late) / (present + late + absent)
//
// Pending (no record yet) and justified leave (Dinas / Cuti / Sakit / excused)
// are left out of both sides. Late counts as present — they showed up — but a
// store where many people are late gets its own colour so it stands out even
// when the rate itself is fine.

import { PENDING_LABEL, isLeaveAttendanceStatus } from '@/lib/attendance-status';

/** At or above this (whole %) attendance is "good". */
export const ATTENDANCE_GOOD_PCT = 90;
/** At or above this (and below good) is "at risk"; under it is "critical". */
export const ATTENDANCE_RISK_PCT = 75;
/** "Many late" needs at least this many late check-ins … */
export const LATE_HEAVY_MIN = 2;
/** … and this share of the people who showed up. */
export const LATE_HEAVY_RATE = 0.2;

export interface AttendanceCounts {
  /** Scheduled working rows (OFF / holidays are never in here). */
  total: number;
  present: number;
  late: number;
  absent: number;
  /** Dinas / Cuti / Sakit / excused — justified, left out of the rate. */
  excused: number;
  /** No attendance record yet — left out of the rate. */
  unset: number;
}

export type AttendanceHealth = 'good' | 'late' | 'risk' | 'critical' | 'pending' | 'none';

/** One store's counts for one day. */
export interface StoreDayCounts extends AttendanceCounts {
  storeId: number;
}

/** GET /api/ops/attendance/overview?month=YYYY-MM — `days` keyed by Jakarta "YYYY-MM-DD". */
export interface AttendanceMonthData {
  /** Every active store in the actor's scope (for the picker), even when `days` is one store. */
  stores: { id: number; storeNo: string; name: string }[];
  days: Record<string, StoreDayCounts[]>;
}

export const EMPTY_COUNTS: AttendanceCounts = {
  total: 0, present: 0, late: 0, absent: 0, excused: 0, unset: 0,
};

export function addCounts(a: AttendanceCounts, b: AttendanceCounts): AttendanceCounts {
  return {
    total:   a.total   + b.total,
    present: a.present + b.present,
    late:    a.late    + b.late,
    absent:  a.absent  + b.absent,
    excused: a.excused + b.excused,
    unset:   a.unset   + b.unset,
  };
}

/**
 * Add one scheduled shift to `c` (mutates): its recorded status, or pending
 * (`unset`) when there is none. Dinas / Cuti / Sakit and the legacy "excused"
 * all fold into `excused`. Every screen that counts attendance goes through
 * here, so a status can't land in a different bucket on different pages.
 */
export function tallyStatus(c: AttendanceCounts, status: string | null | undefined): void {
  c.total++;
  if (!status) c.unset++;
  else if (status === 'present') c.present++;
  else if (status === 'late') c.late++;
  else if (status === 'absent') c.absent++;
  else if (status === 'excused' || isLeaveAttendanceStatus(status)) c.excused++;
}

/** Everyone who showed up — present + late (late people did come). */
export function showedUp(c: AttendanceCounts): number {
  return c.present + c.late;
}

/** Present + late over present + late + absent, whole %; null when nobody is countable yet. */
export function attendanceRate(c: AttendanceCounts): number | null {
  const showed = showedUp(c);
  const counted = showed + c.absent;
  if (counted === 0) return null;
  return Math.round((showed / counted) * 100);
}

/** Enough late check-ins, relative to who showed up, to call it out. */
export function isLateHeavy(c: AttendanceCounts): boolean {
  const showed = showedUp(c);
  return c.late >= LATE_HEAVY_MIN && showed > 0 && c.late / showed >= LATE_HEAVY_RATE;
}

/**
 * good     rate ≥ 90% and lateness normal
 * late     rate ≥ 90% but many late (own colour)
 * risk     75–89%
 * critical < 75%
 * pending  scheduled, but nobody is countable yet (all pending)
 * none     nothing to judge (no schedule, or everyone on leave)
 *
 * Judged on the rounded % that is displayed, so 89.6% shows as "90%" and is
 * good — what you read is what the colour means.
 */
export function attendanceHealth(c: AttendanceCounts): AttendanceHealth {
  if (c.total === 0) return 'none';
  const rate = attendanceRate(c);
  if (rate === null) return c.unset > 0 ? 'pending' : 'none';
  if (rate < ATTENDANCE_RISK_PCT) return 'critical';
  if (rate < ATTENDANCE_GOOD_PCT) return 'risk';
  return isLateHeavy(c) ? 'late' : 'good';
}

/** Lower = worse; for sorting worst-first. */
const SEVERITY: Record<AttendanceHealth, number> = {
  critical: 0, risk: 1, late: 2, pending: 3, good: 4, none: 5,
};

export function healthSeverity(h: AttendanceHealth): number {
  return SEVERITY[h];
}

/** Needs someone to look at it (as opposed to good / still pending / nothing to judge). */
export function isIssueHealth(h: AttendanceHealth): boolean {
  return h === 'critical' || h === 'risk' || h === 'late';
}

export const HEALTH_LABEL: Record<AttendanceHealth, string> = {
  good: 'Good',
  late: 'Many late',
  risk: 'At risk',
  critical: 'Critical',
  pending: PENDING_LABEL,
  none: '—',
};

// lib/employee-week.ts
// ─────────────────────────────────────────────────────────────────────────────
// "This week's schedule" on the employee Home: wire types + the pure parts
// (GET /api/employee/schedule/week builds it, WeekScheduleCard draws it).
// Client-safe. Days are Jakarta calendar days, Monday → Sunday.
// ─────────────────────────────────────────────────────────────────────────────

export type WeekDayKind = 'shift' | 'off' | 'leave' | 'none';

export interface WeekDay {
  /** Jakarta day "YYYY-MM-DD". */
  date: string;
  kind: WeekDayKind;
  /** shifts.code — null unless kind is 'shift'. */
  shift: string | null;
  shiftLabel: string | null;
  /** "HH:MM:SS" store-local wall-clock, or null (Dinas has no hours). */
  startTime: string | null;
  endTime: string | null;
}

export interface WeekScheduleResponse {
  success: boolean;
  error?: string;
  from: string;
  to: string;
  today: string;
  days: WeekDay[];
}

/** What one monthly-schedule entry says about its day. */
export function dayKind(entry: { isOff: boolean; isLeave: boolean; shiftCode: string | null } | null | undefined): WeekDayKind {
  if (!entry) return 'none';
  if (entry.isLeave) return 'leave';
  if (entry.isOff || !entry.shiftCode) return 'off';
  return 'shift';
}

/** "08:00" from "08:00:00". */
export function hm(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : '';
}

/** "08:00–16:00", or '' when the shift has no hours. */
export function shiftHours(day: Pick<WeekDay, 'startTime' | 'endTime'>): string {
  return day.startTime && day.endTime ? `${hm(day.startTime)}–${hm(day.endTime)}` : '';
}

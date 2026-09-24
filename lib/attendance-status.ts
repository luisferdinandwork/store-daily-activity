// lib/attendance-status.ts
// Shared attendance-status vocabulary (client-safe — no DB imports).
// Must stay in sync with attendanceStatusEnum in lib/db/schema/enums.ts.

export const ATTENDANCE_STATUSES = [
  'present',
  'late',
  'absent',
  'excused',
  'dinas',
  'cuti',
  'sakit_tanpa_surat',
  'sakit_dengan_surat',
] as const;

export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];

/**
 * Justified absences Ops records on a scheduled day (D / C / STD / SD). The
 * employee didn't work, but it isn't a no-show — dashboards and overview
 * counters fold these into the "excused" bucket.
 */
export const LEAVE_ATTENDANCE_STATUSES = [
  'dinas',
  'cuti',
  'sakit_tanpa_surat',
  'sakit_dengan_surat',
] as const satisfies readonly AttendanceStatus[];

export type LeaveAttendanceStatus = typeof LEAVE_ATTENDANCE_STATUSES[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
  dinas: 'Dinas',
  cuti: 'Cuti',
  sakit_tanpa_surat: 'Sakit tanpa surat dokter',
  sakit_dengan_surat: 'Sakit dengan surat dokter',
};

/** Roster code shown next to leave statuses. */
export const ATTENDANCE_STATUS_CODES: Partial<Record<AttendanceStatus, string>> = {
  dinas: 'D',
  cuti: 'C',
  sakit_tanpa_surat: 'STD',
  sakit_dengan_surat: 'SD',
};

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

export function isLeaveAttendanceStatus(value: unknown): value is LeaveAttendanceStatus {
  return typeof value === 'string' && (LEAVE_ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

/** Did not work that day, justified or not (absent, excused, D/C/STD/SD). */
export function isNoWorkStatus(value: string | null | undefined): boolean {
  return value === 'absent' || value === 'excused' || isLeaveAttendanceStatus(value);
}

/** "Sakit tanpa surat dokter (STD)" — label plus roster code when there is one. */
export function attendanceStatusLabel(value: string | null | undefined): string {
  if (!value) return '—';
  if (!isAttendanceStatus(value)) return value;
  const code = ATTENDANCE_STATUS_CODES[value];
  return code ? `${ATTENDANCE_STATUS_LABELS[value]} (${code})` : ATTENDANCE_STATUS_LABELS[value];
}

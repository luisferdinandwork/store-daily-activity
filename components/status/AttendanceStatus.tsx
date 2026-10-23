// components/status/AttendanceStatus.tsx
//
// The one place attendance statuses are defined and drawn — Ops (Dashboard, Attendance,
// Stores, Areas) and the employee app alike take their name, icon and colours from here,
// so "Pending" can't be "Belum hadir" on one page and "Not checked in" on another, and
// "Late" can't be amber here and fuchsia there. The colours themselves come from the shared
// palette (lib/status-theme.ts: ATTENDANCE_TONE / HEALTH_TONE → TONES) — retune them there.
//
//   STATUS                      per-status look (label, icon, tone + chip / dot / text / tile colours)
//   AttendanceStatusBadge/Dot   one person's status
//   ATTENDANCE_COUNT_ITEMS      the standard order + names for a store / day's counts
//   AttendanceCountsLine        "12 Present · 2 Late · 1 Absent · 1 Dinas · 3 Pending · 2 Not scheduled"
//   HEALTH_STYLE                store / day level colours (good / at risk / critical …)
//
// The words themselves live in lib/attendance-status.ts (labels, PENDING_LABEL,
// ON_LEAVE_LABEL) — rename them there. Late has its own colour (fuchsia) on
// purpose: amber is "at risk" on the calendar, so a late check-in must not read
// as a risk signal.

import type { ElementType } from 'react';
import {
  CheckCircle2, XCircle, Clock, AlertCircle, HelpCircle,
  Briefcase, Palmtree, Thermometer, Stethoscope,
  CalendarOff, MinusCircle, CircleDashed, CircleSlash, UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ATTENDANCE_STATUS_CODES, ATTENDANCE_STATUS_LABELS, ON_LEAVE_LABEL, PENDING_LABEL,
  attendanceStatusLabel, isLeaveAttendanceStatus, type AttendanceStatus,
} from '@/lib/attendance-status';
import type { AttendanceCounts, AttendanceHealth } from '@/lib/attendance-health';
import { ATTENDANCE_TONE, HEALTH_TONE, TONES, type AttendanceTag, type Tone } from '@/lib/status-theme';

/** What a scheduled shift can read as: a recorded status, or pending (nothing recorded yet). */
export type RowStatus = AttendanceStatus | 'pending';

/**
 * Everything that can be drawn as a status tag. On top of RowStatus:
 *   leave          justified leave as a count (Cuti / Sakit / excused), or a planned leave day
 *   off            planned day off — no attendance expected
 *   not_scheduled  no shift today
 *   not_recording  the store isn't active, so nothing is recorded
 */
export type { AttendanceTag };

export interface StatusStyle {
  label: string;
  Icon:  ElementType;
  tone:  Tone;
  /** Border + fill + text, for a chip. */
  chip:  string;
  /** Solid dot. */
  dot:   string;
  /** Text only, for a figure or word in running text. */
  text:  string;
  /** Soft fill + text, for an icon tile. */
  soft:  string;
  /** Very light fill only (a card tile behind `text`). */
  tint:  string;
  /** Text colour on a dark hero banner. */
  onDark: string;
}

const STATUS_DEF: Record<AttendanceTag, { label: string; Icon: ElementType }> = {
  present: { label: attendanceStatusLabel('present'), Icon: CheckCircle2 },
  late:    { label: attendanceStatusLabel('late'),    Icon: Clock },
  absent:  { label: attendanceStatusLabel('absent'),  Icon: XCircle },
  excused: { label: attendanceStatusLabel('excused'), Icon: AlertCircle },
  dinas:              { label: attendanceStatusLabel('dinas'),              Icon: Briefcase },
  cuti:               { label: attendanceStatusLabel('cuti'),               Icon: Palmtree },
  sakit_tanpa_surat:  { label: attendanceStatusLabel('sakit_tanpa_surat'),  Icon: Thermometer },
  sakit_dengan_surat: { label: attendanceStatusLabel('sakit_dengan_surat'), Icon: Stethoscope },
  backup:             { label: attendanceStatusLabel('backup'),             Icon: UserPlus },
  pending: { label: PENDING_LABEL,  Icon: HelpCircle },
  leave:   { label: ON_LEAVE_LABEL, Icon: CalendarOff },
  off:           { label: 'Off',           Icon: MinusCircle },
  not_scheduled: { label: 'Not scheduled', Icon: CircleDashed },
  not_recording: { label: 'Not recording', Icon: CircleSlash },
};

// Colours: lib/status-theme.ts. A dashed dot marks "nothing expected" (not scheduled / not recording).
const DASHED_DOT = 'border border-dashed border-slate-300';
export const STATUS = Object.fromEntries(
  (Object.keys(STATUS_DEF) as AttendanceTag[]).map((tag) => {
    const tone = ATTENDANCE_TONE[tag];
    const t = TONES[tone];
    return [tag, {
      ...STATUS_DEF[tag], tone,
      chip: t.chip, text: t.text, soft: t.soft, tint: t.tint, onDark: t.onDark,
      dot: tag === 'not_scheduled' || tag === 'not_recording' ? DASHED_DOT : t.dot,
    } satisfies StatusStyle];
  }),
) as Record<AttendanceTag, StatusStyle>;

export function isAttendanceTag(value: string): value is AttendanceTag {
  return Object.prototype.hasOwnProperty.call(STATUS, value);
}

// ─── One person's status ─────────────────────────────────────────────────────

/**
 * Icon + name chip. `compact` shows the roster code for Dinas / Cuti / Sakit
 * (D / C / STD / SD) when there is one; the full name stays in the tooltip.
 */
export function AttendanceStatusBadge({
  status, compact, label, title, className,
}: {
  status:     AttendanceTag;
  compact?:   boolean;
  /** Replaces the text for a state laid over the status (e.g. "On Break"); the colours stay the status's. */
  label?:     string;
  /** Tooltip; defaults to the full name. */
  title?:     string;
  className?: string;
}) {
  const st   = STATUS[status];
  const code = compact && isLeaveAttendanceStatus(status) ? ATTENDANCE_STATUS_CODES[status] : undefined;
  return (
    <span
      title={title ?? st.label}
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
        st.chip,
        className,
      )}
    >
      <st.Icon className="h-3 w-3 flex-shrink-0" />
      {label ?? code ?? st.label}
    </span>
  );
}

/** Dot in the status colour; pass a `bg-*` class to override it (it wins over the status's). */
export function AttendanceStatusDot({ status, className }: { status: AttendanceTag; className?: string }) {
  return <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', className ?? STATUS[status].dot)} />;
}

// ─── A store's / day's counts ────────────────────────────────────────────────

export type CountKey = 'present' | 'late' | 'absent' | 'dinas' | 'excused' | 'unset';

const COUNT_ITEM_DEFS: { key: CountKey; tag: AttendanceTag; hint: string }[] = [
  { key: 'present', tag: 'present', hint: 'Checked in on time' },
  { key: 'late',    tag: 'late',    hint: 'Checked in late' },
  { key: 'absent',  tag: 'absent',  hint: 'Did not show up' },
  { key: 'dinas',   tag: 'dinas',   hint: 'On dinas — working outside the store' },
  { key: 'excused', tag: 'leave',   hint: 'Izin (or older Cuti / Sakit) — a justified absence' },
  { key: 'unset',   tag: 'pending', hint: 'No attendance recorded yet' },
];

/** The standard order and names of a count breakdown — draw tiles from this too, not your own list. */
export const ATTENDANCE_COUNT_ITEMS = COUNT_ITEM_DEFS.map((d) => ({
  ...d,
  // A count says "Dinas", not the chip's "Dinas (D)" — the roster code is for the chip.
  label: d.key === 'dinas' ? ATTENDANCE_STATUS_LABELS.dinas : STATUS[d.tag].label,
  text:  STATUS[d.tag].text,
}));

/**
 * "12 Present · 2 Late · 1 Absent · 1 Dinas · 3 Pending" in the standard colours.
 * Present always shows (even 0 — that's the number people look for); the rest
 * only when there is something to say.
 *
 * `noSchedule` is optional: employees on the roster with no shift (not even an
 * OFF / leave day) today. It isn't one of a day's scheduled shifts, so it isn't
 * part of ATTENDANCE_COUNT_ITEMS — only screens that work it out pass it in.
 */
export function AttendanceCountsLine({
  counts, className,
}: {
  counts:     Pick<AttendanceCounts, CountKey> & { noSchedule?: number };
  className?: string;
}) {
  const noSchedule = counts.noSchedule ?? 0;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]', className)}>
      {ATTENDANCE_COUNT_ITEMS.map(({ key, label, text, hint }) =>
        key === 'present' || counts[key] > 0 ? (
          <span key={key} title={hint} className={cn('font-medium', text)}>
            <span className="tabular-nums">{counts[key]}</span> {label}
          </span>
        ) : null,
      )}
      {noSchedule > 0 && (
        <span title="On the store roster but no shift (or OFF / leave) scheduled today" className={cn('font-medium', STATUS.not_scheduled.text)}>
          <span className="tabular-nums">{noSchedule}</span> {STATUS.not_scheduled.label}
        </span>
      )}
    </div>
  );
}

// ─── Health tones (store / day level) ────────────────────────────────────────
// `bg` = solid dot/bar, `solid` = filled pill, `light` + `border` = tinted card,
// `text` = figures, `ring` = selected outline.
export interface HealthStyle {
  bg: string;
  solid: string;
  ring: string;
  text: string;
  light: string;
  border: string;
}

export const HEALTH_STYLE = Object.fromEntries(
  (Object.keys(HEALTH_TONE) as AttendanceHealth[]).map((health) => {
    const t = TONES[HEALTH_TONE[health]];
    return [health, { bg: t.dot, solid: t.solid, ring: t.ring, text: t.strong, light: t.tint, border: t.border } satisfies HealthStyle];
  }),
) as Record<AttendanceHealth, HealthStyle>;

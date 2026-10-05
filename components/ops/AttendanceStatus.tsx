// components/ops/AttendanceStatus.tsx
//
// The one place Ops attendance statuses are defined and drawn. Every screen that
// shows attendance — Dashboard, Attendance (calendar, day panel, store detail),
// Stores, Areas — takes its name, icon and colours from here, so "Pending" can't
// be "Belum hadir" on one page and "Not checked in" on another.
//
//   STATUS                      per-status look (label, icon, chip / dot / text colours)
//   AttendanceStatusBadge/Dot   one person's status
//   ATTENDANCE_COUNT_ITEMS      the standard order + names for a store / day's counts
//   AttendanceCountsLine        "12 Present · 2 Late · 1 Absent · 3 Pending"
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
  CalendarOff, MinusCircle, CircleDashed, CircleSlash,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ATTENDANCE_STATUS_CODES, ON_LEAVE_LABEL, PENDING_LABEL,
  attendanceStatusLabel, isLeaveAttendanceStatus, type AttendanceStatus,
} from '@/lib/attendance-status';
import type { AttendanceCounts, AttendanceHealth } from '@/lib/attendance-health';

/** What a scheduled shift can read as: a recorded status, or pending (nothing recorded yet). */
export type RowStatus = AttendanceStatus | 'pending';

/**
 * Everything that can be drawn as a status tag. On top of RowStatus:
 *   leave          the whole justified-absence group (counts), or a planned leave day
 *   off            planned day off — no attendance expected
 *   not_scheduled  no shift today
 *   not_recording  the store isn't active, so nothing is recorded
 */
export type AttendanceTag = RowStatus | 'leave' | 'off' | 'not_scheduled' | 'not_recording';

export interface StatusStyle {
  label: string;
  Icon:  ElementType;
  /** Border + fill + text, for a chip. */
  chip:  string;
  /** Solid dot. */
  dot:   string;
  /** Text only, for a figure or word in running text. */
  text:  string;
}

// Whole class names so Tailwind sees them.
// green = present, fuchsia = late, red = absent, blue = pending, violet = on leave.
export const STATUS: Record<AttendanceTag, StatusStyle> = {
  present: { label: attendanceStatusLabel('present'), Icon: CheckCircle2, chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', text: 'text-emerald-600' },
  late:    { label: attendanceStatusLabel('late'),    Icon: Clock,        chip: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700', dot: 'bg-fuchsia-500', text: 'text-fuchsia-600' },
  absent:  { label: attendanceStatusLabel('absent'),  Icon: XCircle,      chip: 'border-red-200 bg-red-50 text-red-700',             dot: 'bg-red-500',     text: 'text-red-600'     },
  excused: { label: attendanceStatusLabel('excused'), Icon: AlertCircle,  chip: 'border-border bg-secondary text-muted-foreground',  dot: 'bg-slate-400',   text: 'text-slate-500'   },
  dinas:              { label: attendanceStatusLabel('dinas'),              Icon: Briefcase,   chip: 'border-indigo-200 bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500', text: 'text-indigo-600' },
  cuti:               { label: attendanceStatusLabel('cuti'),               Icon: Palmtree,    chip: 'border-violet-200 bg-violet-50 text-violet-700', dot: 'bg-violet-500', text: 'text-violet-600' },
  sakit_tanpa_surat:  { label: attendanceStatusLabel('sakit_tanpa_surat'),  Icon: Thermometer, chip: 'border-orange-200 bg-orange-50 text-orange-700', dot: 'bg-orange-500', text: 'text-orange-600' },
  sakit_dengan_surat: { label: attendanceStatusLabel('sakit_dengan_surat'), Icon: Stethoscope, chip: 'border-teal-200 bg-teal-50 text-teal-700',       dot: 'bg-teal-500',   text: 'text-teal-600'   },
  pending: { label: PENDING_LABEL,  Icon: HelpCircle, chip: 'border-sky-200 bg-sky-50 text-sky-700',             dot: 'bg-sky-400',   text: 'text-sky-600'   },
  leave:   { label: ON_LEAVE_LABEL, Icon: CalendarOff, chip: 'border-violet-200 bg-violet-50 text-violet-700',   dot: 'bg-violet-500', text: 'text-violet-600' },
  off:           { label: 'Off',           Icon: MinusCircle,  chip: 'border-border bg-secondary text-muted-foreground', dot: 'bg-slate-300', text: 'text-slate-500' },
  not_scheduled: { label: 'Not scheduled', Icon: CircleDashed, chip: 'border-slate-200 bg-slate-50 text-slate-400',      dot: 'border border-dashed border-slate-300', text: 'text-slate-400' },
  not_recording: { label: 'Not recording', Icon: CircleSlash,  chip: 'border-slate-200 bg-slate-50 text-slate-400',      dot: 'border border-dashed border-slate-300', text: 'text-slate-400' },
};

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

export type CountKey = 'present' | 'late' | 'absent' | 'excused' | 'unset';

const COUNT_ITEM_DEFS: { key: CountKey; tag: AttendanceTag; hint: string }[] = [
  { key: 'present', tag: 'present', hint: 'Checked in on time' },
  { key: 'late',    tag: 'late',    hint: 'Checked in late' },
  { key: 'absent',  tag: 'absent',  hint: 'Did not show up' },
  { key: 'excused', tag: 'leave',   hint: 'Dinas / Cuti / Sakit — a justified absence' },
  { key: 'unset',   tag: 'pending', hint: 'No attendance recorded yet' },
];

/** The standard order and names of a count breakdown — draw tiles from this too, not your own list. */
export const ATTENDANCE_COUNT_ITEMS = COUNT_ITEM_DEFS.map((d) => ({
  ...d,
  label: STATUS[d.tag].label,
  text:  STATUS[d.tag].text,
}));

/**
 * "12 Present · 2 Late · 1 Absent · 3 Pending" in the standard colours. Present
 * always shows (even 0 — that's the number people look for); the rest only
 * when there is something to say.
 */
export function AttendanceCountsLine({
  counts, className,
}: {
  counts:     Pick<AttendanceCounts, CountKey>;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]', className)}>
      {ATTENDANCE_COUNT_ITEMS.map(({ key, label, text, hint }) =>
        key === 'present' || counts[key] > 0 ? (
          <span key={key} title={hint} className={cn('font-medium', text)}>
            <span className="tabular-nums">{counts[key]}</span> {label}
          </span>
        ) : null,
      )}
    </div>
  );
}

// ─── Health tones (store / day level) ────────────────────────────────────────
// `bg` = solid dot/bar, `light` + `border` = tinted card, `text` = figures,
// `ring` = selected outline.
export interface HealthStyle {
  bg: string;
  ring: string;
  text: string;
  light: string;
  border: string;
}

export const HEALTH_STYLE: Record<AttendanceHealth, HealthStyle> = {
  good:     { bg: 'bg-emerald-500', ring: 'ring-emerald-300', text: 'text-emerald-700', light: 'bg-emerald-50', border: 'border-emerald-200' },
  late:     { bg: 'bg-fuchsia-500', ring: 'ring-fuchsia-300', text: 'text-fuchsia-700', light: 'bg-fuchsia-50', border: 'border-fuchsia-200' },
  risk:     { bg: 'bg-amber-400',   ring: 'ring-amber-300',   text: 'text-amber-700',   light: 'bg-amber-50',   border: 'border-amber-200'   },
  critical: { bg: 'bg-red-500',     ring: 'ring-red-300',     text: 'text-red-700',     light: 'bg-red-50',     border: 'border-red-200'     },
  pending:  { bg: 'bg-sky-400',     ring: 'ring-sky-300',     text: 'text-sky-700',     light: 'bg-sky-50',     border: 'border-sky-200'     },
  none:     { bg: 'bg-slate-300',   ring: 'ring-slate-200',   text: 'text-slate-400',   light: 'bg-slate-50',   border: 'border-slate-100'   },
};

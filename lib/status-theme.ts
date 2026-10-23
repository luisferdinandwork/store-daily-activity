// lib/status-theme.ts
//
// THE colour code for attendance and task-progress statuses — every page (employee
// app, PIC, Ops, IT, Finance) takes its status colours from here, so "late" or "done"
// can't look different from one screen to the next. Client-safe: plain strings, no React.
//
//   TONES               the palette: a semantic tone → every look it needs (chip, soft, solid, dot, …)
//   ATTENDANCE_TONE     attendance status → tone      HEALTH_TONE   store / day health → tone
//   taskStatusTone()    a task's status → tone        storeProgressTone()  a store's roll-up → tone
//   rateTone() / HEAT_STEPS / CELL_BOX   completion-rate bands, % heat-map steps, status squares
//
// Draw them with components/status/AttendanceStatus.tsx and components/status/TaskStatus.tsx
// (icons + words); only reach for TONES directly for a bar, stripe or tile.
//
// Meaning, not hue: success = good / done · danger = failed / missed · warning = needs
// attention / pending · late = checked in late (its own colour on purpose — amber is
// "at risk", a late check-in must not read as a risk signal) · info = nothing recorded yet ·
// active = being worked on · leave / backup / sick / verified = the justified-absence and
// verified family · neutral = not started / off · muted = nothing expected.
//
// Whole class names on purpose — Tailwind only generates what it can read.

import type { AttendanceStatus } from '@/lib/attendance-status';
import type { AttendanceHealth } from '@/lib/attendance-health';

export type Tone =
  | 'success' | 'danger' | 'warning' | 'late' | 'info' | 'active'
  | 'leave' | 'backup' | 'sick' | 'verified' | 'neutral' | 'muted';

export interface ToneStyle {
  /** Border + soft fill + text — a bordered chip / badge (add `border`). */
  chip: string;
  /** Soft fill + text, no border — an icon tile or pill. */
  soft: string;
  /** Saturated fill + readable text — a calendar pill, a status square. */
  solid: string;
  /** Fill only — a dot, a progress bar, a left stripe. */
  dot: string;
  /** Text only — a figure or word in running text. */
  text: string;
  /** Darker text — a figure on a tinted card. */
  strong: string;
  /** Selected outline (`ring-*`). */
  ring: string;
  /** Border colour only. */
  border: string;
  /** Inset hairline ring — an outlined square (`ring-1 ring-inset …`). */
  outline: string;
  /** Very light fill only. */
  tint: string;
  /** Text colour on a dark hero banner. */
  onDark: string;
  /** Chip on a dark hero banner. */
  onDarkChip: string;
}

export const TONES: Record<Tone, ToneStyle> = {
  success: {
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', soft: 'bg-emerald-50 text-emerald-600', solid: 'bg-emerald-500 text-white',
    dot: 'bg-emerald-500', text: 'text-emerald-600', strong: 'text-emerald-700', ring: 'ring-emerald-300', border: 'border-emerald-200',
    outline: 'ring-1 ring-inset ring-emerald-200', tint: 'bg-emerald-50', onDark: 'text-emerald-300', onDarkChip: 'bg-emerald-400/90 text-emerald-950',
  },
  danger: {
    chip: 'border-rose-200 bg-rose-50 text-rose-700', soft: 'bg-rose-50 text-rose-600', solid: 'bg-rose-500 text-white',
    dot: 'bg-rose-500', text: 'text-rose-600', strong: 'text-rose-700', ring: 'ring-rose-300', border: 'border-rose-200',
    outline: 'ring-1 ring-inset ring-rose-200', tint: 'bg-rose-50', onDark: 'text-rose-300', onDarkChip: 'bg-rose-400 text-white',
  },
  warning: {
    chip: 'border-amber-200 bg-amber-50 text-amber-700', soft: 'bg-amber-50 text-amber-600', solid: 'bg-amber-400 text-amber-950',
    dot: 'bg-amber-400', text: 'text-amber-600', strong: 'text-amber-700', ring: 'ring-amber-300', border: 'border-amber-200',
    outline: 'ring-1 ring-inset ring-amber-200', tint: 'bg-amber-50', onDark: 'text-amber-300', onDarkChip: 'bg-amber-300/90 text-amber-950',
  },
  late: {
    chip: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700', soft: 'bg-fuchsia-50 text-fuchsia-600', solid: 'bg-fuchsia-500 text-white',
    dot: 'bg-fuchsia-500', text: 'text-fuchsia-600', strong: 'text-fuchsia-700', ring: 'ring-fuchsia-300', border: 'border-fuchsia-200',
    outline: 'ring-1 ring-inset ring-fuchsia-200', tint: 'bg-fuchsia-50', onDark: 'text-fuchsia-300', onDarkChip: 'bg-fuchsia-400 text-white',
  },
  info: {
    chip: 'border-sky-200 bg-sky-50 text-sky-700', soft: 'bg-sky-50 text-sky-600', solid: 'bg-sky-500 text-white',
    dot: 'bg-sky-400', text: 'text-sky-600', strong: 'text-sky-700', ring: 'ring-sky-300', border: 'border-sky-200',
    outline: 'ring-1 ring-inset ring-sky-200', tint: 'bg-sky-50', onDark: 'text-sky-300', onDarkChip: 'bg-sky-300/90 text-sky-950',
  },
  active: {
    chip: 'border-indigo-200 bg-indigo-50 text-indigo-700', soft: 'bg-indigo-50 text-indigo-600', solid: 'bg-indigo-500 text-white',
    dot: 'bg-indigo-500', text: 'text-indigo-600', strong: 'text-indigo-700', ring: 'ring-indigo-300', border: 'border-indigo-200',
    outline: 'ring-1 ring-inset ring-indigo-200', tint: 'bg-indigo-50', onDark: 'text-indigo-300', onDarkChip: 'bg-white/25 text-white',
  },
  leave: {
    chip: 'border-violet-200 bg-violet-50 text-violet-700', soft: 'bg-violet-50 text-violet-600', solid: 'bg-violet-500 text-white',
    dot: 'bg-violet-500', text: 'text-violet-600', strong: 'text-violet-700', ring: 'ring-violet-300', border: 'border-violet-200',
    outline: 'ring-1 ring-inset ring-violet-200', tint: 'bg-violet-50', onDark: 'text-violet-300', onDarkChip: 'bg-violet-300/90 text-violet-950',
  },
  backup: {
    chip: 'border-cyan-200 bg-cyan-50 text-cyan-700', soft: 'bg-cyan-50 text-cyan-600', solid: 'bg-cyan-500 text-white',
    dot: 'bg-cyan-500', text: 'text-cyan-600', strong: 'text-cyan-700', ring: 'ring-cyan-300', border: 'border-cyan-200',
    outline: 'ring-1 ring-inset ring-cyan-200', tint: 'bg-cyan-50', onDark: 'text-cyan-300', onDarkChip: 'bg-cyan-300/90 text-cyan-950',
  },
  sick: {
    chip: 'border-orange-200 bg-orange-50 text-orange-700', soft: 'bg-orange-50 text-orange-600', solid: 'bg-orange-500 text-white',
    dot: 'bg-orange-500', text: 'text-orange-600', strong: 'text-orange-700', ring: 'ring-orange-300', border: 'border-orange-200',
    outline: 'ring-1 ring-inset ring-orange-200', tint: 'bg-orange-50', onDark: 'text-orange-300', onDarkChip: 'bg-orange-300/90 text-orange-950',
  },
  verified: {
    chip: 'border-teal-200 bg-teal-50 text-teal-700', soft: 'bg-teal-50 text-teal-600', solid: 'bg-teal-500 text-white',
    dot: 'bg-teal-500', text: 'text-teal-600', strong: 'text-teal-700', ring: 'ring-teal-300', border: 'border-teal-200',
    outline: 'ring-1 ring-inset ring-teal-200', tint: 'bg-teal-50', onDark: 'text-teal-300', onDarkChip: 'bg-teal-300 text-teal-950',
  },
  neutral: {
    chip: 'border-slate-200 bg-slate-50 text-slate-600', soft: 'bg-slate-100 text-slate-600', solid: 'bg-slate-500 text-white',
    dot: 'bg-slate-400', text: 'text-slate-500', strong: 'text-slate-600', ring: 'ring-slate-300', border: 'border-slate-200',
    outline: 'ring-1 ring-inset ring-slate-300', tint: 'bg-slate-50', onDark: 'text-white/70', onDarkChip: 'bg-white/15 text-white',
  },
  muted: {
    chip: 'border-slate-200 bg-slate-50 text-slate-400', soft: 'bg-slate-50 text-slate-400', solid: 'bg-slate-200 text-slate-600',
    dot: 'bg-slate-300', text: 'text-slate-400', strong: 'text-slate-400', ring: 'ring-slate-200', border: 'border-slate-100',
    outline: 'ring-1 ring-inset ring-slate-200', tint: 'bg-slate-50', onDark: 'text-white/50', onDarkChip: 'bg-white/10 text-white/70',
  },
};

/** Tone as a hex colour, for SVG strokes and inline styles (the 500 step of each Tailwind family). */
export const TONE_HEX: Record<Tone, string> = {
  success: '#10b981', danger: '#f43f5e', warning: '#fbbf24', late: '#d946ef', info: '#38bdf8', active: '#6366f1',
  leave: '#8b5cf6', backup: '#06b6d4', sick: '#f97316', verified: '#14b8a6', neutral: '#94a3b8', muted: '#cbd5e1',
};

// ─── Attendance ──────────────────────────────────────────────────────────────

/** Everything that can be drawn as an attendance tag (see components/status/AttendanceStatus.tsx). */
export type AttendanceTag = AttendanceStatus | 'pending' | 'leave' | 'off' | 'not_scheduled' | 'not_recording';

export const ATTENDANCE_TONE: Record<AttendanceTag, Tone> = {
  present: 'success',
  late: 'late',
  absent: 'danger',
  excused: 'neutral',
  dinas: 'active',
  cuti: 'leave',
  sakit_tanpa_surat: 'sick',
  sakit_dengan_surat: 'verified',
  backup: 'backup',
  pending: 'info',
  leave: 'leave',
  off: 'neutral',
  not_scheduled: 'muted',
  not_recording: 'muted',
};

/** Tone for something the employee is doing right now — on break. */
export const BREAK_TONE: Tone = 'warning';

/** A store's / day's attendance health (lib/attendance-health.ts). */
export const HEALTH_TONE: Record<AttendanceHealth, Tone> = {
  good: 'success',
  late: 'late',
  risk: 'warning',
  critical: 'danger',
  pending: 'info',
  none: 'muted',
};

// ─── Task progress ───────────────────────────────────────────────────────────

export const TASK_STATUS_LABELS: Record<string, string> = {
  not_started: 'Belum mulai',
  in_progress: 'Aktif',
  pending: 'Pending',
  completed: 'Selesai',
  verified: 'Terverifikasi',
  rejected: 'Ditolak',
  on_hold: 'Ditahan',
};

/**
 * One task's status as a tone. `isPast`: the day is over, so a task nobody did is
 * missed (danger) rather than "not started yet" (neutral).
 */
export function taskStatusTone(status: string | null | undefined, isPast = false): Tone {
  switch (status) {
    case 'completed': return 'success';
    case 'verified': return 'verified';
    case 'rejected': return 'danger';
    case 'in_progress': return 'active';
    case 'pending':
    case 'on_hold': return 'warning';
    case 'partial': return isPast ? 'danger' : 'active';
    case 'missed': return 'danger';
    default: return isPast ? 'danger' : 'neutral';
  }
}

/** A store's roll-up for one task (lib/task-progress.ts `StoreProgressKey`). */
export function storeProgressTone(key: string, isPast: boolean): Tone {
  switch (key) {
    case 'completed': return 'success';
    case 'pending': return 'warning';
    case 'in_progress': return 'active';
    case 'partial': return isPast ? 'danger' : 'active';
    case 'not_started': return isPast ? 'danger' : 'neutral';
    default: return 'muted';
  }
}

/** The status squares of the task board / grids (components/tasks/TaskCell.tsx). */
export type CellState = 'done' | 'partial' | 'active' | 'flagged' | 'todo' | 'missed' | 'none' | 'clear' | 'waiting';

export const CELL_BOX: Record<CellState, string> = {
  done: TONES.success.solid,
  partial: `${TONES.active.soft} ${TONES.active.outline}`,
  active: TONES.active.solid,
  flagged: TONES.warning.solid,
  todo: 'bg-white text-slate-300 ring-1 ring-inset ring-slate-300',
  missed: TONES.danger.solid,
  none: 'bg-transparent text-slate-200',
  clear: TONES.success.soft,
  waiting: TONES.warning.solid,
};

/** Completion rate bands — the bar under every "x% of tasks done". */
export function rateTone(rate: number): Tone {
  if (rate >= 80) return 'success';
  if (rate >= 50) return 'warning';
  return 'danger';
}

/** % heat-map steps (stores × days grids): the cell, and the legend swatch. */
export const HEAT_STEPS: { min: number; label: string; cell: string; swatch: string }[] = [
  { min: 100, label: '100%', cell: 'bg-emerald-500 text-white', swatch: 'bg-emerald-500' },
  { min: 80, label: '80–99%', cell: 'bg-emerald-200 text-emerald-900', swatch: 'bg-emerald-200' },
  { min: 50, label: '50–79%', cell: 'bg-amber-300 text-amber-950', swatch: 'bg-amber-300' },
  { min: 1, label: '1–49%', cell: 'bg-rose-300 text-rose-950', swatch: 'bg-rose-300' },
  { min: 0, label: '0%', cell: 'bg-rose-500 text-white', swatch: 'bg-rose-500' },
];

export function heatStep(pct: number) {
  return HEAT_STEPS.find((s) => pct >= s.min) ?? HEAT_STEPS[HEAT_STEPS.length - 1];
}

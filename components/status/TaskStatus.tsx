// components/status/TaskStatus.tsx
//
// The one place a task's progress status is named, iconed and coloured — the employee task
// list and headers, PIC, Ops task progress (board, grids, store day, task detail) and IT
// task monitoring all draw from here, so "Selesai", "Pending" or "Belum mulai" look the
// same on every screen. Colours come from the shared palette (lib/status-theme.ts:
// taskStatusTone / storeProgressTone / rateTone → TONES); retune them there.
//
//   TASK_STATUS         per-status words + icon + tone for a task row
//   TaskStatusBadge     bordered pill for one task (or a store's roll-up — pass `tone`)
//   TaskStatusTile      the soft icon tile at the start of a task row
//   TaskStatusChip      the chip on the dark employee app bar
//   RateBar             completion-% bar in the standard bands (≥ 80 green · ≥ 50 amber · else red)
//
// The square used by the stores × tasks board is components/tasks/TaskCell.tsx (same tones).

import type { ElementType, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, Clock3, PauseCircle, ShieldCheck, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TASK_STATUS_LABELS, TONES, rateTone, taskStatusTone, type Tone } from '@/lib/status-theme';

export type TaskStatusKey = 'not_started' | 'in_progress' | 'pending' | 'completed' | 'verified' | 'rejected' | 'on_hold';

export const TASK_STATUS: Record<TaskStatusKey, { label: string; Icon: ElementType }> = {
  not_started: { label: TASK_STATUS_LABELS.not_started, Icon: CircleDashed },
  in_progress: { label: TASK_STATUS_LABELS.in_progress, Icon: Clock3 },
  pending: { label: TASK_STATUS_LABELS.pending, Icon: AlertCircle },
  completed: { label: TASK_STATUS_LABELS.completed, Icon: CheckCircle2 },
  verified: { label: TASK_STATUS_LABELS.verified, Icon: ShieldCheck },
  rejected: { label: TASK_STATUS_LABELS.rejected, Icon: XCircle },
  on_hold: { label: TASK_STATUS_LABELS.on_hold, Icon: PauseCircle },
};

function isTaskStatusKey(status: string | null | undefined): status is TaskStatusKey {
  return !!status && Object.prototype.hasOwnProperty.call(TASK_STATUS, status);
}

/** Words + icon for a status; anything unknown reads as "Belum mulai". */
export function taskStatusInfo(status: string | null | undefined) {
  return TASK_STATUS[isTaskStatusKey(status) ? status : 'not_started'];
}

/** Bordered pill. `tone` overrides the status's own (a store roll-up, a "missed" slot); `label` overrides the words. */
export function TaskStatusBadge({
  status, isPast, tone, label, icon, className, children,
}: {
  status?: string | null;
  isPast?: boolean;
  tone?: Tone;
  label?: ReactNode;
  icon?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const t = TONES[tone ?? taskStatusTone(status, isPast)];
  const info = taskStatusInfo(status);
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold', t.chip, className)}>
      {icon && <info.Icon className="h-2.5 w-2.5" />}
      {children ?? label ?? info.label}
    </span>
  );
}

/** Classes for the soft square behind a task's icon. */
export function taskStatusTile(status: string | null | undefined, isPast = false): string {
  return TONES[taskStatusTone(status, isPast)].soft;
}

/** Status chip on the dark employee app bar. */
export function TaskStatusChip({ status }: { status?: string | null }) {
  if (!isTaskStatusKey(status)) return null;
  const info = TASK_STATUS[status];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold', TONES[taskStatusTone(status)].onDarkChip)}>
      <info.Icon className="h-2.5 w-2.5" />
      {info.label}
    </span>
  );
}

/** Completion-% bar in the standard bands. */
export function RateBar({ rate, className, trackClassName }: { rate: number; className?: string; trackClassName?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-100', trackClassName, className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', TONES[rateTone(rate)].dot)}
        style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
      />
    </div>
  );
}

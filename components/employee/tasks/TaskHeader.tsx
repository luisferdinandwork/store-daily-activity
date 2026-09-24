'use client';
// components/employee/tasks/TaskHeader.tsx
//
// Header for task detail pages — the same EmployeeAppBar every other employee
// page uses (back, title, Transfer Order truck, notification bell), with the
// task context on the line under the title: shift · status · autosave state.

import { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import EmployeeAppBar from '@/components/employee/EmployeeAppBar';

export type EmployeeTaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'rejected'
  | 'pending';

interface TaskHeaderProps {
  title: string;
  /** Usually shiftLabel(task.shift). The status is shown as its own chip. */
  subtitle?: string;
  status?: EmployeeTaskStatus | string;
  saveIndicator?: ReactNode;
  onBack?: () => void;
}

const SHIFT_LABELS: Record<string, string> = {
  morning: 'Shift Pagi',
  evening: 'Shift Sore',
  full_day: 'Full Day',
};

/** "morning" → "Shift Pagi" — the subtitle every task page shows. */
export function shiftLabel(shift: string | null | undefined): string | undefined {
  if (!shift) return undefined;
  return SHIFT_LABELS[shift] ?? shift.replace(/_/g, ' ');
}

const STATUS_CHIP: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  not_started: { label: 'Belum mulai', className: 'bg-white/15 text-white', Icon: CircleDashed },
  in_progress: { label: 'Dikerjakan', className: 'bg-white/15 text-white', Icon: Clock3 },
  pending: { label: 'Pending', className: 'bg-amber-300/90 text-amber-950', Icon: AlertCircle },
  completed: { label: 'Selesai', className: 'bg-emerald-400/90 text-emerald-950', Icon: CheckCircle2 },
  verified: { label: 'Terverifikasi', className: 'bg-emerald-300 text-emerald-950', Icon: CheckCircle2 },
  rejected: { label: 'Ditolak', className: 'bg-red-400 text-white', Icon: AlertCircle },
};

export function TaskStatusChip({ status }: { status?: string }) {
  const cfg = status ? STATUS_CHIP[status] : undefined;
  if (!cfg) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold', cfg.className)}>
      <cfg.Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

export default function TaskHeader({ title, subtitle, status, saveIndicator, onBack }: TaskHeaderProps) {
  const hasMeta = Boolean(subtitle || status || saveIndicator);

  return (
    <EmployeeAppBar
      title={title}
      onBack={onBack}
      meta={
        hasMeta ? (
          <>
            {subtitle && <span className="truncate">{subtitle}</span>}
            <TaskStatusChip status={status} />
            {saveIndicator}
          </>
        ) : undefined
      }
    />
  );
}

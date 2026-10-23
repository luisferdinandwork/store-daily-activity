'use client';
// components/employee/tasks/TaskHeader.tsx
//
// Header for task detail pages — the same EmployeeAppBar every other employee
// page uses (back, title, Transfer Order truck, notification bell), with the
// task context on the line under the title: shift · status · autosave state.

import { ReactNode } from 'react';
import { TaskStatusChip } from '@/components/status/TaskStatus';
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
  middle: 'Shift Middle',
  jkp_morning: 'JKP Pagi',
  jkp_evening: 'JKP Siang',
};

/** "morning" → "Shift Pagi" — the subtitle every task page shows. */
export function shiftLabel(shift: string | null | undefined): string | undefined {
  if (!shift) return undefined;
  return SHIFT_LABELS[shift] ?? shift.replace(/_/g, ' ');
}

// The status chip (words, icon, colours) is shared: components/status/TaskStatus.tsx.
export { TaskStatusChip };

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

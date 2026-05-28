'use client';
// components/employee/tasks/TaskHeader.tsx

import { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';

export type EmployeeTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'rejected'
  | 'discrepancy';

interface TaskHeaderProps {
  title: string;
  subtitle?: string;
  status?: EmployeeTaskStatus | string;
  saveIndicator?: ReactNode;
  onBack?: () => void;
}

export default function TaskHeader({
  title,
  subtitle,
  status,
  saveIndicator,
  onBack,
}: TaskHeaderProps) {
  const router = useRouter();

  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
      <button
        type="button"
        onClick={() => (onBack ? onBack() : router.back())}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground"
        aria-label="Kembali"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{title}</p>
        {subtitle && (
          <p className="truncate text-[10px] capitalize text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>

      {saveIndicator}

      {status === 'completed' && (
        <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700">
          <CheckCircle2 className="h-3 w-3" />
          Selesai
        </span>
      )}

      {status === 'verified' && (
        <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800">
          <CheckCircle2 className="h-3 w-3" />
          Terverifikasi
        </span>
      )}

      {status === 'rejected' && (
        <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-700">
          <AlertCircle className="h-3 w-3" />
          Ditolak
        </span>
      )}

      {status === 'discrepancy' && (
        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">
          <AlertCircle className="h-3 w-3" />
          Discrepancy
        </span>
      )}
    </div>
  );
}

export { SaveIndicator } from './SaveIndicator';

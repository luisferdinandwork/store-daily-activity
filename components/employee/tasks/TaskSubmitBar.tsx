'use client';
// components/employee/tasks/TaskSubmitBar.tsx

import { ReactNode } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TaskSubmitBarProps {
  label: string;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
  hint?: string;
  icon?: ReactNode | null;
  hidden?: boolean;
}

export default function TaskSubmitBar({
  label,
  onSubmit,
  submitting,
  disabled,
  hint,
  icon,
  hidden,
}: TaskSubmitBarProps) {
  if (hidden) return null;

  const renderedIcon =
    icon === null ? null : icon ?? <CheckCircle2 className="h-4 w-4" />;

  return (
    <div
      className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
    >
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || submitting}
          className={cn(
            'flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition-all',
            'active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Menyimpan…
            </>
          ) : (
            <>
              {renderedIcon}
              {label}
            </>
          )}
        </button>

        {hint && !submitting && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}

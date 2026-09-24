'use client';
// components/employee/tasks/TaskSubmitBar.tsx
//
// Sticky submit button above the bottom nav. Its offset follows --emp-bottom
// (nav height incl. its compact state + the iPhone home-indicator inset), so
// it always sits flush on the nav. Pages that render it should use
// <PageBody bottomBar> so their last field isn't hidden underneath.

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
      className="fixed inset-x-0 z-40 border-t border-border bg-background/95 px-4 pb-3 pt-3 backdrop-blur transition-[bottom] duration-300 ease-out"
      style={{ bottom: 'var(--emp-bottom)' }}
    >
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || submitting}
          className={cn(
            'flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-sm transition-all',
            'active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100',
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
          <p className="mt-2 line-clamp-2 text-center text-[11px] leading-snug text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}

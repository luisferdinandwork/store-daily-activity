'use client';
// components/employee/impact-visit-ui.tsx
//
// Small pieces shared by the employee Impact Visit Result list + detail pages
// (app/employee/impact-visits). Data shapes: lib/impact-visit/results.ts.

import { CheckCircle2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChecklistResultScore } from '@/lib/impact-visit/results';

/** Grade A = passed the checklist threshold, B = below it. */
function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return null;
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none',
        grade === 'A' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800',
      )}
    >
      Grade {grade}
    </span>
  );
}

/** "IMPACT VISIT · 85/100 · Grade B". */
export function ScoreTile({
  label, result, className,
}: {
  label: string;
  result: ChecklistResultScore;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl bg-secondary px-3 py-2', className)}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <p className="leading-none">
          <span className="text-lg font-bold tabular-nums text-foreground">{result.score}</span>
          <span className="text-xs font-medium text-muted-foreground">/{result.maxScore}</span>
        </p>
        <span className="ml-auto">
          <GradeBadge grade={result.grade} />
        </span>
      </div>
    </div>
  );
}

/** "7 poin perlu diperbaiki" (amber) or "Semua poin sudah sesuai" (green). */
export function FixCountBanner({ count, className }: { count: number; className?: string }) {
  const ok = count === 0;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold',
        ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800',
        className,
      )}
    >
      {ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <Wrench className="h-4 w-4 flex-shrink-0" />}
      <span className="min-w-0 flex-1">
        {ok ? 'Semua poin sudah sesuai — pertahankan!' : `${count} poin perlu diperbaiki`}
      </span>
    </div>
  );
}

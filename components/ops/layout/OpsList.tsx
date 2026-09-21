// components/ops/layout/OpsList.tsx
//
// The list view shared by the Ops pages that browse a set of stores / orders /
// visits / issues: one bordered container, one full-width clickable row per
// item, hairline dividers between rows. Replaces the old multi-column card
// grids so items scan top-to-bottom like a table but can still hold badges and
// wrap on narrow screens.
//
//   <OpsList>
//     {items.map((item) => (
//       <OpsListRow key={item.id} onClick={() => open(item)}>…cells…</OpsListRow>
//     ))}
//   </OpsList>
//
// Rows wrap onto a second line below `md` (give the primary cell `flex-1 basis-56
// min-w-0` so the secondary cells drop under it) and stay on one line from `md` up.

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

export function OpsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn('divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      {children}
    </ul>
  );
}

export function OpsListRow({
  onClick,
  children,
  className,
  showChevron = true,
  ariaLabel,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
  /** The trailing "opens detail" chevron. */
  showChevron?: boolean;
  ariaLabel?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          'group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 sm:px-5 md:flex-nowrap',
          className,
        )}
      >
        {children}
        {showChevron && (
          <ChevronRight className="order-last hidden h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500 md:block" />
        )}
      </button>
    </li>
  );
}

/** Placeholder rows while a list loads — same height/rhythm as a real row. */
export function OpsListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <OpsList>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="hidden h-3 w-32 animate-pulse rounded bg-slate-100 sm:block" />
        </li>
      ))}
    </OpsList>
  );
}

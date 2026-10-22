'use client';
// components/tasks/MetricTile.tsx
//
// A KPI tile for the task monitoring pages; clickable ones act as a filter
// (pressed while it narrows the list below). Plus AreaBreakdown: one bar per
// area, worst first.

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const TONE = {
  slate: 'text-slate-900',
  emerald: 'text-emerald-600',
  indigo: 'text-indigo-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
} as const;

export function MetricTile({
  label,
  value,
  hint,
  tone = 'slate',
  active,
  onClick,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof TONE;
  active?: boolean;
  onClick?: () => void;
  footer?: ReactNode;
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1.5 text-3xl font-semibold leading-none tracking-tight', TONE[tone])}>{value}</p>
      {hint && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{hint}</p>}
      {footer && <div className="mt-3">{footer}</div>}
    </>
  );
  const cls = cn(
    'rounded-2xl border bg-white p-4 text-left shadow-sm transition sm:p-5',
    active ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200',
    onClick && 'hover:border-slate-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={!!active} className={cls}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function RateBar({ rate, className }: { rate: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-400' : 'bg-rose-500')}
        style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
      />
    </div>
  );
}

export function AreaBreakdown({
  items,
  unit,
  active,
  onPick,
}: {
  items: { name: string; done: number; total: number }[];
  /** "toko" / "task" — what done/total counts. */
  unit: string;
  active?: string;
  onPick?: (name: string) => void;
}) {
  const rows = items
    .filter((i) => i.total > 0)
    .map((i) => ({ ...i, rate: Math.round((i.done / i.total) * 100) }))
    .sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Per area</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Belum ada data.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((r) => (
            <li key={r.name}>
              <button
                type="button"
                disabled={!onPick}
                onClick={() => onPick?.(r.name)}
                className={cn('w-full rounded-lg text-left transition enabled:hover:bg-slate-50', active === r.name && 'bg-indigo-50')}
              >
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-semibold text-slate-700">{r.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    <span className="font-semibold text-slate-900">{r.rate}%</span> · {r.done}/{r.total} {unit}
                  </span>
                </span>
                <RateBar rate={r.rate} className="mt-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';
// components/ops/mobile/MobileKit.tsx
//
// Building blocks of the Ops phone pages (Dashboard, Issues, Petty Cash — see
// lib/ops-mobile.ts): a sticky page header, a swipeable chip row, section
// titles, empty state, a progress ring and a month stepper. Same slate/indigo
// look as the desktop panel, sized for thumbs (44px targets).

import type { ElementType, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Page header ─────────────────────────────────────────────────────────────

/** Sticky title bar of a phone page; `children` (tabs, search, chips) sit under the title. */
export function MobilePageHeader({
  eyebrow,
  title,
  subtitle,
  onRefresh,
  refreshing,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-slate-50/95 px-4 pb-3 pt-3 backdrop-blur">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="truncate text-[10px] font-bold uppercase tracking-widest text-indigo-500">{eyebrow}</p>
          )}
          <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight text-slate-900">{title}</h1>
          {subtitle && <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>}
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition active:scale-95 disabled:opacity-60"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
        )}
      </div>
      {children && <div className="mt-3 space-y-2.5">{children}</div>}
    </div>
  );
}

// ─── Chip row ────────────────────────────────────────────────────────────────

export type ChipTone = 'slate' | 'amber' | 'indigo' | 'sky' | 'violet' | 'emerald' | 'rose';

const CHIP_DOT: Record<ChipTone, string> = {
  slate: 'bg-slate-400',
  amber: 'bg-amber-500',
  indigo: 'bg-indigo-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
};

/** One-line, side-scrolling filter chips with counts. */
export function ChipScroller<K extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: K; label: string; count?: number; tone?: ChipTone }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-pressed={on}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors active:scale-[0.97]',
              on
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600',
            )}
          >
            {it.tone && <span className={cn('h-1.5 w-1.5 rounded-full', CHIP_DOT[it.tone])} />}
            {it.label}
            {it.count != null && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                  on ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                )}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Section title / empty ───────────────────────────────────────────────────

export function MobileSectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 px-1">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{children}</h2>
      {action}
    </div>
  );
}

export function MobileEmpty({
  icon: Icon,
  title,
  hint,
  action,
  tone = 'slate',
}: {
  icon: ElementType;
  title: string;
  hint?: string;
  action?: ReactNode;
  tone?: 'slate' | 'emerald';
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      <span
        className={cn(
          'mb-3 flex h-12 w-12 items-center justify-center rounded-2xl',
          tone === 'emerald' ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-50 text-slate-300',
        )}
      >
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Progress ring ───────────────────────────────────────────────────────────

/** Donut gauge, 0–100. `color` is any CSS colour. */
export function Ring({
  pct,
  color,
  size = 76,
  stroke = 8,
  children,
}: {
  pct: number;
  color: string;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// ─── Month stepper ───────────────────────────────────────────────────────────

/** ‹ Oktober 2026 › over a YYYY-MM-01 key, with a "this month" reset. */
export function MonthStepper({
  date,
  onChange,
  currentMonthStart,
}: {
  /** YYYY-MM-01 */
  date: string;
  onChange: (date: string) => void;
  currentMonthStart: string;
}) {
  const [y, m] = date.split('-').map(Number);
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onChange(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  };
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const isCurrent = date === currentMonthStart;

  return (
    <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => shift(-1)}
        aria-label="Bulan sebelumnya"
        className="flex h-full w-10 items-center justify-center rounded-l-xl text-slate-500 active:bg-slate-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="flex-1 text-center text-sm font-bold capitalize text-slate-800">{label}</span>
      {!isCurrent && (
        <button
          type="button"
          onClick={() => onChange(currentMonthStart)}
          className="mr-1 rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600"
        >
          Bulan ini
        </button>
      )}
      <button
        type="button"
        onClick={() => shift(1)}
        aria-label="Bulan berikutnya"
        className="flex h-full w-10 items-center justify-center rounded-r-xl text-slate-500 active:bg-slate-50"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

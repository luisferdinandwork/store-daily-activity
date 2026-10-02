'use client';
// components/ops/performance/atoms.tsx
//
// Small visual building blocks shared by the Performance Targets list and
// detail views: progress ring, target bar, setup chip, "actual / target" pair. Colour comes from one tone vocabulary so a store reads
// the same everywhere (list row, summary tile, detail hero):
//
//   emerald on track / achieved · amber watch / needs setup · rose behind
//   indigo  upcoming            · slate no data / inactive

import type { ReactNode } from 'react';
import { CloudOff, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { StoreStatus } from '@/lib/store-status';
import { HEALTH_META, type StoreHealth, type Tone } from '@/lib/performance/target-view';

export const TONE: Record<Tone, { hex: string; bar: string; text: string; chip: string; soft: string }> = {
  emerald: {
    hex: '#10b981',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    soft: 'bg-emerald-50 text-emerald-600',
  },
  amber: {
    hex: '#f59e0b',
    bar: 'bg-amber-400',
    text: 'text-amber-600',
    chip: 'bg-amber-50 text-amber-700 ring-amber-200',
    soft: 'bg-amber-50 text-amber-600',
  },
  rose: {
    hex: '#f43f5e',
    bar: 'bg-rose-500',
    text: 'text-rose-600',
    chip: 'bg-rose-50 text-rose-700 ring-rose-200',
    soft: 'bg-rose-50 text-rose-600',
  },
  indigo: {
    hex: '#6366f1',
    bar: 'bg-indigo-500',
    text: 'text-indigo-600',
    chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    soft: 'bg-indigo-50 text-indigo-600',
  },
  slate: {
    hex: '#cbd5e1',
    bar: 'bg-slate-300',
    text: 'text-slate-400',
    chip: 'bg-slate-100 text-slate-500 ring-slate-200',
    soft: 'bg-slate-100 text-slate-500',
  },
};

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[10px] font-bold uppercase tracking-widest text-slate-400', className)}>{children}</p>
  );
}

// ─── Ring ─────────────────────────────────────────────────────────────────────

/**
 * Circular progress. The arc is capped at 100% but `children` (usually the
 * percentage) can show more. `dashed` draws an empty placeholder ring for
 * "nothing to measure yet".
 */
export function ProgressRing({
  pct,
  tone,
  size = 44,
  stroke = 4,
  dashed = false,
  children,
}: {
  pct: number;
  tone: Tone;
  size?: number;
  stroke?: number;
  dashed?: boolean;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = (Math.min(100, Math.max(0, pct)) / 100) * c;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
          strokeDasharray={dashed ? '3 4' : undefined}
        />
        {!dashed && arc > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={TONE[tone].hex}
            strokeWidth={stroke}
            strokeDasharray={`${arc} ${c}`}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

// ─── Bar ──────────────────────────────────────────────────────────────────────

/** Achievement bar — the fill is the % of target reached (capped at 100). */
export function TargetBar({
  pct,
  tone,
  thin = false,
  className,
}: {
  pct: number;
  tone: Tone;
  thin?: boolean;
  className?: string;
}) {
  const width = Math.min(100, Math.max(0, pct));

  return (
    <div className={cn('overflow-hidden rounded-full bg-slate-100', thin ? 'h-1' : 'h-1.5', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', TONE[tone].bar)} style={{ width: `${width}%` }} />
    </div>
  );
}

// ─── Actual / target ──────────────────────────────────────────────────────────

/** "186jt  / 300jt" — the actual is the bold number, the target is the caption. */
export function ActualOfTarget({
  actual,
  target,
  format,
  dim = false,
}: {
  actual: number | null;
  target: number;
  format: (n: number) => string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={cn('truncate text-sm font-black tabular-nums', dim ? 'text-slate-300' : 'text-slate-900')}>
        {actual === null ? '—' : format(actual)}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">/ {target > 0 ? format(target) : '—'}</span>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────

const CHIP_BASE =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset';

/** A store that can't be scored yet: no target set, or no Business Central data. */
export function SetupChip({ health }: { health: Extract<StoreHealth, 'no_target' | 'no_data'> }) {
  const meta = HEALTH_META[health];
  const Icon = health === 'no_target' ? Plus : CloudOff;

  return (
    <span className={cn(CHIP_BASE, TONE[meta.tone].chip)}>
      <Icon className="h-3 w-3" strokeWidth={3} />
      {meta.label}
    </span>
  );
}

/** Lifecycle badge — nothing for an ordinary active store. */
export function LifecycleBadge({ status }: { status: StoreStatus }) {
  if (status === 'active') return null;
  const ready = status === 'ready_to_open';
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset',
        ready ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-slate-100 text-slate-500 ring-slate-200',
      )}
    >
      {ready ? 'Siap buka' : 'Tutup'}
    </span>
  );
}

/** Store code pill — monospace so FF001 / FS011 line up down a list. */
export function CodeChip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">
      {children}
    </span>
  );
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black',
        className,
      )}
      aria-hidden="true"
    >
      {letters || '?'}
    </span>
  );
}

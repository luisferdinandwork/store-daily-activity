import type { ReactNode } from 'react';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { cn } from '@/lib/utils';
import type { VisitStore } from '@/lib/store-visit/types';

const TONES = {
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  amber: 'bg-amber-50 text-amber-800 ring-amber-100',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
} as const;
export type Tone = keyof typeof TONES;

export function StatTile({ label, value, tone = 'slate', hint }: { label: string; value: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums sm:text-3xl', tone === 'amber' ? 'text-amber-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'indigo' ? 'text-indigo-600' : tone === 'rose' ? 'text-rose-600' : 'text-slate-900')}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Pill({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset', TONES[tone], className)}>{children}</span>;
}

export function ProgressBar({ value, max, tone = 'indigo', className }: { value: number; max: number; tone?: 'indigo' | 'amber' | 'emerald'; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = tone === 'amber' ? 'bg-amber-400' : tone === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-500';
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn('h-2 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all', fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** "Hari ini" / "Kemarin" / "5 hari lalu" for a Jakarta day key. */
export function daysAgoLabel(dateKey: string | null): string {
  if (!dateKey) return 'Belum ada visit';
  const parse = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  const diff = Math.round((parse(jakartaTodayKey()) - parse(dateKey)) / 86_400_000);
  if (diff <= 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  return `${diff} hari lalu`;
}

export function shortDate(dateKey: string | null): string {
  if (!dateKey) return '-';
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export type VisitState = 'due' | 'done' | 'unset';
export function visitState(store: VisitStore): VisitState {
  if (!store.policy) return 'unset';
  return store.progress.remaining > 0 ? 'due' : 'done';
}

export function VisitStatusPill({ store }: { store: VisitStore }) {
  const state = visitState(store);
  if (state === 'unset') return <Pill tone="slate">Belum diatur</Pill>;
  if (state === 'due') return <Pill tone="amber">Kurang {store.progress.remaining} visit</Pill>;
  return <Pill tone="emerald">Terpenuhi</Pill>;
}

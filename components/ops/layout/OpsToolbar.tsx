'use client';
// components/ops/layout/OpsToolbar.tsx
//
// Controls for the search / filter / sort bar above an Ops list — the same
// look as the Stores page toolbar, as small reusable parts:
//
//   <div className="flex flex-wrap items-center gap-2">
//     <OpsSearchInput value={q} onChange={setQ} placeholder="Cari…" />
//     <OpsFilterSelect label="Area" value={area} onChange={setArea}>…<option/></OpsFilterSelect>
//     <OpsSortControl options={…} sortKey={k} sortDir={d} onChange={…} />
//   </div>
//   <OpsChipTabs items={[{ key, label, count, tone }]} value={f} onChange={setF} />

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export function OpsSearchInput({
  value,
  onChange,
  placeholder = 'Cari…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-[200px] flex-1', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Hapus pencarian"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-300 hover:text-slate-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function OpsFilterSelect({
  label,
  value,
  onChange,
  highlight = value !== 'all',
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Tint the control while it narrows the list (default: value !== 'all'). */
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-10 max-w-[220px] appearance-none truncate rounded-xl border pl-3 pr-8 text-sm font-semibold focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100',
          highlight ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700',
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

/** "Sort: <key>" select + an asc/desc toggle. */
export function OpsSortControl<K extends string>({
  options,
  sortKey,
  sortDir,
  onChange,
}: {
  options: { key: K; label: string }[];
  sortKey: K;
  sortDir: 'asc' | 'desc';
  /** Called with the new key and/or direction (the other is passed through). */
  onChange: (next: { key: K; dir: 'asc' | 'desc'; keyChanged: boolean }) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <OpsFilterSelect
        label="Urutkan"
        value={sortKey}
        onChange={(v) => onChange({ key: v as K, dir: sortDir, keyChanged: true })}
        highlight={false}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>Urut: {o.label}</option>
        ))}
      </OpsFilterSelect>
      <button
        type="button"
        onClick={() => onChange({ key: sortKey, dir: sortDir === 'asc' ? 'desc' : 'asc', keyChanged: false })}
        aria-label={sortDir === 'asc' ? 'Naik — ubah ke turun' : 'Turun — ubah ke naik'}
        title={sortDir === 'asc' ? 'Naik (A→Z, kecil→besar)' : 'Turun (Z→A, besar→kecil)'}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
      >
        {sortDir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </button>
    </div>
  );
}

const DOT: Record<string, string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-400',
  rose: 'bg-rose-500',
  indigo: 'bg-indigo-500',
  slate: 'bg-slate-300',
};

export type OpsChipItem<T extends string> = {
  key: T;
  label: string;
  count: number;
  /** Colour dot before the label. */
  tone?: keyof typeof DOT | null;
};

/** A row of count-badged filter pills — one active at a time. */
export function OpsChipTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: OpsChipItem<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition',
              active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50',
            )}
          >
            {item.tone && <span className={cn('h-2 w-2 rounded-full', active ? 'bg-white/80' : DOT[item.tone])} />}
            {item.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-[10px] font-black tabular-nums',
                active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
              )}
            >
              {item.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

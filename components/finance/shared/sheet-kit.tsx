'use client';
// components/finance/shared/sheet-kit.tsx
//
// Building blocks shared by Finance's spreadsheet-style pages (Setoran, Uang
// Modal, Store Closing): section tabs, day / period calendar pickers, key-number
// strip, view toggle, store-code chips, photo lightbox and the Excel download
// helper. The sheet look itself (SHEET_TH / SHEET_TD, month navigator, Rp
// formatting) comes from the Petty Cash pages so they all stay identical.

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CodeGroup } from '@/lib/finance/code-groups';

// ─── Section tabs ────────────────────────────────────────────────────────────

export interface SectionTab {
  href: string;
  label: string;
  /** Match the pathname exactly (the section's first tab), not as a prefix. */
  exact?: boolean;
}

export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
              active
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ─── Day / period pickers ────────────────────────────────────────────────────
// Calendar popovers live in ./date-pickers; re-exported so pages keep one import.

export { DayNavigator, RangePicker, thisMonthRange, type DateRangeValue } from './date-pickers';

// ─── Key numbers strip ───────────────────────────────────────────────────────

export interface KpiItem {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}

/** Plain strip of numbers (not cards) — 1px gaps draw the dividers. */
export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-300 bg-slate-300 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ label, value, sub, warn }) => (
        <div key={label} className="bg-white px-4 py-3">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className={cn('mt-0.5 text-lg font-bold tabular-nums', warn ? 'text-amber-600' : 'text-slate-900')}>
            {value}
          </dd>
          {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
        </div>
      ))}
    </dl>
  );
}

// ─── Toolbar bits ────────────────────────────────────────────────────────────

export function ViewToggle({
  value,
  onChange,
}: {
  value: 'all' | 'code';
  onChange: (v: 'all' | 'code') => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs font-semibold">
      {([
        ['all', 'All Stores'],
        ['code', 'By Store Code'],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            'rounded px-3 py-1.5 transition-colors',
            value === key ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function CodeChips<T>({
  groups,
  total,
  active,
  onPick,
}: {
  groups: CodeGroup<T>[];
  total: number;
  active: string | null;
  onPick: (code: string | null) => void;
}) {
  const chip = (on: boolean) =>
    cn(
      'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
      on
        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by store code">
      <button type="button" onClick={() => onPick(null)} className={chip(active === null)}>
        All <span className="ml-0.5 font-normal text-slate-400">{total}</span>
      </button>
      {groups.map((g) => (
        <button
          key={g.code}
          type="button"
          onClick={() => onPick(active === g.code ? null : g.code)}
          title={g.brand ?? undefined}
          className={chip(active === g.code)}
        >
          {g.display} <span className="ml-0.5 font-normal text-slate-400">{g.rows.length}</span>
        </button>
      ))}
    </div>
  );
}

export function GroupHeaderRow<T>({ colSpan, group }: { colSpan: number; group: CodeGroup<T> }) {
  return (
    <tr className="bg-emerald-600 text-white">
      <td colSpan={colSpan} className="border-b border-emerald-700 px-3 py-1.5 text-[13px] font-semibold">
        {group.display}
        {group.brand && group.brand !== group.display && (
          <span className="ml-2 font-normal text-emerald-100">{group.brand}</span>
        )}
        <span className="ml-3 text-xs font-normal text-emerald-100">
          {group.rows.length} store{group.rows.length === 1 ? '' : 's'}
        </span>
      </td>
    </tr>
  );
}

// ─── Photo lightbox ──────────────────────────────────────────────────────────

export interface LightboxPhoto {
  url: string;
  label: string;
}

/** Full-screen viewer; ← / → step through the store's photos, Esc closes. */
export function PhotoLightbox({
  title,
  photos,
  index,
  onIndex,
  onClose,
}: {
  title: string;
  photos: LightboxPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const count = photos.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && count > 1) onIndex((index - 1 + count) % count);
      else if (e.key === 'ArrowRight' && count > 1) onIndex((index + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onIndex, onClose]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — ${photo.label}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Tutup"
      >
        <X className="h-5 w-5" />
      </button>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + count) % count); }}
            className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Foto sebelumnya"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % count); }}
            className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Foto berikutnya"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
          {title} · {photo.label}
          {count > 1 && <span className="ml-2 font-normal text-white/70">{index + 1} / {count}</span>}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={photo.label}
          className="max-h-[82vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}

// ─── Excel download ──────────────────────────────────────────────────────────

/** Fetches an .xlsx export endpoint and saves it; throws with the API's message on failure. */
export async function downloadXlsx(url: string, fallbackName: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const filename = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

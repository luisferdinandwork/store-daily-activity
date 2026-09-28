'use client';
// components/finance/petty-cash/shared.tsx
//
// Pieces shared by Finance's Petty Cash Monitoring and Report pages: the
// page tabs, month navigator, Rupiah formatting and a copy-to-clipboard
// button for account numbers.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reportMonthLabel } from '@/lib/petty-cash-report';

// ─── Formatting / month helpers ──────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** 1234567 → "1.234.567" (no currency symbol — the column header says Rp). */
export const num = (v: string | number) => IDR.format(Number(v));

/** 1234567 → "Rp 1.234.567". */
export const rp = (v: string | number) => `Rp ${IDR.format(Number(v))}`;

/** Today's YYYY-MM in Jakarta — matches the API default, whatever the browser's zone. */
export function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Spreadsheet cell styles ─────────────────────────────────────────────────
// Both pages are drawn as a sheet: grey header + row-number gutter, thin grid.
// Cells only carry a right + bottom border (the scroll container draws the
// outer edge), so a border-separate table — needed for the sticky header —
// shows 1px lines instead of doubled ones.

export const SHEET_TH =
  'sticky top-0 z-10 border-b border-r border-slate-300 bg-slate-100 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600';
export const SHEET_TD = 'border-b border-r border-slate-200 px-2.5 py-1.5';
export const SHEET_ROW_HEAD =
  'border-b border-r border-slate-300 bg-slate-100 px-1 text-center text-[11px] font-medium tabular-nums text-slate-500';

// ─── Page tabs ───────────────────────────────────────────────────────────────

const TABS = [
  { href: '/finance/petty-cash', label: 'Monitoring', exact: true },
  { href: '/finance/petty-cash/report', label: 'Report', exact: false },
];

export function PettyCashTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1" aria-label="Petty cash sections">
      {TABS.map((tab) => {
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

// ─── Month navigator ─────────────────────────────────────────────────────────

export function MonthNavigator({ month, onChange }: { month: string; onChange: (ym: string) => void }) {
  const isCurrent = month === currentMonth();

  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white text-sm">
        <button
          type="button"
          onClick={() => onChange(shiftMonth(month, -1))}
          aria-label="Previous month"
          className="flex h-full w-8 items-center justify-center rounded-l-md text-slate-500 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-32 border-x border-slate-300 px-3 text-center text-xs font-semibold text-slate-700">
          {reportMonthLabel(month)}
        </span>
        <button
          type="button"
          onClick={() => onChange(shiftMonth(month, 1))}
          aria-label="Next month"
          className="flex h-full w-8 items-center justify-center rounded-r-md text-slate-500 hover:bg-slate-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {!isCurrent && (
        <button
          type="button"
          onClick={() => onChange(currentMonth())}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          This month
        </button>
      )}
    </div>
  );
}

// ─── Copy button ─────────────────────────────────────────────────────────────

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin / permissions) — nothing useful to do.
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void copy(); }}
      title={copied ? 'Copied' : label}
      aria-label={label}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors',
        copied ? 'text-emerald-600' : 'hover:bg-slate-100 hover:text-slate-700',
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

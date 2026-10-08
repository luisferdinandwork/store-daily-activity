'use client';
// components/ops/petty-cash/shared.tsx
//
// Pieces both Ops Petty Cash pages (Requests + Refills) are drawn with: the
// page tabs (with "waiting for Ops" counts), status chips, a sortable header
// cell, the pager, the approve / reject buttons, loading + empty states and a
// small fetch hook. The sheet look (grey header, row-number gutter, thin grid)
// is Finance's, so a figure reads the same in either panel.

import { useCallback, useEffect, useState, type ElementType, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Loader2,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  REFILL_STATE_LABEL,
  TX_STATUS_LABEL,
  isRefillState,
  type PettyCashPending,
  type RefillState,
  type SortDir,
  type TxStatus,
} from '@/lib/ops-petty-cash';
import { isTxStatus } from '@/lib/petty-cash-transactions';
import { SHEET_ROW_HEAD, SHEET_TD } from '@/components/finance/petty-cash/shared';

export { num, rp } from '@/components/finance/petty-cash/shared';

// ─── Sheet cells ─────────────────────────────────────────────────────────────
// Finance's cells, minus the sticky header (the Ops page scrolls as a whole, so a
// sticky header would slide under the page header) and the doubled outer edge.

export const TH =
  'border-b border-r border-slate-300 bg-slate-100 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 last:border-r-0';
export const TD = `${SHEET_TD} last:border-r-0`;
export const ROW_HEAD = SHEET_ROW_HEAD;

/** Wraps a sheet table: rounded border, horizontal scroll, no doubled bottom edge. */
export function SheetFrame({ children, dimmed }: { children: ReactNode; dimmed?: boolean }) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-md border border-slate-300 bg-white transition-opacity [&_tbody>tr:last-child>td]:border-b-0',
        dimmed && 'opacity-60',
      )}
    >
      {children}
    </div>
  );
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const jakartaYear = (d: Date) =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' }).format(d));

// The year is only worth the width when it isn't this year.
const yearIfNotThisYear = (d: Date): { year?: 'numeric' } =>
  jakartaYear(d) === jakartaYear(new Date()) ? {} : { year: 'numeric' };

/** "08 Okt, 14.30" in Jakarta time (with the year when it isn't this year). */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    ...yearIfNotThisYear(d),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "08 Okt" in Jakarta time (with the year when it isn't this year). */
export function fmtDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    ...yearIfNotThisYear(d),
  });
}

// ─── Two-line identity cells ─────────────────────────────────────────────────
// Store + area and date + PIC each share a cell: the table stays narrow enough to
// show without sideways scrolling on a laptop, and the second line is quiet.

/** Store name, with its code (and, for HO, its area) underneath. */
export function StoreCell({ name, code, area }: { name: string; code: string; area?: string }) {
  return (
    <>
      <p className="font-medium leading-snug text-slate-900">{name}</p>
      <p className="font-mono text-[11px] leading-snug text-slate-400">
        {code}
        {area ? <span className="font-sans"> · {area}</span> : null}
      </p>
    </>
  );
}

/** When it was filed, with the PIC who filed it underneath. */
export function WhenCell({ iso, who }: { iso: string; who: string }) {
  return (
    <>
      <p className="whitespace-nowrap leading-snug text-slate-700">{fmtWhen(iso)}</p>
      <p className="max-w-36 truncate text-[11px] leading-snug text-slate-400" title={who}>
        {who}
      </p>
    </>
  );
}

// ─── Data hooks ──────────────────────────────────────────────────────────────

/**
 * GETs `url` and keeps the last good response on screen (dimmed) while the next
 * one loads — so changing month never flashes the table empty. `loading` is
 * simply "the current request hasn't finished".
 */
export function useJsonFeed<T>(url: string) {
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const key = `${url}#${reloadKey}`;

  useEffect(() => {
    let stale = false;

    fetch(url, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          setData(body as T);
          setSettled({ key, error: null });
        } else {
          setSettled({ key, error: body.error ?? 'Failed to load.' });
        }
      })
      .catch(() => {
        if (!stale) setSettled({ key, error: 'Network error.' });
      });

    return () => {
      stale = true;
    };
  }, [url, key]);

  const loading = settled?.key !== key;
  const error = settled && settled.key === key ? settled.error : null;
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { data, loading, error, reload };
}

/** What is waiting on Ops across both pages (any month) — the tab badges. */
export function usePettyCashPending() {
  const [pending, setPending] = useState<PettyCashPending | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/ops/petty-cash/summary', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (body.success) setPending(body.pending);
      })
      .catch(() => {
        // Non-critical — the badges just stay as they were.
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pending, refresh };
}

// ─── Page tabs ───────────────────────────────────────────────────────────────

const TABS = [
  { href: '/ops/petty-cash/requests', label: 'Requests', key: 'requests' },
  { href: '/ops/petty-cash/refills', label: 'Refills', key: 'refills' },
] as const;

export function PettyCashTabs({ pending }: { pending: PettyCashPending | null }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1" aria-label="Petty cash sections">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const waiting = pending?.[tab.key] ?? 0;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
              active
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {tab.label}
            {waiting > 0 && (
              <span
                title={`${waiting} waiting for OPS`}
                className="rounded-full bg-amber-100 px-1.5 text-[10px] font-black tabular-nums text-amber-800 ring-1 ring-inset ring-amber-300"
              >
                {waiting}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ─── Chips ───────────────────────────────────────────────────────────────────

const CHIP =
  'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

const TX_CHIP: Record<TxStatus, string> = {
  pending_ops: 'bg-amber-50 text-amber-700 ring-amber-200',
  ops_approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ops_rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const REFILL_CHIP: Record<RefillState, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  awaiting_finance: 'bg-slate-100 text-slate-600 ring-slate-200',
  verified: 'bg-sky-50 text-sky-700 ring-sky-200',
  received: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export function TxStatusChip({ status }: { status: string }) {
  const known = isTxStatus(status);
  return (
    <span className={cn(CHIP, known ? TX_CHIP[status] : 'bg-slate-100 text-slate-600 ring-slate-200')}>
      {known ? TX_STATUS_LABEL[status] : status}
    </span>
  );
}

export function RefillStateChip({ state }: { state: RefillState | string }) {
  const known = isRefillState(state);
  return (
    <span className={cn(CHIP, known ? REFILL_CHIP[state] : 'bg-slate-100 text-slate-600 ring-slate-200')}>
      {known ? REFILL_STATE_LABEL[state] : state}
    </span>
  );
}

// ─── Receipt thumbnail ───────────────────────────────────────────────────────

/** Receipt photo; degrades to an icon when the stored URL no longer loads. */
export function ReceiptThumb({ url, onOpen, size = 'md' }: { url: string | null; onOpen: () => void; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = useState(false);
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';

  if (!url) {
    return (
      <span title="No photo" className={cn('flex items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50', box)}>
        <ImageOff className="h-3 w-3 text-slate-300" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title="View receipt"
      className={cn(
        'flex items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-100 transition hover:border-indigo-500',
        box,
      )}
    >
      {failed ? (
        <ImageOff className="h-3 w-3 text-slate-400" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Receipt" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </button>
  );
}

// ─── Sortable header ─────────────────────────────────────────────────────────

export function SortTh<K extends string>({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = 'left',
  className,
}: {
  label: string;
  sortKey: K;
  active: K;
  dir: SortDir;
  onSort: (key: K) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const on = active === sortKey;

  return (
    <th
      className={cn(TH, align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)}
      aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900', on && 'text-slate-900')}
      >
        {label}
        {on && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

// ─── Approve / reject ────────────────────────────────────────────────────────

/**
 * Approve, or Reject with an optional reason. The reason is asked in a popover
 * so the row never changes width; Reject is an icon so the action column stays
 * narrow — the popover's own button says what it does.
 */
export function DecisionButtons({
  busy,
  onApprove,
  onReject,
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  function confirmReject() {
    onReject(reason.trim());
    setOpen(false);
    setReason('');
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            title="Reject…"
            aria-label="Reject"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <label className="block text-[11px] font-semibold text-slate-600" htmlFor="reject-reason">
            Reason <span className="font-normal text-slate-400">(optional — the PIC will see it)</span>
          </label>
          <textarea
            id="reject-reason"
            autoFocus
            rows={2}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                confirmReject();
              }
            }}
            className="mt-1.5 w-full resize-none rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-800 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReject}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-rose-600 px-2.5 text-[11px] font-semibold text-white hover:bg-rose-700"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        Approve
      </button>
    </span>
  );
}

// ─── Pager ───────────────────────────────────────────────────────────────────

export function Pager({
  page,
  pages,
  from,
  to,
  total,
  noun,
  onPage,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
      <p>
        Showing{' '}
        <span className="font-semibold tabular-nums">
          {from}–{to}
        </span>{' '}
        of <span className="font-semibold tabular-nums">{total}</span> {noun}
        {total === 1 ? '' : 's'}
      </p>

      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-20 text-center font-semibold tabular-nums">
            {page} / {pages}
          </span>
          <button
            type="button"
            onClick={() => onPage(Math.min(pages, page + 1))}
            disabled={page >= pages}
            aria-label="Next page"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Loading / empty / error ─────────────────────────────────────────────────

export function SheetSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
      <div className="h-9 animate-pulse bg-slate-100" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
      ))}
    </div>
  );
}

export function SheetEmpty({
  icon: Icon,
  title,
  hint,
  onClear,
}: {
  icon: ElementType;
  title: string;
  hint?: string;
  /** Shown as a "Clear filters" button when filters are what emptied the list. */
  onClear?: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <Icon className="mx-auto mb-3 h-9 w-9 text-slate-300" />
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

'use client';
// components/ops/mobile/PettyCashMobile.tsx
//
// Ops Petty Cash on a phone (below `md`). The Requests and Refills pages keep
// all their state (month, search, filters, sort, paging, approve / reject) and
// draw it here as cards instead of the desktop sheet:
//
//   PettyCashMobileHeader  title + Requests / Refills tabs with "waiting" badges
//   MobileKpiScroller      the key numbers, side-scrolling
//   MobileSearch / MobileSelect   16px controls (smaller text makes iOS zoom in on focus)
//   RequestCard / RefillCard      one request each, approve / reject right on the card
//
// Words and colours come from the same maps as the desktop sheet.

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ImageOff, Loader2, Receipt, Search, X, XCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { KpiItem } from '@/components/finance/shared/sheet-kit';
import { RefillStateChip, TxStatusChip, fmtDay, fmtWhen, num, rp } from '@/components/ops/petty-cash/shared';
import type { OpsRefillRow, OpsRequestRow, PettyCashPending } from '@/lib/ops-petty-cash';
import { MobilePageHeader } from './MobileKit';

// ─── Header ──────────────────────────────────────────────────────────────────

const TABS = [
  { href: '/ops/petty-cash/requests', label: 'Requests', key: 'requests' },
  { href: '/ops/petty-cash/refills', label: 'Refills', key: 'refills' },
] as const;

/** Sticky: title + Requests / Refills tabs. The month stepper scrolls with the list (keeps this short). */
export function PettyCashMobileHeader({
  isHo,
  pending,
  onRefresh,
  refreshing,
}: {
  isHo: boolean;
  pending: PettyCashPending | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const pathname = usePathname();

  return (
    <MobilePageHeader
      eyebrow={isHo ? 'OPS HO · All areas' : 'OPS · Area Approval'}
      title="Petty Cash"
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      {/* Requests / Refills */}
      <nav className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1" aria-label="Petty cash sections">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          const waiting = pending?.[tab.key] ?? 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-bold transition-colors',
                active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              {tab.label}
              {waiting > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-black tabular-nums text-white">
                  {waiting}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </MobilePageHeader>
  );
}

// ─── Key numbers ─────────────────────────────────────────────────────────────

export function MobileKpiScroller({ items }: { items: KpiItem[] }) {
  return (
    <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map(({ label, value, sub, warn }) => (
        <div
          key={label}
          className={cn(
            'w-[42%] shrink-0 snap-start rounded-2xl border p-3 shadow-sm',
            warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white',
          )}
        >
          <p className={cn('truncate text-[10px] font-bold uppercase tracking-wide', warn ? 'text-amber-700' : 'text-slate-400')}>
            {label}
          </p>
          <p className={cn('mt-1 truncate text-lg font-bold tabular-nums', warn ? 'text-amber-700' : 'text-slate-900')}>{value}</p>
          {sub && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Controls ────────────────────────────────────────────────────────────────

export function MobileSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-base text-slate-800 shadow-sm placeholder:text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Hapus pencarian"
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * A compact pill that opens the phone's own picker. The native <select> lies
 * invisibly on top at 16px — smaller text makes iOS zoom the page on focus —
 * while the pill shows the chosen option at chip size.
 */
export function MobileSelect({
  label,
  value,
  onChange,
  options,
  active,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** Tint while it narrows the list. */
  active?: boolean;
}) {
  const shown = options.find((o) => o.value === value)?.label ?? label;
  return (
    <div
      className={cn(
        'relative flex h-9 max-w-[12rem] shrink-0 items-center gap-1 rounded-full border pl-3 pr-2 text-xs font-semibold',
        active ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700',
      )}
    >
      <span className="truncate">{shown}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        style={{ fontSize: 16 }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Urut: …" picker + an up / down toggle, as pills. */
export function MobileSort<K extends string>({
  options,
  sortKey,
  sortDir,
  onChange,
}: {
  options: { key: K; label: string }[];
  sortKey: K;
  sortDir: 'asc' | 'desc';
  onChange: (next: { key: K; dir: 'asc' | 'desc'; keyChanged: boolean }) => void;
}) {
  return (
    <>
      <MobileSelect
        label="Urutkan"
        value={sortKey}
        onChange={(v) => onChange({ key: v as K, dir: sortDir, keyChanged: true })}
        options={options.map((o) => ({ value: o.key, label: `Urut: ${o.label}` }))}
      />
      <button
        type="button"
        onClick={() => onChange({ key: sortKey, dir: sortDir === 'asc' ? 'desc' : 'asc', keyChanged: false })}
        aria-label={sortDir === 'asc' ? 'Naik — ubah ke turun' : 'Turun — ubah ke naik'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 active:bg-slate-50"
      >
        {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
      </button>
    </>
  );
}

export function MobileFilterRow({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

// ─── Approve / reject on a card ──────────────────────────────────────────────

/** Approve, or Reject with an optional reason typed right on the card. */
function CardDecision({
  busy,
  approveLabel = 'Approve',
  onApprove,
  onReject,
}: {
  busy: boolean;
  approveLabel?: string;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = useId();

  if (rejecting) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
        <label className="block text-xs font-semibold text-rose-800" htmlFor={reasonId}>
          Reason <span className="font-normal text-rose-700/70">(optional — the PIC will see it)</span>
        </label>
        <textarea
          id={reasonId}
          autoFocus
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1.5 w-full resize-none rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-base text-slate-800 focus:border-rose-400 focus:outline-none"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setRejecting(false);
              setReason('');
            }}
            className="h-11 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 active:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onReject(reason.trim());
              setRejecting(false);
              setReason('');
            }}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-rose-600 text-sm font-bold text-white active:bg-rose-700 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" />
            Reject
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => setRejecting(true)}
        className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-600 active:bg-rose-50 disabled:opacity-60"
      >
        <XCircle className="h-4 w-4" />
        Reject
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onApprove}
        className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm shadow-emerald-600/20 active:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {approveLabel}
      </button>
    </div>
  );
}

// ─── Receipt ─────────────────────────────────────────────────────────────────

function ReceiptButton({ url, onOpen, size = 'md' }: { url: string | null; onOpen: () => void; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = useState(false);
  const box = size === 'sm' ? 'h-10 w-10' : 'h-14 w-14';

  if (!url) {
    return (
      <span className={cn('flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-300', box)}>
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="View receipt"
      className={cn('relative shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 active:opacity-80', box)}
    >
      {failed ? (
        <ImageOff className="m-auto h-4 w-4 text-slate-400" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Receipt" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
      {size === 'md' && (
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/45 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
          <Receipt className="h-2.5 w-2.5" /> Nota
        </span>
      )}
    </button>
  );
}

// ─── Request card ────────────────────────────────────────────────────────────

export function RequestCard({
  row,
  isHo,
  busy,
  onApprove,
  onReject,
  onOpenReceipt,
}: {
  row: OpsRequestRow;
  isHo: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onOpenReceipt: (url: string) => void;
}) {
  const waiting = row.status === 'pending_ops';
  const rejected = row.status === 'ops_rejected';

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-white shadow-sm',
        waiting ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200',
      )}
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-snug text-slate-900">{row.storeName}</p>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              <span className="font-mono">{row.storeNo}</span>
              {isHo && <> · {row.areaName}</>}
            </p>
          </div>
          <TxStatusChip status={row.status} />
        </div>

        <div className="mt-3 flex gap-3">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-3 text-[13px] leading-snug text-slate-700">
              {row.categoryName && (
                <span className="mr-1.5 rounded bg-indigo-50 px-1.5 py-0.5 align-middle text-[10px] font-bold text-indigo-700">
                  {row.categoryName}
                </span>
              )}
              {row.description}
            </p>
            <p className="mt-1.5 truncate text-[11px] text-slate-400">
              {row.submittedByName} · {fmtWhen(row.createdAt)}
            </p>
          </div>
          <ReceiptButton url={row.imageUrl} onOpen={() => row.imageUrl && onOpenReceipt(row.imageUrl)} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Requested</p>
            <p className={cn('text-base font-bold tabular-nums', rejected ? 'text-slate-400 line-through' : 'text-slate-900')}>
              {rp(row.amount)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Actual</p>
            <p className={cn('text-base font-bold tabular-nums', row.actualAmount != null ? 'text-slate-900' : 'text-slate-300')}>
              {row.actualAmount != null ? rp(row.actualAmount) : '–'}
            </p>
          </div>
        </div>

        {rejected && row.rejectionReason && (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Rejected: {row.rejectionReason}</p>
        )}
      </div>

      {waiting && (
        <div className="border-t border-amber-100 bg-amber-50/50 p-3">
          <CardDecision busy={busy} onApprove={onApprove} onReject={onReject} />
        </div>
      )}
    </article>
  );
}

// ─── Refill card ─────────────────────────────────────────────────────────────

export function RefillCard({
  row,
  max,
  isHo,
  busy,
  open,
  onToggle,
  onApprove,
  onReject,
  onOpenReceipt,
}: {
  row: OpsRefillRow;
  max: number;
  isHo: boolean;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onOpenReceipt: (url: string) => void;
}) {
  const waiting = row.state === 'pending';
  const rejected = row.state === 'rejected';
  const usedPct = Math.min(100, Math.max(0, ((max - row.balance) / max) * 100));
  const leftPct = 100 - usedPct;
  // Same bands as the desktop Used cell: the less is left, the louder it gets.
  const bar = leftPct < 30 ? 'bg-rose-500' : leftPct < 60 ? 'bg-amber-400' : 'bg-slate-400';
  const gap = Math.abs(row.refill - row.used);

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-white shadow-sm',
        waiting ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200',
      )}
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-snug text-slate-900">{row.storeName}</p>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              <span className="font-mono">{row.storeNo}</span>
              {isHo && <> · {row.areaName}</>} · {row.requestedByName ?? 'PIC'} · {fmtWhen(row.requestedAt)}
            </p>
          </div>
          <RefillStateChip state={row.state} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Used</p>
            <p className={cn('text-base font-bold tabular-nums', row.used === 0 ? 'text-slate-300' : 'text-slate-900')}>
              {row.used === 0 ? '–' : rp(row.used)}
            </p>
          </div>
          <div className={cn('rounded-xl px-3 py-2.5', rejected ? 'bg-slate-50' : 'bg-indigo-50')}>
            <p className={cn('text-[10px] font-semibold uppercase tracking-wide', rejected ? 'text-slate-400' : 'text-indigo-500')}>Refill</p>
            <p className={cn('text-base font-bold tabular-nums', rejected ? 'text-slate-400 line-through' : 'text-indigo-700')}>
              {row.refill === 0 ? '–' : rp(row.refill)}
            </p>
          </div>
        </div>

        <div className="mt-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={cn('h-full rounded-full', bar)} style={{ width: `${usedPct}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Balance left <span className="font-semibold tabular-nums text-slate-700">{rp(row.balance)}</span> of {rp(max)}
          </p>
        </div>

        {row.notes && (
          <p className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            PIC note: &ldquo;{row.notes}&rdquo;
          </p>
        )}
        {rejected && row.rejectionReason && (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Rejected: {row.rejectionReason}</p>
        )}

        {/* Items behind the usage */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="mt-3 flex h-10 w-full items-center justify-between rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 active:bg-slate-50"
        >
          <span>
            {row.items.length} item{row.items.length === 1 ? '' : 's'} used{' '}
            <span className="font-normal text-slate-400">
              {row.sinceAt ? `since ${fmtDay(row.sinceAt)}` : 'since the store started'}
            </span>
          </span>
          <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="mt-2 space-y-1.5">
            {row.items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-xs italic text-slate-400">
                No completed spending in this period.
              </p>
            ) : (
              <>
                {row.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-2">
                    <ReceiptButton size="sm" url={item.imageUrl} onOpen={() => item.imageUrl && onOpenReceipt(item.imageUrl)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-slate-700">
                        {item.categoryName && (
                          <span className="mr-1 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-bold text-indigo-700">
                            {item.categoryName}
                          </span>
                        )}
                        {item.description}
                      </p>
                      <p className="text-[10px] text-slate-400">{fmtDay(item.createdAt)}</p>
                    </div>
                    <p className="shrink-0 text-xs font-semibold tabular-nums text-slate-900">{num(item.amount)}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-slate-900">
                  <span className="uppercase tracking-wide">Total used</span>
                  <span className="tabular-nums">{rp(row.used)}</span>
                </div>
                {gap >= 1 && (
                  <p className="px-1 text-[11px] text-amber-700">
                    The items add up to {rp(row.used)}, but the balance left means {rp(row.refill)} was used.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {waiting && (
        <div className="border-t border-amber-100 bg-amber-50/50 p-3">
          <CardDecision
            busy={busy}
            approveLabel={row.refill > 0 ? `Approve ${rp(row.refill)}` : 'Approve'}
            onApprove={onApprove}
            onReject={onReject}
          />
        </div>
      )}
    </article>
  );
}

/** Loading placeholder for the card list. */
export function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-44 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
      ))}
    </>
  );
}

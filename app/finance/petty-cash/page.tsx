'use client';
// app/finance/petty-cash/page.tsx
//
// Finance · Petty Cash Review
//
// Built for 50+ stores. Design priorities:
//   1. Fast triage: color-coded status at a glance (needs review / ready / done)
//   2. Minimal clicks: "Verify all" + "Refill" per store without modal stack
//   3. Image lightbox: click photo → full-screen without leaving the page
//   4. Month picker: review any past month without navigation
//   5. Search + area filter: find a store in under 2 seconds

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
  ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PettyCashStoreRow, PettyCashTxRow } from '@/app/api/finance/petty-cash/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const idr  = (v: string | number) => IDR.format(Number(v));

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// ─── Status system ────────────────────────────────────────────────────────────

type StoreStatus = 'needs-review' | 'ready-to-refill' | 'refilled' | 'no-activity';

function storeStatus(s: PettyCashStoreRow): StoreStatus {
  if (s.refillIssued) return 'refilled';
  if (s.transactions.length === 0) return 'no-activity';
  if (s.unverifiedCount > 0) return 'needs-review';
  return 'ready-to-refill';
}

const STATUS_META: Record<StoreStatus, { dot: string; badge: string; label: string; priority: number }> = {
  'needs-review':    { dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 ring-amber-200',     label: 'Needs review',     priority: 0 },
  'ready-to-refill': { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Ready to refill', priority: 1 },
  'refilled':        { dot: 'bg-slate-300',   badge: 'bg-slate-50 text-slate-500 ring-slate-200',      label: 'Refilled',         priority: 3 },
  'no-activity':     { dot: 'bg-slate-200',   badge: 'bg-slate-50 text-slate-400 ring-slate-200',      label: 'No activity',      priority: 2 },
};

// ─── Image lightbox ───────────────────────────────────────────────────────────

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Transaction evidence"
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Transaction row ──────────────────────────────────────────────────────────

function TxRow({
  tx,
  onVerify,
  onViewImage,
  verifying,
}: {
  tx: PettyCashTxRow;
  onVerify: (id: number) => void;
  onViewImage: (url: string) => void;
  verifying: boolean;
}) {
  return (
    <div className={cn(
      'grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-4 border-b border-slate-100/70 px-14 py-3 text-sm last:border-0',
      tx.verifiedAt ? 'bg-white' : 'bg-amber-50/30',
    )}>
      {/* Verified dot */}
      <span className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        tx.verifiedAt ? 'bg-emerald-400' : 'bg-amber-400',
      )} />

      {/* Description + submitter */}
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-800">{tx.description}</p>
        <p className="text-[11px] text-slate-400">
          {tx.submittedBy} · {new Date(tx.createdAt).toLocaleDateString('id-ID', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>

      {/* Amount */}
      <span className="shrink-0 font-semibold tabular-nums text-slate-700">
        {idr(tx.amount)}
      </span>

      {/* Photo */}
      <div className="w-10 shrink-0">
        {tx.imageUrl ? (
          <button
            onClick={() => onViewImage(tx.imageUrl!)}
            className="group relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 hover:border-emerald-300 transition-colors"
            title="View receipt photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tx.imageUrl} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
              <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
            <ImageOff className="h-3.5 w-3.5 text-slate-300" />
          </div>
        )}
      </div>

      {/* Verify button */}
      <div className="w-24 shrink-0">
        {tx.verifiedAt ? (
          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verified
          </span>
        ) : (
          <button
            onClick={() => onVerify(tx.id)}
            disabled={verifying}
            className="flex h-7 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
            Verify
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Store accordion row ──────────────────────────────────────────────────────

function StoreRow({
  store,
  month,
  expanded,
  onToggle,
  onReload,
}: {
  store: PettyCashStoreRow;
  month: string;
  expanded: boolean;
  onToggle: () => void;
  onReload: () => void;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [verifyingId, setVerifyingId]   = useState<number | null>(null);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [refilling, setRefilling]       = useState(false);
  const [actionError, setActionError]   = useState<string | null>(null);

  const status = storeStatus(store);
  const meta   = STATUS_META[status];

  async function verify(txId?: number) {
    setActionError(null);
    if (txId !== undefined) setVerifyingId(txId);
    else setVerifyingAll(true);

    try {
      const res = await fetch(`/api/finance/petty-cash/${store.storeId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          txId !== undefined
            ? { txId, yearMonth: month }
            : { yearMonth: month },
        ),
      });
      const body = await res.json();
      if (!body.success) setActionError(body.error ?? 'Verification failed.');
      else onReload();
    } catch {
      setActionError('Network error.');
    } finally {
      setVerifyingId(null);
      setVerifyingAll(false);
    }
  }

  async function refill() {
    setActionError(null);
    setRefilling(true);
    try {
      const res = await fetch(`/api/finance/petty-cash/${store.storeId}/refill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearMonth: month }),
      });
      const body = await res.json();
      if (!body.success) setActionError(body.error ?? 'Refill failed.');
      else onReload();
    } catch {
      setActionError('Network error.');
    } finally {
      setRefilling(false);
    }
  }

  const balancePct = Math.min(100, Math.round((Number(store.balance) / 1_000_000) * 100));

  return (
    <>
      {lightboxUrl && (
        <Lightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}

      {/* Store header row */}
      <div
        onClick={onToggle}
        className={cn(
          'group grid cursor-pointer select-none border-b border-slate-100',
          'grid-cols-[auto_1fr_10rem_9rem_8rem_10rem] items-center gap-x-4',
          'px-4 py-3.5 transition-colors',
          expanded ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/60',
        )}
      >
        {/* Chevron */}
        <div className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
          expanded ? 'bg-slate-200 text-slate-700' : 'text-slate-400 group-hover:bg-slate-100',
        )}>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>

        {/* Store name */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
            <span className="truncate font-semibold text-slate-900">{store.storeName}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] font-bold text-slate-500">
              {store.storeNo}
            </span>
          </div>
          <p className="ml-4 mt-0.5 text-[11px] text-slate-400">{store.areaName}</p>
        </div>

        {/* Balance bar */}
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="font-medium text-slate-500">Balance</span>
            <span className={cn(
              'font-bold tabular-nums',
              balancePct < 30 ? 'text-rose-600' : balancePct < 60 ? 'text-amber-600' : 'text-emerald-600',
            )}>
              {balancePct}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                balancePct < 30 ? 'bg-rose-400' : balancePct < 60 ? 'bg-amber-400' : 'bg-emerald-500',
              )}
              style={{ width: `${balancePct}%` }}
            />
          </div>
          <p className="mt-0.5 text-[10px] tabular-nums text-slate-500">{idr(store.balance)}</p>
        </div>

        {/* Monthly spend */}
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-700">{idr(store.monthlySpend)}</p>
          <p className="text-[10px] text-slate-400">{store.transactions.length} tx this month</p>
        </div>

        {/* Status badge */}
        <div className="flex justify-center">
          <span className={cn('inline-flex items-center rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset', meta.badge)}>
            {store.unverifiedCount > 0
              ? `${store.unverifiedCount} pending`
              : meta.label}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {status === 'needs-review' && (
            <button
              onClick={() => verify()}
              disabled={verifyingAll}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-[11px] font-bold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {verifyingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              Verify all
            </button>
          )}
          {status === 'ready-to-refill' && (
            <button
              onClick={refill}
              disabled={refilling}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {refilling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wallet className="h-3 w-3" />}
              Refill
            </button>
          )}
          {status === 'refilled' && (
            <span className="text-[10px] font-semibold text-slate-400">
              +{idr(store.refillAmount ?? 0)} refilled
            </span>
          )}
        </div>
      </div>

      {/* Error toast */}
      {actionError && (
        <div className="border-b border-rose-100 bg-rose-50 px-14 py-2 text-xs font-medium text-rose-700">
          <span className="mr-2">⚠️</span>{actionError}
          <button onClick={() => setActionError(null)} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {/* Transaction accordion */}
      {expanded && (
        <div className="border-b border-slate-100 bg-slate-50/50">
          {store.transactions.length === 0 ? (
            <p className="px-14 py-6 text-sm italic text-slate-400">
              No transactions recorded for {monthLabel(month)}.
            </p>
          ) : (
            <>
              {/* Sub-header */}
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 border-b border-slate-100 px-14 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <span />
                <span>Description / Submitted by</span>
                <span>Amount</span>
                <span>Photo</span>
                <span className="w-24">Action</span>
              </div>

              {store.transactions.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  onVerify={(id) => verify(id)}
                  onViewImage={setLightboxUrl}
                  verifying={verifyingId === tx.id}
                />
              ))}

              {/* Total row */}
              <div className="flex items-center justify-between border-t border-slate-100 bg-white px-14 py-2.5">
                <span className="text-xs font-bold text-slate-500">
                  Monthly total
                </span>
                <span className="text-sm font-bold tabular-nums text-slate-900">
                  {idr(store.monthlySpend)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function SummaryStrip({ stores }: { stores: PettyCashStoreRow[] }) {
  const needsReview    = stores.filter((s) => storeStatus(s) === 'needs-review').length;
  const readyToRefill  = stores.filter((s) => storeStatus(s) === 'ready-to-refill').length;
  const refilled       = stores.filter((s) => storeStatus(s) === 'refilled').length;
  const totalSpend     = stores.reduce((sum, s) => sum + Number(s.monthlySpend), 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { value: needsReview,   label: 'Needs review',    accent: 'bg-amber-50 text-amber-600',   dot: 'bg-amber-400' },
        { value: readyToRefill, label: 'Ready to refill', accent: 'bg-emerald-50 text-emerald-600', dot: 'bg-emerald-500' },
        { value: refilled,      label: 'Refilled',        accent: 'bg-slate-50 text-slate-500',   dot: 'bg-slate-300' },
        { value: idr(totalSpend), label: 'Total spend',   accent: 'bg-sky-50 text-sky-600',       dot: 'bg-sky-400' },
      ].map(({ value, label, accent, dot }) => (
        <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
          <div>
            <p className="text-xl font-bold leading-none text-slate-900">{value}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancePettyCashPage() {
  const [month, setMonth]           = useState(currentMonth);
  const [allStores, setAllStores]   = useState<PettyCashStoreRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [search, setSearch]         = useState('');
  const [areaFilter, setAreaFilter] = useState('');

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/finance/petty-cash?month=${m}`, { cache: 'no-store' });
      const body = await res.json();
      if (body.success) {
        setAllStores(body.data);
        // Auto-expand first store with unverified transactions
        const first = body.data.find((s: PettyCashStoreRow) => s.unverifiedCount > 0);
        if (first) setExpandedIds(new Set([first.storeId]));
      } else {
        setError(body.error ?? 'Failed to load.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(month); }, [load, month]);

  // Derived list
  const areas = [...new Set(allStores.map((s) => s.areaName))].sort();

  const filtered = allStores.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      s.storeName.toLowerCase().includes(q) ||
      s.storeNo.toLowerCase().includes(q);
    const matchArea = !areaFilter || s.areaName === areaFilter;
    return matchSearch && matchArea;
  });

  const toggle = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const isCurrentMonth = month === currentMonth();

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-[1400px] px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Cash Management
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
                Petty Cash Review
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Month navigator */}
              <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white text-sm font-semibold">
                <button
                  onClick={() => setMonth(prevMonth(month))}
                  className="flex h-full w-8 items-center justify-center rounded-l-xl text-slate-500 hover:bg-slate-50"
                >‹</button>
                <span className="border-x border-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                  {monthLabel(month)}
                </span>
                <button
                  onClick={() => setMonth(nextMonth(month))}
                  disabled={isCurrentMonth}
                  className="flex h-full w-8 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >›</button>
              </div>

              {!isCurrentMonth && (
                <button
                  onClick={() => setMonth(currentMonth())}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  This month
                </button>
              )}

              <button
                onClick={() => load(month)}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6 lg:px-8">

        {/* Summary pills */}
        {!loading && !error && <SummaryStrip stores={allStores} />}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search store name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
            />
          </div>

          <select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="">All areas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          {(search || areaFilter) && (
            <button
              onClick={() => { setSearch(''); setAreaFilter(''); }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
          )}

          <span className="ml-auto text-xs text-slate-400">
            {filtered.length} of {allStores.length} stores
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Store table */}
        {loading ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Skeleton header */}
            <div className="h-11 animate-pulse bg-slate-100" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0">
                <div className="h-6 w-6 animate-pulse rounded-md bg-slate-100" />
                <div className="h-8 flex-1 animate-pulse rounded-lg bg-slate-50" />
                <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
                <div className="h-6 w-24 animate-pulse rounded-lg bg-slate-100" />
                <div className="h-7 w-20 animate-pulse rounded-lg bg-slate-100" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <Wallet className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {search || areaFilter ? 'No stores match your filter.' : 'No store data for this month.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-[auto_1fr_10rem_9rem_8rem_10rem] items-center gap-x-4 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <span className="w-6" />
              <span>Store</span>
              <span>Balance</span>
              <span>Spend this month</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>

            {filtered.map((store) => (
              <StoreRow
                key={store.storeId}
                store={store}
                month={month}
                expanded={expandedIds.has(store.storeId)}
                onToggle={() => toggle(store.storeId)}
                onReload={() => load(month)}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
          <span className="font-semibold uppercase tracking-wide">Status:</span>
          {Object.entries(STATUS_META).map(([key, m]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', m.dot)} />
              <span>{m.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
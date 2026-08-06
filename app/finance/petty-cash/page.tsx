'use client';
// app/finance/petty-cash/page.tsx
//
// Finance · Petty Cash Review
//
// Finance's only action here is approving/rejecting PIC refill requests.
// Usage-request approval belongs to OPS — Finance no longer reviews or
// verifies individual spend transactions, and no longer has a separate
// "close the month" action; the balance itself only tops back up once the
// store uploads its drawer + Surat Terima Petty Cash proof photos.
//
// Design priorities:
//   1. Fast triage: color-coded status at a glance (pending OPS / refilled / done)
//   2. Minimal clicks: refill-request approve/reject, one click each
//   3. Image lightbox: click photo → full-screen without leaving the page
//   4. Month picker: review any past month without navigation
//   5. Search + area filter: find a store in under 2 seconds

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
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

type StoreStatus = 'pending-ops' | 'ready-to-refill' | 'refilled' | 'no-activity';

function storeStatus(s: PettyCashStoreRow): StoreStatus {
  if (s.refillIssued) return 'refilled';
  if (s.transactions.length === 0) return 'no-activity';
  if (s.pendingOpsCount > 0) return 'pending-ops';
  return 'ready-to-refill';
}

const STATUS_META: Record<StoreStatus, { dot: string; badge: string; label: string; priority: number }> = {
  'pending-ops':     { dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 ring-amber-200',     label: 'Pending OPS',      priority: 0 },
  'ready-to-refill': { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Up to date', priority: 1 },
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

// ─── Transaction row (read-only — OPS owns approval, Finance just sees it) ───

const TX_STATUS_META: Record<string, { dot: string; label: string; text: string }> = {
  pending_ops: { dot: 'bg-amber-400', label: 'Waiting OPS', text: 'text-amber-600' },
  ops_approved: { dot: 'bg-emerald-400', label: 'Approved', text: 'text-emerald-600' },
  ops_rejected: { dot: 'bg-rose-400', label: 'Rejected', text: 'text-rose-500' },
};

function TxRow({
  tx,
  onViewImage,
}: {
  tx: PettyCashTxRow;
  onViewImage: (url: string) => void;
}) {
  const meta = TX_STATUS_META[tx.status] ?? TX_STATUS_META.pending_ops;

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-4 border-b border-slate-100/70 bg-white px-14 py-3 text-sm last:border-0">
      {/* Status dot */}
      <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />

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

      {/* Status */}
      <div className="w-24 shrink-0 text-right">
        <span className={cn('text-[10px] font-bold', meta.text)}>
          {meta.label}
        </span>
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
  refillRequest,
  onRefillActionDone,
}: {
  store: PettyCashStoreRow;
  month: string;
  expanded: boolean;
  onToggle: () => void;
  onReload: () => void;
  refillRequest: RefillRequestRow | null;
  onRefillActionDone: () => void;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [rejectingRequest, setRejectingRequest] = useState(false);
  const [rejectionReason, setRejectionReason]   = useState('');
  const [refillActionBusy, setRefillActionBusy] = useState<'approve' | 'reject' | null>(null);

  async function actOnRefillRequest(action: 'approve' | 'reject') {
    if (!refillRequest) return;
    setRefillActionBusy(action);
    try {
      const res = await fetch(`/api/finance/petty-cash/refill-requests/${refillRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectionReason: action === 'reject' ? rejectionReason || undefined : undefined }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Action failed');
      toast.success(action === 'approve' ? 'Refill approved.' : 'Refill request rejected.');
      setRejectingRequest(false);
      setRejectionReason('');
      onRefillActionDone();
      onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setRefillActionBusy(null);
    }
  }

  const status = storeStatus(store);
  const meta   = STATUS_META[status];

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

        {/* Balance */}
        <div className="text-right">
          <p className={cn(
            'text-sm font-semibold tabular-nums',
            balancePct < 30 ? 'text-rose-600' : balancePct < 60 ? 'text-amber-600' : 'text-slate-700',
          )}>
            {idr(store.balance)}
          </p>
          <p className="text-[10px] text-slate-400">Balance</p>
        </div>

        {/* Monthly spend */}
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-700">{idr(store.monthlySpend)}</p>
          <p className="text-[10px] text-slate-400">{store.transactions.length} tx this month</p>
        </div>

        {/* Status badge */}
        <div className="flex justify-center">
          <span className={cn('inline-flex items-center rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset', meta.badge)}>
            {store.pendingOpsCount > 0
              ? `${store.pendingOpsCount} pending`
              : meta.label}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {refillRequest ? (
            <>
              <button
                onClick={() => actOnRefillRequest('approve')}
                disabled={refillActionBusy !== null}
                title={`Requested by ${refillRequest.requestedByName ?? 'PIC'}${refillRequest.notes ? `: "${refillRequest.notes}"` : ''}`}
                className="flex h-7 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[11px] font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {refillActionBusy === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                Approve refill
              </button>
              <button
                onClick={() => setRejectingRequest((v) => !v)}
                disabled={refillActionBusy !== null}
                className="flex h-7 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : status === 'pending-ops' ? (
            <span className="text-[10px] font-semibold text-amber-600">
              Waiting on OPS
            </span>
          ) : status === 'refilled' ? (
            <span className="text-[10px] font-semibold text-slate-400">
              +{idr(store.refillAmount ?? 0)} refilled
            </span>
          ) : null}
        </div>
      </div>

      {/* Reject-reason inline row */}
      {rejectingRequest && refillRequest && (
        <div
          className="flex items-center gap-2 border-b border-rose-100 bg-rose-50/60 px-14 py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Reason for rejecting this refill request (optional)"
            className="h-8 flex-1 rounded-lg border border-rose-200 bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/30"
          />
          <button
            onClick={() => actOnRefillRequest('reject')}
            disabled={refillActionBusy !== null}
            className="h-8 shrink-0 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {refillActionBusy === 'reject' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm reject'}
          </button>
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
                <span className="w-24 text-right">Status</span>
              </div>

              {store.transactions.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  onViewImage={setLightboxUrl}
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
  const pendingOps     = stores.filter((s) => storeStatus(s) === 'pending-ops').length;
  const upToDate       = stores.filter((s) => storeStatus(s) === 'ready-to-refill').length;
  const refilled       = stores.filter((s) => storeStatus(s) === 'refilled').length;
  const totalSpend     = stores.reduce((sum, s) => sum + Number(s.monthlySpend), 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { value: pendingOps,   label: 'Pending OPS',    accent: 'bg-amber-50 text-amber-600',   dot: 'bg-amber-400' },
        { value: upToDate, label: 'Up to date', accent: 'bg-emerald-50 text-emerald-600', dot: 'bg-emerald-500' },
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

// ─── Refill requests (PIC-initiated mid-month top-ups) ───────────────────────
//
// Surfaced per-store in StoreRow's existing Action column (see below) rather
// than a standalone list — keeps everything about one store in one row even
// when many stores have requests at once.

interface RefillRequestRow {
  id: number;
  storeId: number;
  storeName: string;
  yearMonth: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  requestedByName: string | null;
  notes: string | null;
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
  const [refillRequests, setRefillRequests] = useState<RefillRequestRow[]>([]);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/finance/petty-cash?month=${m}`, { cache: 'no-store' });
      const body = await res.json();
      if (body.success) {
        setAllStores(body.data);
      } else {
        setError(body.error ?? 'Failed to load.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRefillRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/petty-cash/refill-requests', { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setRefillRequests(body.requests);
    } catch {
      // Non-critical — the Action column just won't show a refill-request badge yet.
    }
  }, []);

  useEffect(() => { void load(month); }, [load, month]);
  useEffect(() => { void loadRefillRequests(); }, [loadRefillRequests]);

  const refillRequestByStore = useMemo(() => {
    const map = new Map<number, RefillRequestRow>();
    for (const r of refillRequests) {
      if (r.status === 'pending') map.set(r.storeId, r);
    }
    return map;
  }, [refillRequests]);

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
                  className="flex h-full w-8 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50"
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
                refillRequest={refillRequestByStore.get(store.storeId) ?? null}
                onRefillActionDone={loadRefillRequests}
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
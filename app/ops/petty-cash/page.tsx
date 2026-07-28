// app/ops/petty-cash/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  MapPin,
  ReceiptText,
  Search,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';

// ─── Types ──────────────────────────────────────────────────────────────────

type OpsPettyCashRow = {
  id: number;
  amount: string;
  description: string;
  status: 'pending_ops' | 'ops_approved' | 'ops_rejected' | string;
  imageUrl: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;

  storeId: number;
  storeNo: string;
  storeName: string;
  areaId: number;
  areaName: string;

  submittedById: string;
  submittedByName: string;
};

type ApiResponse =
  | {
      success: true;
      month: string;
      scope: 'area' | 'all_areas';
      areaId: number | null;
      data: OpsPettyCashRow[];
    }
  | {
      success: false;
      error: string;
    };

type StatusFilter =
  | 'all'
  | 'pending_ops'
  | 'missing_receipt'
  | 'waiting_finance'
  | 'verified'
  | 'ops_rejected';

type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'store_asc';

// ─── Formatting helpers ─────────────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

function idr(value: string | number) {
  return IDR.format(Number(value));
}

function toKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function currentDateKey() {
  const d = new Date();
  return toKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

function monthFromDateKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function monthLabelFromDateKey(dateKey: string) {
  const [year, month] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Status classification ──────────────────────────────────────────────────
// Single source of truth for "which bucket is this row in" — used by filters,
// summary counts, sorting priority, and the status badge so they can never
// disagree with each other.

function classify(row: OpsPettyCashRow): Exclude<StatusFilter, 'all'> {
  if (row.status === 'pending_ops') return 'pending_ops';
  if (row.status === 'ops_rejected') return 'ops_rejected';
  if (row.verifiedAt) return 'verified';
  if (row.status === 'ops_approved' && !row.imageUrl) return 'missing_receipt';
  return 'waiting_finance';
}

const STATUS_META: Record<
  Exclude<StatusFilter, 'all'>,
  { label: string; icon: typeof Clock3; badge: string; rowAccent: string; dot: string }
> = {
  pending_ops: {
    label: 'Waiting OPS',
    icon: Clock3,
    badge: 'bg-amber-50 text-amber-700 ring-amber-200',
    rowAccent: 'bg-amber-400',
    dot: 'bg-amber-400',
  },
  missing_receipt: {
    label: 'Waiting receipt',
    icon: ReceiptText,
    badge: 'bg-sky-50 text-sky-700 ring-sky-200',
    rowAccent: 'bg-sky-400',
    dot: 'bg-sky-400',
  },
  waiting_finance: {
    label: 'Waiting finance',
    icon: CheckCircle2,
    badge: 'bg-violet-50 text-violet-700 ring-violet-200',
    rowAccent: 'bg-violet-400',
    dot: 'bg-violet-400',
  },
  verified: {
    label: 'Finance verified',
    icon: ShieldCheck,
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rowAccent: 'bg-emerald-500',
    dot: 'bg-emerald-500',
  },
  ops_rejected: {
    label: 'Rejected',
    icon: XCircle,
    badge: 'bg-rose-50 text-rose-700 ring-rose-200',
    rowAccent: 'bg-rose-400',
    dot: 'bg-rose-400',
  },
};

// Priority used for the default sort and for the "needs attention" ordering —
// pending OPS approval always floats up first since that's the actionable
// queue; everything else follows the natural process order.
const STATUS_PRIORITY: Record<Exclude<StatusFilter, 'all'>, number> = {
  pending_ops: 0,
  missing_receipt: 1,
  waiting_finance: 2,
  ops_rejected: 3,
  verified: 4,
};

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_ops', label: 'Waiting OPS' },
  { id: 'missing_receipt', label: 'Waiting receipt' },
  { id: 'waiting_finance', label: 'Waiting finance' },
  { id: 'verified', label: 'Verified' },
  { id: 'ops_rejected', label: 'Rejected' },
];

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'date_desc', label: 'Newest first' },
  { id: 'date_asc', label: 'Oldest first' },
  { id: 'amount_desc', label: 'Highest amount' },
  { id: 'amount_asc', label: 'Lowest amount' },
  { id: 'store_asc', label: 'Store name (A–Z)' },
];

// ─── Reject reason inline control ───────────────────────────────────────────
// Replaces window.prompt with an inline, dismissible input so rejecting a
// request never feels like a jarring native dialog mid-table.

function RejectControl({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="flex w-full items-center gap-1.5 sm:w-auto">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && reason.trim()) onConfirm(reason.trim());
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Reason for rejection..."
        className="h-9 w-full min-w-0 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-semibold text-slate-700 placeholder:font-normal placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100 sm:w-44"
      />
      <button
        onClick={() => reason.trim() && onConfirm(reason.trim())}
        disabled={busy || !reason.trim()}
        aria-label="Confirm rejection"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={onCancel}
        disabled={busy}
        aria-label="Cancel rejection"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Stat card (also acts as a status filter shortcut) ─────────────────────

function StatCard({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone: 'neutral' | 'amber' | 'sky' | 'violet' | 'emerald' | 'rose';
}) {
  const tones: Record<typeof tone, string> = {
    neutral: 'border-slate-200 bg-white text-slate-900',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    sky: 'border-sky-100 bg-sky-50 text-sky-700',
    violet: 'border-violet-100 bg-violet-50 text-violet-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
  };

  const labelTones: Record<typeof tone, string> = {
    neutral: 'text-slate-400',
    amber: 'text-amber-600',
    sky: 'text-sky-600',
    violet: 'text-violet-600',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-2xl border p-4 text-left shadow-sm transition',
        tones[tone],
        active ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-50' : 'hover:shadow',
      )}
    >
      <p className={cn('text-[10px] font-bold uppercase tracking-widest', labelTones[tone])}>
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </button>
  );
}

// ─── Refill requests (read-only — Finance is the one who approves) ──────────

interface RefillRequestRow {
  id: number;
  storeId: number;
  storeName: string;
  yearMonth: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  requestedByName: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

const REFILL_STATUS_META: Record<RefillRequestRow['status'], { label: string; cls: string }> = {
  pending: { label: 'Pending Finance', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { label: 'Rejected', cls: 'bg-rose-50 text-rose-600 ring-rose-200' },
};

function RefillRequestsReadOnly() {
  const [requests, setRequests] = useState<RefillRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ops/petty-cash/refill-requests', { cache: 'no-store' });
        const body = await res.json();
        if (body.success) setRequests(body.requests);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || requests.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Petty Cash Refill Requests
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">Requested by PIC, approved by Finance — informational only.</p>
      </div>
      <div className="divide-y divide-slate-100">
        {requests.slice(0, 10).map((r) => {
          const meta = REFILL_STATUS_META[r.status];
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{r.storeName}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {r.yearMonth} · {r.requestedByName ?? 'PIC'} · {new Date(r.requestedAt).toLocaleDateString('id-ID')}
                </p>
              </div>
              <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset', meta.cls)}>
                {meta.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function OpsPettyCashPage() {
  const [period] = useState<Period>('monthly');
  const [date, setDate] = useState(currentDateKey);
  const month = monthFromDateKey(date);

  const [rows, setRows] = useState<OpsPettyCashRow[]>([]);
  const [scope, setScope] = useState<'area' | 'all_areas' | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [areaFilter, setAreaFilter] = useState<number | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/ops/petty-cash?month=${month}`, { cache: 'no-store' });
      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success) {
        throw new Error(json.success === false ? json.error : 'Failed to load petty cash.');
      }

      setRows(json.data);
      setScope(json.scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load petty cash.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  // HO sees every area and can filter; Area OPS only ever has one area in
  // their dataset, so the filter would be a dropdown with one disabled
  // option — we just hide it entirely for that scope.
  const isHoScope = scope === 'all_areas';

  const areaOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of rows) map.set(row.areaId, row.areaName);
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const summary = useMemo(() => {
    const acc = {
      total: 0,
      pending_ops: 0,
      missing_receipt: 0,
      waiting_finance: 0,
      verified: 0,
      ops_rejected: 0,
      totalAmount: 0,
    };

    for (const row of rows) {
      acc.total += 1;
      acc.totalAmount += Number(row.amount);
      acc[classify(row)] += 1;
    }

    return acc;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    let result = rows.filter((row) => {
      if (statusFilter !== 'all' && classify(row) !== statusFilter) return false;
      if (isHoScope && areaFilter !== 'all' && row.areaId !== areaFilter) return false;

      if (q) {
        const haystack = [row.storeNo, row.storeName, row.areaName, row.description, row.submittedByName]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case 'date_asc':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'amount_desc':
          return Number(b.amount) - Number(a.amount);
        case 'amount_asc':
          return Number(a.amount) - Number(b.amount);
        case 'store_asc':
          return a.storeName.localeCompare(b.storeName);
        case 'date_desc':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return result;
  }, [rows, search, statusFilter, areaFilter, isHoScope, sortKey]);

  // Within the visible (filtered/sorted) set, still surface anything waiting
  // on OPS action first — keeps the approval queue from getting buried by
  // whatever sort the person picked, while respecting their chosen order
  // within each bucket.
  const orderedRows = useMemo(() => {
    if (sortKey !== 'date_desc' && sortKey !== 'date_asc') return visibleRows;
    return [...visibleRows].sort((a, b) => {
      const pa = STATUS_PRIORITY[classify(a)];
      const pb = STATUS_PRIORITY[classify(b)];
      if (pa !== pb) return pa - pb;
      return 0;
    });
  }, [visibleRows, sortKey]);

  async function approve(txId: number) {
    setBusyId(txId);
    setError(null);

    try {
      const res = await fetch(`/api/ops/petty-cash/${txId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', rejectionReason: '' }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Action failed.');

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(txId: number, rejectionReason: string) {
    setBusyId(txId);
    setError(null);

    try {
      const res = await fetch(`/api/ops/petty-cash/${txId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejectionReason }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Action failed.');

      setRejectingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  const hasActiveFilters =
    search.trim() !== '' || statusFilter !== 'all' || areaFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setAreaFilter('all');
  }

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope={isHoScope ? 'OPS HO · All Areas' : 'OPS · Area Approval'}
        title="Petty Cash"
        subtitle={`${monthLabelFromDateKey(date)} · Approve store petty cash requests before Finance verification`}
        periodProps={{ period, date, onDateChange: setDate }}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-bold">Something went wrong</p>
              <p className="mt-0.5 text-xs">{error}</p>
            </div>
          </div>
        )}

        <RefillRequestsReadOnly />

        {/* Summary / filter shortcuts */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Total"
            value={summary.total}
            tone="neutral"
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          />
          <StatCard
            label="Waiting OPS"
            value={summary.pending_ops}
            tone="amber"
            active={statusFilter === 'pending_ops'}
            onClick={() => setStatusFilter('pending_ops')}
          />
          <StatCard
            label="Waiting receipt"
            value={summary.missing_receipt}
            tone="sky"
            active={statusFilter === 'missing_receipt'}
            onClick={() => setStatusFilter('missing_receipt')}
          />
          <StatCard
            label="Finance queue"
            value={summary.waiting_finance}
            tone="violet"
            active={statusFilter === 'waiting_finance'}
            onClick={() => setStatusFilter('waiting_finance')}
          />
          <StatCard
            label="Verified"
            value={summary.verified}
            tone="emerald"
            active={statusFilter === 'verified'}
            onClick={() => setStatusFilter('verified')}
          />
          <StatCard
            label="Rejected"
            value={summary.ops_rejected}
            tone="rose"
            active={statusFilter === 'ops_rejected'}
            onClick={() => setStatusFilter('ops_rejected')}
          />
        </section>

        {/* Toolbar: search, area (HO only), status pills, sort */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative block lg:w-64 lg:shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search store, submitter, description..."
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </label>

            {isHoScope && areaOptions.length > 0 && (
              <label className="relative block lg:w-48 lg:shrink-0">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={areaFilter}
                  onChange={(e) =>
                    setAreaFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                  }
                  className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="all">All areas</option>
                  {areaOptions.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              </label>
            )}

            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-bold transition',
                    statusFilter === f.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <label className="relative block lg:w-44 lg:shrink-0">
              <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs font-bold text-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </label>
          </div>

          {hasActiveFilters && (
            <div className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2.5">
              <p className="text-xs text-slate-400">
                Showing <span className="font-bold text-slate-600">{orderedRows.length}</span> of{' '}
                {summary.total}
              </p>
              <button
                onClick={clearFilters}
                className="ml-auto text-xs font-bold text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </button>
            </div>
          )}
        </section>

        {/* Table */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : orderedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Wallet className="h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-700">No requests match here</p>
              <p className="mt-1 text-xs text-slate-400">
                Try a different month, or clear search and filters.
              </p>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <th className="w-2 px-0" aria-hidden />
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Store</th>
                    <th className="px-3 py-3">Description</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="px-3 py-3">Submitted by</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orderedRows.map((row) => {
                    const bucket = classify(row);
                    const meta = STATUS_META[bucket];
                    const Icon = meta.icon;
                    const isBusy = busyId === row.id;
                    const isPending = bucket === 'pending_ops';
                    const isRejecting = rejectingId === row.id;

                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          'transition-colors',
                          isPending ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50/70',
                        )}
                      >
                        <td className="w-2 px-0">
                          <span className={cn('block h-full w-1', meta.rowAccent)} />
                        </td>

                        <td className="whitespace-nowrap px-3 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1',
                              meta.badge,
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                          </span>
                          {row.rejectionReason && (
                            <p className="mt-1 max-w-[180px] truncate text-[11px] font-semibold text-rose-500">
                              {row.rejectionReason}
                            </p>
                          )}
                        </td>

                        <td className="px-3 py-3">
                          <p className="text-sm font-bold text-slate-900">{row.storeName}</p>
                          <p className="text-[11px] font-semibold text-slate-400">
                            {row.storeNo}
                            {isHoScope && <> · {row.areaName}</>}
                          </p>
                        </td>

                        <td className="max-w-[260px] px-3 py-3">
                          <p className="truncate font-semibold text-slate-700" title={row.description}>
                            {row.description}
                          </p>
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 text-right font-black tabular-nums text-slate-900">
                          {idr(row.amount)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                          {row.submittedByName}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-400">
                          {formatDate(row.createdAt)}
                        </td>

                        <td className="px-3 py-3">
                          {isPending ? (
                            isRejecting ? (
                              <div className="flex justify-end">
                                <RejectControl
                                  busy={isBusy}
                                  onConfirm={(reason) => void reject(row.id, reason)}
                                  onCancel={() => setRejectingId(null)}
                                />
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => setRejectingId(row.id)}
                                  disabled={isBusy}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Reject
                                </button>
                                <button
                                  onClick={() => void approve(row.id)}
                                  disabled={isBusy}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  {isBusy ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                  Approve
                                </button>
                              </div>
                            )
                          ) : (
                            <p className="text-right text-xs font-semibold text-slate-300">—</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
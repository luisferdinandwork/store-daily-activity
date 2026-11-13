'use client';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
// app/finance/petty-cash/page.tsx
//
// Finance · Petty Cash Monitoring
//
// One row per store, drawn like a spreadsheet: code, store, area, balance,
// what Finance accepted this month (Used), how many requests and ONE status
// (Pending / Completed). Click a row to open its requests (with receipt
// photos), then a request for Finance's decision: Diterima, Perlu Perbaikan
// (back to PIC 1 as a draft) or Ditolak.
//
// Refills are NOT handled here: a store whose month is Completed moves to the
// Report (/finance/petty-cash/report), and that is the only place Finance
// verifies its refill (and sees the bank account to send it to).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ImageOff,
  RefreshCw,
  Search,
  Wallet,
  ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PettyCashStoreRow, PettyCashTxRow } from '@/app/api/finance/petty-cash/route';
import { compareStoreCodes, reportMonthLabel, storeCodeDisplay, storeCodeOf } from '@/lib/petty-cash-report';
import {
  FINANCE_REQUEST_STATE_LABEL,
  FINANCE_REQUEST_STATE_TEXT,
  financeRequestState,
} from '@/lib/petty-cash-transactions';
import { PENDING_FINANCE_LABEL, leavesOutOfTransfer } from '@/lib/petty-cash-review';
import { fmtRequestDate } from '@/lib/petty-cash-re-request';
import { ReRequestBadge } from '@/components/petty-cash/ReRequestBadge';
import { STORE_STATUS_LABEL } from '@/lib/store-status';
import { TxDetailModal, type ReviewHandler } from '@/components/finance/petty-cash/TxDetailModal';
import {
  MonthNavigator,
  PettyCashTabs,
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  currentMonth,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';

// ─── Store status ────────────────────────────────────────────────────────────

// ONE status per store for the month. Pending = something is still open: a request waiting on OPS, on PIC 1's
// actual amount, or completed but not yet checked by Finance. Completed = every request is through OPS and Finance
// has decided on each one (Diterima / Perlu Perbaikan / Ditolak) — then, with its refill verified, the store moves
// to the Report.
type StoreStatus = 'pending' | 'completed' | 'refilled' | 'no-activity' | 'closed';

const openCount = (s: PettyCashStoreRow) =>
  s.pendingOpsCount + s.awaitingActualCount + s.fixingCount + s.pendingFinanceCount;

function storeStatus(s: PettyCashStoreRow): StoreStatus {
  if (s.storeStatus === 'close') return 'closed';
  if (s.refillIssued) return 'refilled';
  if (s.transactions.length === 0) return 'no-activity';
  return openCount(s) > 0 ? 'pending' : 'completed';
}

const STATUS_META: Record<StoreStatus, { label: string; chip: string }> = {
  pending: { label: 'Pending', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  completed: { label: 'Completed', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  refilled: { label: 'Refilled', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  'no-activity': { label: 'No activity', chip: 'bg-slate-50 text-slate-400 ring-slate-200' },
  closed: { label: STORE_STATUS_LABEL.close, chip: 'bg-slate-100 text-slate-500 ring-slate-300' },
};

/** Hover text for a Pending chip: what is still open. */
function pendingDetail(s: PettyCashStoreRow): string {
  return [
    s.pendingOpsCount > 0 ? `${s.pendingOpsCount} menunggu OPS` : null,
    s.awaitingActualCount > 0 ? `${s.awaitingActualCount} menunggu jumlah aktual PIC 1` : null,
    s.fixingCount > 0 ? `${s.fixingCount} sedang diperbaiki PIC 1 (Perlu Perbaikan)` : null,
    s.pendingFinanceCount > 0 ? `${s.pendingFinanceCount} belum dicek Finance` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  );
}

// PETTY_CASH_MAX_BALANCE (lib/db/schema/petty-cash.ts) — not imported, since
// that module pulls the Drizzle schema into the client bundle.
const MAX_BALANCE = 1_000_000;

function balanceTone(balance: number) {
  const pct = (balance / MAX_BALANCE) * 100;
  return pct < 30 ? 'text-rose-600' : pct < 60 ? 'text-amber-600' : 'text-slate-900';
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function PhotoThumb({ url, onView, label }: { url: string | null; onView: (url: string) => void; label: string }) {
  if (!url) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50" title={`${label}: none`}>
        <ImageOff className="h-3 w-3 text-slate-300" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onView(url)}
      title={label}
      className="group relative flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-100 hover:border-emerald-400"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
        <ZoomIn className="h-3 w-3 text-white opacity-0 group-hover:opacity-100" />
      </span>
    </button>
  );
}

// ─── Expanded detail: this month's requests ─────────────────────────────────

/** A category's IS (Business Central item no.) as a quiet mono code; a dash when the category has none. */
function IsCode({ code }: { code: string | null }) {
  return code ? (
    <span className="font-mono text-[11px] font-medium text-slate-600">{code}</span>
  ) : (
    <span className="text-slate-300">–</span>
  );
}

function TxSheet({
  store,
  month,
  onOpenTx,
}: {
  store: PettyCashStoreRow;
  month: string;
  /** Opens the request (by its position in the store's list) in the detail modal. */
  onOpenTx: (index: number) => void;
}) {
  if (store.transactions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm italic text-slate-400">
        No requests recorded for {reportMonthLabel(month)}.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">Date</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">Category</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left" title="No. item Business Central">IS</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">Description</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">By</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-right">Amount</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-center">Photo</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {store.transactions.map((tx: PettyCashTxRow, i) => {
            const state = financeRequestState(tx.status, tx.financeReview);
            return (
              <tr
                key={tx.id}
                onClick={() => onOpenTx(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenTx(i);
                  }
                }}
                tabIndex={0}
                title="Klik untuk melihat detail dan foto struk"
                className="cursor-pointer bg-white outline-none hover:bg-emerald-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
              >
                <td className={cn(TD, 'whitespace-nowrap text-slate-500')}>
                  {fmtDateTime(tx.createdAt)}
                  {tx.isReRequest && tx.requestDate && (
                    <span className="block text-[10px] text-violet-600" title="Tanggal request yang diisi PIC 1">
                      Request {fmtRequestDate(tx.requestDate)}
                    </span>
                  )}
                </td>
                <td className={cn(TD, 'whitespace-nowrap font-medium text-slate-700')}>{tx.categoryName ?? '–'}</td>
                <td className={cn(TD, 'whitespace-nowrap')}><IsCode code={tx.isCode} /></td>
                <td className={cn(TD, 'max-w-xs truncate text-slate-700')} title={tx.description}>
                  {tx.isReRequest && <ReRequestBadge className="mr-1.5 align-middle" />}
                  {tx.description}
                </td>
                <td className={cn(TD, 'whitespace-nowrap text-slate-600')}>{tx.submittedBy}</td>
                <td className={cn(TD, 'text-right tabular-nums text-slate-900', (tx.status === 'ops_rejected' || leavesOutOfTransfer(tx.financeReview)) && 'text-slate-400 line-through')}>
                  {num(tx.actualAmount ?? tx.amount)}
                </td>
                <td className={cn(TD, 'py-1')}>
                  <span className="flex justify-center">
                    <PhotoThumb url={tx.imageUrl} onView={() => onOpenTx(i)} label="Receipt" />
                  </span>
                </td>
                <td className={cn(TD, 'whitespace-nowrap text-xs font-semibold', FINANCE_REQUEST_STATE_TEXT[state])}>
                  {FINANCE_REQUEST_STATE_LABEL[state]}
                </td>
              </tr>
            );
          })}
          <tr className="border-y-2 border-slate-400 bg-emerald-50 font-semibold text-slate-900">
            <td colSpan={5} className={cn(TD, 'border-slate-300 text-right text-xs uppercase tracking-wide')}>
              Used in {reportMonthLabel(month)}
              <span className="ml-1 font-normal normal-case tracking-normal text-slate-500">(Diterima)</span>
            </td>
            <td className={cn(TD, 'border-slate-300 text-right tabular-nums')}>{num(store.monthlySpend)}</td>
            <td colSpan={2} className={cn(TD, 'border-slate-300')} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Store row ───────────────────────────────────────────────────────────────

function StoreLines({
  store,
  index,
  month,
  expanded,
  onToggle,
  onOpenTx,
}: {
  store: PettyCashStoreRow;
  index: number;
  month: string;
  expanded: boolean;
  onToggle: () => void;
  onOpenTx: (index: number) => void;
}) {
  const status = storeStatus(store);

  return (
    <>
      <tr
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        aria-expanded={expanded}
        className={cn(
          'cursor-pointer text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500',
          expanded ? 'bg-emerald-50/60' : 'bg-white hover:bg-slate-50',
        )}
      >
        <td className={cn(ROW_HEAD, 'w-11')}>
          <span className="flex items-center justify-center gap-0.5">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {index}
          </span>
        </td>
        <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{store.storeNo}</td>
        <td className={cn(TD, 'min-w-56 font-medium text-slate-900')}>{store.storeName}</td>
        <td className={cn(TD, 'whitespace-nowrap font-mono text-[11px] text-slate-500')}>{store.deptCode ?? <span className="text-slate-300">–</span>}</td>
        <td className={cn(TD, 'whitespace-nowrap text-slate-500')}>{store.areaName}</td>
        <td className={cn(TD, 'w-32 text-right font-semibold tabular-nums', balanceTone(Number(store.balance)))}>
          {num(store.balance)}
        </td>
        <td className={cn(TD, 'w-32 text-right tabular-nums', Number(store.monthlySpend) === 0 ? 'text-slate-300' : 'text-slate-900')}>
          {Number(store.monthlySpend) === 0 ? '–' : num(store.monthlySpend)}
        </td>
        <td className={cn(TD, 'w-14 text-center tabular-nums text-slate-600')}>{store.transactions.length}</td>
        <td className={cn(TD, 'w-32')} title={status === 'pending' ? pendingDetail(store) : undefined}>
          <Chip className={STATUS_META[status].chip}>{STATUS_META[status].label}</Chip>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={9} className="border-b border-slate-300 bg-slate-50 p-3">
            <TxSheet store={store} month={month} onOpenTx={onOpenTx} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type SortKey = 'code' | 'store' | 'balance' | 'used';

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={cn(TH, align === 'right' ? 'text-right' : 'text-left')} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900', active && 'text-slate-900')}
      >
        {label}
        {active && (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

export default function FinancePettyCashPage() {
  const [month, setMonth] = useState(currentMonth);
  const [allStores, setAllStores] = useState<PettyCashStoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  // The request open in the detail modal: which store, and its position in that store's list.
  const [detail, setDetail] = useState<{ storeId: number; index: number } | null>(null);

  // `silent` refreshes in place (no skeleton) — used after a review, with the detail modal open.
  const load = useCallback(async (m: string, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/petty-cash?month=${m}`, { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setAllStores(body.data);
      else setError(body.error ?? 'Failed to load.');
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(month); }, [load, month]);

  // Diterima, Perlu Perbaikan (back to PIC 1 as a draft) or Ditolak — comment optional.
  const reviewTx: ReviewHandler = async (txId, action, comment) => {
    try {
      const res = await fetch(`/api/finance/petty-cash/transactions/${txId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? 'Gagal memproses.');
        await load(month, true);
        return false;
      }
      toast.success(
        action === 'reject'
          ? 'Request ditolak — PIC 1 diberi tahu dan nominalnya tidak ikut ditransfer.'
          : action === 'revise'
            ? `Dikembalikan ke PIC 1 untuk diperbaiki — request yang sama, disetujui OPS lagi sebelum kembali ke Finance${body.periodMonth ? ` (periode ${reportMonthLabel(body.periodMonth)})` : ''}.`
            : 'Request diterima — selesai dicek Finance.',
      );
      await load(month, true);
      return true;
    } catch {
      toast.error('Network error.');
      return false;
    }
  };

  const areas = useMemo(() => [...new Set(allStores.map((s) => s.areaName))].sort(), [allStores]);
  const codes = useMemo(
    () => [...new Set(allStores.map((s) => storeCodeOf(s.storeNo)))].sort(compareStoreCodes),
    [allStores],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = allStores.filter((s) => {
      if (areaFilter && s.areaName !== areaFilter) return false;
      if (codeFilter && storeCodeOf(s.storeNo) !== codeFilter) return false;
      return (
        !q ||
        s.storeName.toLowerCase().includes(q) ||
        s.storeNo.toLowerCase().includes(q) ||
        (s.deptCode?.toLowerCase().includes(q) ?? false)
      );
    });

    if (!sort) return list; // API order: stores needing attention first
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case 'code': return dir * a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true });
        case 'store': return dir * a.storeName.localeCompare(b.storeName);
        case 'balance': return dir * (Number(a.balance) - Number(b.balance));
        case 'used': return dir * (Number(a.monthlySpend) - Number(b.monthlySpend));
      }
    });
  }, [allStores, search, areaFilter, codeFilter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: key === 'balance' || key === 'used' ? 'desc' : 'asc' };
      return prev.dir === 'asc' ? { key, dir: 'desc' } : null; // third click clears
    });

  const toggleExpanded = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalUsed = allStores.reduce((sum, s) => sum + Number(s.monthlySpend), 0);
  const pendingStores = allStores.filter((s) => storeStatus(s) === 'pending').length;
  const completedStores = allStores.filter((s) => storeStatus(s) === 'completed').length;

  const filtered = Boolean(search || areaFilter || codeFilter);
  const detailStore = detail ? allStores.find((s) => s.storeId === detail.storeId) ?? null : null;

  return (
    <div className="min-h-full bg-slate-50">
      {detail && detailStore && (
        <TxDetailModal
          store={detailStore}
          transactions={detailStore.transactions}
          index={Math.min(detail.index, detailStore.transactions.length - 1)}
          onIndex={(index) => setDetail({ storeId: detail.storeId, index })}
          onClose={() => setDetail(null)}
          onReview={reviewTx}
        />
      )}

      {/* Header */}
      <PanelPageHeader
        scope="Finance · Petty Cash"
        title="Petty Cash Monitoring"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthNavigator month={month} onChange={setMonth} />
            <button
              type="button"
              onClick={() => void load(month)}
              disabled={loading}
              className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        }
        tabs={<PettyCashTabs />}
      />

      <div className="space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers — a plain strip, not cards */}
        {!loading && !error && (
          <dl className="grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-md border border-slate-300 bg-white sm:grid-cols-4">
            {[
              { label: `Used · ${reportMonthLabel(month)}`, value: rp(totalUsed) },
              { label: 'Stores', value: String(allStores.length) },
              { label: 'Pending', value: String(pendingStores), warn: pendingStores > 0 },
              { label: 'Completed', value: String(completedStores) },
            ].map(({ label, value, warn }) => (
              <div key={label} className="px-4 py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className={cn('mt-0.5 text-lg font-bold tabular-nums', warn ? 'text-amber-600' : 'text-slate-900')}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search store name, code or dept code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <select
            value={codeFilter}
            onChange={(e) => setCodeFilter(e.target.value)}
            aria-label="Filter by store code"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">All codes</option>
            {codes.map((c) => <option key={c} value={c}>{storeCodeDisplay(c)}</option>)}
          </select>

          <select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            aria-label="Filter by area"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">All areas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          {filtered && (
            <button
              type="button"
              onClick={() => { setSearch(''); setAreaFilter(''); setCodeFilter(''); }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
          )}

          <span className="ml-auto text-xs text-slate-400">
            {visible.length} of {allStores.length} stores
          </span>
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Sheet */}
        {loading ? (
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
            <div className="h-9 animate-pulse bg-slate-100" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white py-16 text-center">
            <Wallet className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {filtered ? 'No stores match your filter.' : `No store data for ${reportMonthLabel(month)}.`}
            </p>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-md border border-slate-300 bg-white">
            <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th className={cn(TH, 'w-11 text-center')}>No</th>
                  <SortHeader label="Code" sortKey="code" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Store" sortKey="store" sort={sort} onSort={toggleSort} />
                  <th className={cn(TH, 'text-left')}>Dept Code</th>
                  <th className={cn(TH, 'text-left')}>Area</th>
                  <SortHeader label="Balance" sortKey="balance" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Used" sortKey="used" sort={sort} onSort={toggleSort} align="right" />
                  <th className={cn(TH, 'text-center')}>Tx</th>
                  <th className={cn(TH, 'text-left')}>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((store, i) => (
                  <StoreLines
                    key={store.storeId}
                    store={store}
                    index={i + 1}
                    month={month}
                    expanded={expandedIds.has(store.storeId)}
                    onToggle={() => toggleExpanded(store.storeId)}
                    onOpenTx={(index) => setDetail({ storeId: store.storeId, index })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-slate-500">
          Balance and Used are in Rupiah. Used adds up only the requests you accepted (Diterima) — a request still
          Pending Finance counts once you accept it. A store is{' '}
          <span className="font-semibold">Pending</span> while any request waits on OPS, on PIC 1, or on you (
          <span className="font-semibold">{PENDING_FINANCE_LABEL}</span> — open it and choose Diterima, Perlu Perbaikan
          or Ditolak), and <span className="font-semibold">Completed</span> once every request is decided; with its
          refill verified it then moves to Report. IS = the category&apos;s Business Central item no.
        </p>
      </div>
    </div>
  );
}

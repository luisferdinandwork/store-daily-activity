'use client';
// app/finance/petty-cash/page.tsx
//
// Finance · Petty Cash Monitoring
//
// One row per store, drawn like a spreadsheet: code, store, area, balance,
// what it used this month, how many requests, spend status and refill status.
// Click a row to open its requests (with receipt photos) and, if PIC 1 has
// asked for a refill, the bank account to send the cash to.
//
// Finance has no approval actions here — spend-request approval and
// refill-request approval both happen in OPS. This page is read-only
// visibility into the money. The one interactive bit is "Mark done" on an
// approved refill: a purely local, personal checkbox (stored in this browser
// only, via localStorage) that helps whoever's on Finance remember which
// approved refills they've already physically handed cash over for. It does
// not call any API, does not change petty_cash_refill_requests.status, and is
// invisible to OPS/employees.
//
// The month-by-month usage + bank-account report for all stores (and the
// Excel export) lives at /finance/petty-cash/report.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ImageOff,
  Landmark,
  RefreshCw,
  Search,
  Wallet,
  X,
  ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PettyCashStoreRow, PettyCashTxRow } from '@/app/api/finance/petty-cash/route';
import {
  compareStoreCodes,
  reportMonthLabel,
  storeCodeDisplay,
  storeCodeOf,
} from '@/lib/petty-cash-report';
import {
  CopyButton,
  MonthNavigator,
  PettyCashTabs,
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  currentMonth,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';

// ─── "Mark done" — a purely local, personal note for Finance ─────────────────
// See the file header comment: this never touches the server, never shows up
// for OPS or employees, and has zero effect on petty_cash_refill_requests.

const REFILL_COMPLETED_STORAGE_KEY = 'financePettyCashRefilledIds';

function readCompletedRefillIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(REFILL_COMPLETED_STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as number[]) : [];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function writeCompletedRefillIds(ids: Set<number>) {
  try {
    window.localStorage.setItem(REFILL_COMPLETED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Non-critical — worst case Finance just re-marks it next visit.
  }
}

// localStorage is external mutable state, so this reads it via
// useSyncExternalStore rather than effect+setState — that also gets the
// server/client snapshot handling for free, so the server-rendered pass
// (no localStorage) never mismatches the client's hydrated value.
const refillMarkListeners = new Set<() => void>();

function subscribeToRefillMarks(listener: () => void) {
  refillMarkListeners.add(listener);
  return () => refillMarkListeners.delete(listener);
}

function getServerMarkedSnapshot() {
  return false;
}

function useMarkedRefilled(requestId: number | null) {
  const getSnapshot = useCallback(
    () => requestId != null && readCompletedRefillIds().has(requestId),
    [requestId],
  );

  const marked = useSyncExternalStore(subscribeToRefillMarks, getSnapshot, getServerMarkedSnapshot);

  const toggle = useCallback(() => {
    if (requestId == null) return;
    const ids = readCompletedRefillIds();
    if (ids.has(requestId)) ids.delete(requestId);
    else ids.add(requestId);
    writeCompletedRefillIds(ids);
    for (const listener of refillMarkListeners) listener();
  }, [requestId]);

  return { marked, toggle };
}

// ─── Refill requests (PIC-initiated top-ups) ─────────────────────────────────

interface RefillRequestRow {
  id: number;
  storeId: number;
  storeName: string;
  yearMonth: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  requestedByName: string | null;
  notes: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  /** Set once both proof photos are in and the cash has been received. */
  balanceAfter: string | null;
  drawerPhotoUrl: string | null;
  signaturePhotoUrl: string | null;
  /** Null on requests made before bank details were required. */
  bankName: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
}

type RefillState = 'pending' | 'approved' | 'received' | 'rejected';

function refillState(r: RefillRequestRow): RefillState {
  if (r.status === 'pending') return 'pending';
  if (r.status === 'rejected') return 'rejected';
  return r.balanceAfter ? 'received' : 'approved';
}

/**
 * The request to show against a store. Ones still in progress (waiting on OPS,
 * or approved but the cash not yet received) always show — they're Finance's
 * to-do. Finished / rejected ones only show in the month they were made, so a
 * long-settled refill doesn't linger on every later month. `requests` is
 * newest first.
 */
function pickRefillByStore(requests: RefillRequestRow[], month: string) {
  const live = new Map<number, RefillRequestRow>();
  const settled = new Map<number, RefillRequestRow>();

  for (const r of requests) {
    const state = refillState(r);
    if (state === 'pending' || state === 'approved') {
      if (!live.has(r.storeId)) live.set(r.storeId, r);
    } else if (r.yearMonth === month && !settled.has(r.storeId)) {
      settled.set(r.storeId, r);
    }
  }

  const byStore = new Map(settled);
  for (const [storeId, r] of live) byStore.set(storeId, r);
  return byStore;
}

const REFILL_META: Record<RefillState, { label: string; chip: string }> = {
  pending: { label: 'Requested', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  approved: { label: 'Approved', chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
  received: { label: 'Received', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { label: 'Rejected', chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

// ─── Store status ────────────────────────────────────────────────────────────

type StoreStatus = 'pending-ops' | 'ok' | 'refilled' | 'no-activity';

function storeStatus(s: PettyCashStoreRow): StoreStatus {
  if (s.refillIssued) return 'refilled';
  if (s.transactions.length === 0) return 'no-activity';
  if (s.pendingOpsCount > 0) return 'pending-ops';
  return 'ok';
}

const STATUS_META: Record<StoreStatus, { label: string; chip: string }> = {
  'pending-ops': { label: 'Pending OPS', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  ok: { label: 'OK', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  refilled: { label: 'Refilled', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  'no-activity': { label: 'No activity', chip: 'bg-slate-50 text-slate-400 ring-slate-200' },
};

const TX_STATUS_META: Record<string, { label: string; text: string }> = {
  pending_ops: { label: 'Waiting OPS', text: 'text-amber-600' },
  ops_approved: { label: 'Awaiting actual amount', text: 'text-sky-600' },
  completed: { label: 'Completed', text: 'text-emerald-600' },
  ops_rejected: { label: 'Rejected', text: 'text-rose-500' },
};

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

// ─── Image lightbox ──────────────────────────────────────────────────────────

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
        aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Photo"
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
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

// ─── Expanded detail: refill request + this month's requests ─────────────────

function RefillPanel({ request, onViewImage }: { request: RefillRequestRow; onViewImage: (url: string) => void }) {
  const state = refillState(request);
  const meta = REFILL_META[state];
  const hasBank = Boolean(request.bankName && request.accountNumber);

  return (
    <div className="rounded-md border border-slate-300 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Landmark className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-semibold text-slate-700">Refill request</span>
        <Chip className={meta.chip}>{meta.label}</Chip>
        <span className="ml-auto text-[11px] text-slate-400">
          {request.requestedByName ?? 'PIC'} · {fmtDateTime(request.requestedAt)}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-2 px-3 py-2.5 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bank</dt>
          <dd className="font-medium text-slate-900">{request.bankName ?? <NoBank />}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">No. Rekening</dt>
          <dd className="flex items-center gap-1 font-mono text-slate-900">
            {request.accountNumber ? (
              <>
                <span className="tabular-nums">{request.accountNumber}</span>
                <CopyButton value={request.accountNumber} label="Copy account number" />
              </>
            ) : (
              <NoBank />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Atas Nama</dt>
          <dd className="font-medium uppercase text-slate-900">{request.accountHolderName ?? <NoBank />}</dd>
        </div>
      </dl>

      {!hasBank && (
        <p className="border-t border-slate-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          No bank details on this request — it was made before PIC 1 had to provide them.
        </p>
      )}

      {(request.notes || request.rejectionReason || state === 'approved' || state === 'received') && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
          {request.notes && <span>Note: “{request.notes}”</span>}
          {request.rejectionReason && <span className="text-rose-600">Rejected: {request.rejectionReason}</span>}
          {(state === 'approved' || state === 'received') && (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-400">Proof from PIC 1</span>
              <PhotoThumb url={request.drawerPhotoUrl} onView={onViewImage} label="Petty cash drawer" />
              <PhotoThumb url={request.signaturePhotoUrl} onView={onViewImage} label="Surat Terima" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function NoBank() {
  return <span className="text-xs italic text-amber-700">not provided</span>;
}

function TxSheet({
  store,
  month,
  onViewImage,
}: {
  store: PettyCashStoreRow;
  month: string;
  onViewImage: (url: string) => void;
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
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">Description</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">By</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-right">Amount</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-center">Photo</th>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {store.transactions.map((tx: PettyCashTxRow) => {
            const meta = TX_STATUS_META[tx.status] ?? TX_STATUS_META.pending_ops;
            return (
              <tr key={tx.id} className="bg-white">
                <td className={cn(TD, 'whitespace-nowrap text-slate-500')}>{fmtDateTime(tx.createdAt)}</td>
                <td className={cn(TD, 'whitespace-nowrap font-medium text-slate-700')}>{tx.categoryName ?? '–'}</td>
                <td className={cn(TD, 'max-w-xs truncate text-slate-700')} title={tx.description}>{tx.description}</td>
                <td className={cn(TD, 'whitespace-nowrap text-slate-600')}>{tx.submittedBy}</td>
                <td className={cn(TD, 'text-right tabular-nums text-slate-900', tx.status === 'ops_rejected' && 'text-slate-400 line-through')}>
                  {num(tx.actualAmount ?? tx.amount)}
                </td>
                <td className={cn(TD, 'py-1')}>
                  <span className="flex justify-center">
                    <PhotoThumb url={tx.imageUrl} onView={onViewImage} label="Receipt" />
                  </span>
                </td>
                <td className={cn(TD, 'whitespace-nowrap text-xs font-semibold', meta.text)}>{meta.label}</td>
              </tr>
            );
          })}
          <tr className="border-y-2 border-slate-400 bg-emerald-50 font-semibold text-slate-900">
            <td colSpan={4} className={cn(TD, 'border-slate-300 text-right text-xs uppercase tracking-wide')}>
              Used in {reportMonthLabel(month)}
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
  refillRequest,
  onViewImage,
}: {
  store: PettyCashStoreRow;
  index: number;
  month: string;
  expanded: boolean;
  onToggle: () => void;
  refillRequest: RefillRequestRow | null;
  onViewImage: (url: string) => void;
}) {
  const state = refillRequest ? refillState(refillRequest) : null;
  const { marked, toggle: toggleMarked } = useMarkedRefilled(state === 'approved' ? refillRequest!.id : null);

  const status = storeStatus(store);
  const statusMeta = STATUS_META[status];

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
        <td className={cn(TD, 'whitespace-nowrap text-slate-500')}>{store.areaName}</td>
        <td className={cn(TD, 'w-32 text-right font-semibold tabular-nums', balanceTone(Number(store.balance)))}>
          {num(store.balance)}
        </td>
        <td className={cn(TD, 'w-32 text-right tabular-nums', Number(store.monthlySpend) === 0 ? 'text-slate-300' : 'text-slate-900')}>
          {Number(store.monthlySpend) === 0 ? '–' : num(store.monthlySpend)}
        </td>
        <td className={cn(TD, 'w-14 text-center tabular-nums text-slate-600')}>{store.transactions.length}</td>
        <td className={cn(TD, 'w-32')}>
          <Chip className={statusMeta.chip}>
            {status === 'pending-ops' ? `${store.pendingOpsCount} pending` : statusMeta.label}
          </Chip>
        </td>
        <td className={cn(TD, 'w-40')} onClick={(e) => e.stopPropagation()}>
          {refillRequest && state ? (
            <span className="flex items-center gap-1.5">
              <Chip className={REFILL_META[state].chip}>{REFILL_META[state].label}</Chip>
              {state === 'approved' && (
                <button
                  type="button"
                  onClick={toggleMarked}
                  title="Personal note only — doesn't change any status or notify anyone."
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-semibold transition',
                    marked
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-300 bg-white text-slate-500 hover:bg-slate-50',
                  )}
                >
                  <CheckCheck className="h-3 w-3" />
                  {marked ? 'Done' : 'Mark done'}
                </button>
              )}
            </span>
          ) : (
            <span className="text-slate-300">–</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={9} className="border-b border-slate-300 bg-slate-50 p-3">
            <div className="space-y-3">
              {refillRequest && <RefillPanel request={refillRequest} onViewImage={onViewImage} />}
              <TxSheet store={store} month={month} onViewImage={onViewImage} />
            </div>
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
  const [refillRequests, setRefillRequests] = useState<RefillRequestRow[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
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

  const loadRefillRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/petty-cash/refill-requests', { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setRefillRequests(body.requests);
    } catch {
      // Non-critical — the Refill column just stays empty.
    }
  }, []);

  useEffect(() => { void load(month); }, [load, month]);
  useEffect(() => { void loadRefillRequests(); }, [loadRefillRequests]);

  const refillByStore = useMemo(() => pickRefillByStore(refillRequests, month), [refillRequests, month]);

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
      return !q || s.storeName.toLowerCase().includes(q) || s.storeNo.toLowerCase().includes(q);
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
  const pendingStores = allStores.filter((s) => storeStatus(s) === 'pending-ops').length;
  const openRefills = allStores.filter((s) => {
    const r = refillByStore.get(s.storeId);
    const st = r ? refillState(r) : null;
    return st === 'pending' || st === 'approved';
  }).length;

  const filtered = Boolean(search || areaFilter || codeFilter);

  return (
    <div className="min-h-full bg-slate-50">
      {lightboxUrl && <Lightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 pt-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Petty Cash
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Petty Cash Monitoring</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <MonthNavigator month={month} onChange={setMonth} />
              <button
                type="button"
                onClick={() => { void load(month); void loadRefillRequests(); }}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-3">
            <PettyCashTabs />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers — a plain strip, not cards */}
        {!loading && !error && (
          <dl className="grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-md border border-slate-300 bg-white sm:grid-cols-4">
            {[
              { label: `Used · ${reportMonthLabel(month)}`, value: rp(totalUsed) },
              { label: 'Stores', value: String(allStores.length) },
              { label: 'Pending OPS', value: String(pendingStores), warn: pendingStores > 0 },
              { label: 'Refill in progress', value: String(openRefills), warn: openRefills > 0 },
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
              placeholder="Search store name or code…"
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
            <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th className={cn(TH, 'w-11 text-center')}>No</th>
                  <SortHeader label="Code" sortKey="code" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Store" sortKey="store" sort={sort} onSort={toggleSort} />
                  <th className={cn(TH, 'text-left')}>Area</th>
                  <SortHeader label="Balance" sortKey="balance" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Used" sortKey="used" sort={sort} onSort={toggleSort} align="right" />
                  <th className={cn(TH, 'text-center')}>Tx</th>
                  <th className={cn(TH, 'text-left')}>Status</th>
                  <th className={cn(TH, 'text-left')}>Refill</th>
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
                    refillRequest={refillByStore.get(store.storeId) ?? null}
                    onViewImage={setLightboxUrl}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-slate-500">
          Balance and Used are in Rupiah. Used counts completed requests only. Click a row for its requests and
          refill details; the full usage + bank-account list for every store is under Report.
        </p>
      </div>
    </div>
  );
}

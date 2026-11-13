'use client';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
// app/finance/petty-cash/transactions/page.tsx
//
// Finance · Petty Cash Transactions
//
// Every petty cash request across the chain — the flat ledger behind the
// per-store Monitoring view. Narrow it by period (calendar range picker; the
// date is when the PIC made the request), free-text search, area, store
// (searchable dropdown), category, Finance's decision (Pending Finance /
// Diterima / Perlu Perbaikan / Ditolak), Re-request, receipt photo and amount,
// and optionally by status (pills with live counts). Sort by any column (click
// a header) or from the "Urutkan" picker. The numbers in the strip follow every
// filter except the status, so picking one status still shows the full
// breakdown. "Download Excel" exports every row the current filters select, in
// the current order (not just the page on screen), as "Petty cash transaction"
// — Business Central Purchase Invoice lines (lib/petty-cash-transactions-xlsx.ts).
//
// "Total used" counts completed requests only, at the actual amount the PIC
// recorded — the same rule as Monitoring and the Report.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  FINANCE_REQUEST_STATE_LABEL,
  TX_PHOTO_FILTER_LABEL,
  TX_REVIEW_FILTER_LABEL,
  TX_REVIEW_FILTER_ORDER,
  TX_SORT_KEYS,
  TX_SORT_LABEL,
  TX_STATUS_LABEL,
  TX_STATUS_ORDER,
  defaultSortDir,
  financeRequestState,
  type FinanceRequestState,
  type SortDir,
  type TransactionRow,
  type TransactionsPage,
  type TransactionStoreOption,
  type TxPhotoFilter,
  type TxReviewFilter,
  type TxSortKey,
  type TxStatus,
} from '@/lib/petty-cash-transactions';
import {
  PettyCashTabs,
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';
import {
  KpiStrip,
  PhotoLightbox,
  RangePicker,
  downloadXlsx,
  thisMonthRange,
  type DateRangeValue,
} from '@/components/finance/shared/sheet-kit';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { ReRequestBadge } from '@/components/petty-cash/ReRequestBadge';
import { fmtRequestDate } from '@/lib/petty-cash-re-request';
import { PENDING_FINANCE_LABEL } from '@/lib/petty-cash-review';

const SELECT_CLS =
  'h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';
const INPUT_CLS =
  'h-9 rounded-md border border-slate-300 bg-white px-3 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

// One chip per request: where it stands for Finance (lib/petty-cash-transactions.ts → financeRequestState).
const STATE_CHIP: Record<FinanceRequestState, string> = {
  waiting_ops: 'bg-amber-50 text-amber-700 ring-amber-200',
  awaiting_actual: 'bg-sky-50 text-sky-700 ring-sky-200',
  ops_rejected: 'bg-rose-50 text-rose-600 ring-rose-200',
  pending_finance: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  needs_fix: 'bg-amber-50 text-amber-800 ring-amber-300',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-300',
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// ─── Cells ───────────────────────────────────────────────────────────────────

function StatusChip({ tx }: { tx: TransactionRow }) {
  const state = financeRequestState(tx.status, tx.financeReview);
  return (
    <span
      title={tx.financeComment ?? undefined}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        STATE_CHIP[state],
      )}
    >
      {FINANCE_REQUEST_STATE_LABEL[state]}
    </span>
  );
}

/** Receipt photo; degrades to an icon when the stored URL no longer loads. */
function ReceiptThumb({ url, onOpen }: { url: string | null; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);

  if (!url) {
    return (
      <span
        title="Tidak ada foto"
        className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50"
      >
        <ImageOff className="h-3 w-3 text-slate-300" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Lihat foto struk"
      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-100 transition hover:border-emerald-500"
    >
      {failed ? (
        <ImageOff className="h-3 w-3 text-slate-400" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Struk" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </button>
  );
}

function TxLine({
  tx,
  index,
  onOpenPhoto,
}: {
  tx: TransactionRow;
  index: number;
  onOpenPhoto: () => void;
}) {
  const rejected = tx.status === 'ops_rejected';

  return (
    <tr className="bg-white text-[13px] hover:bg-emerald-50/40">
      <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
      <td className={cn(TD, 'w-40 whitespace-nowrap text-slate-600')}>
        {fmtWhen(tx.createdAt)}
        {tx.isReRequest && tx.requestDate && (
          <span className="block text-[10px] text-violet-600" title="Tanggal request yang diisi PIC 1">
            Request {fmtRequestDate(tx.requestDate)}
          </span>
        )}
      </td>
      <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{tx.storeNo}</td>
      <td className={cn(TD, 'min-w-48 font-medium text-slate-900')}>{tx.storeName}</td>
      <td className={cn(TD, 'whitespace-nowrap font-medium text-slate-700')}>
        {tx.categoryName ?? <span className="text-slate-300">–</span>}
      </td>
      <td className={cn(TD, 'whitespace-nowrap font-mono text-[11px] font-medium text-slate-600')}>
        {tx.isCode ?? <span className="font-sans text-slate-300">–</span>}
      </td>
      <td className={cn(TD, 'min-w-64 max-w-sm')}>
        <p className="line-clamp-2 text-slate-700" title={tx.description}>
          {tx.isReRequest && <ReRequestBadge className="mr-1.5 align-middle" />}
          {tx.description}
        </p>
        {rejected && tx.rejectionReason && (
          <p className="mt-0.5 text-[11px] text-rose-600">Ditolak: {tx.rejectionReason}</p>
        )}
      </td>
      <td className={cn(TD, 'whitespace-nowrap text-slate-600')}>{tx.submittedBy}</td>
      <td className={cn(TD, 'w-32 text-right tabular-nums', rejected ? 'text-slate-400 line-through' : 'text-slate-700')}>
        {num(tx.amount)}
      </td>
      <td className={cn(TD, 'w-32 text-right tabular-nums text-slate-900')}>
        {tx.actualAmount != null ? num(tx.actualAmount) : <span className="text-slate-300">–</span>}
      </td>
      <td className={cn(TD, 'w-40')}>
        <StatusChip tx={tx} />
      </td>
      <td className={cn(TD, 'w-16 py-1')}>
        <span className="flex justify-center">
          <ReceiptThumb url={tx.imageUrl} onOpen={onOpenPhoto} />
        </span>
      </td>
    </tr>
  );
}

/** A labelled block inside the Filter popover. */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {children}
    </div>
  );
}

/** A small one-of-many picker (Semua / … ) for the Filter popover. */
function ChipGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  /** `count` (optional) is shown muted after the label, like the status pills. */
  options: { value: string; label: string; count?: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value || 'all'}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-md border px-2.5 text-xs font-semibold transition',
            value === o.value
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
          )}
        >
          {o.label}
          {o.count != null && (
            <span className={cn('ml-1 tabular-nums', value === o.value ? 'text-emerald-100' : 'text-slate-400')}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A column header that sorts the list when clicked: first click = the column's natural order, second flips it. */
function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: TxSortKey;
  sort: { key: TxSortKey; dir: SortDir };
  onSort: (key: TxSortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn(TH, align === 'right' ? 'text-right' : 'text-left')}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900',
          active && 'text-slate-900',
        )}
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 text-slate-300" />
        )}
      </button>
    </th>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinancePettyCashTransactionsPage() {
  const [range, setRange] = useState<DateRangeValue>(thisMonthRange);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [status, setStatus] = useState<TxStatus | ''>('');
  const [category, setCategory] = useState('');
  const [review, setReview] = useState<TxReviewFilter | ''>('');
  const [reOnly, setReOnly] = useState(false);
  const [photo, setPhoto] = useState<TxPhotoFilter | ''>('');
  const [sort, setSort] = useState<{ key: TxSortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [moreOpen, setMoreOpen] = useState(false);

  // Typed boxes (search, amount range) go to the server a moment after typing stops.
  const [searchInput, setSearchInput] = useState('');
  const [minInput, setMinInput] = useState('');
  const [maxInput, setMaxInput] = useState('');
  const [typed, setTyped] = useState({ q: '', min: '', max: '' });
  useEffect(() => {
    const t = setTimeout(() => {
      const next = { q: searchInput.trim(), min: minInput, max: maxInput };
      setTyped((prev) => (prev.q === next.q && prev.min === next.min && prev.max === next.max ? prev : next));
      setPage(1); // a new search / amount starts again from the first page
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, minInput, maxInput]);

  // Last good response — stays on screen (dimmed) while the next one loads.
  const [data, setData] = useState<TransactionsPage | null>(null);
  // Kept apart from `data` so the pickers never empty while a reload is in flight.
  const [stores, setStores] = useState<TransactionStoreOption[]>([]);
  const [areas, setAreas] = useState<TransactionsPage['areas']>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Which request last finished (and how) — "loading" is simply: the current request hasn't.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);

  const [lightbox, setLightbox] = useState<{ title: string; url: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Every filter + the sort as the API's query string (the list adds its page; the Excel export does not).
  function filterParams(): URLSearchParams {
    const qs = new URLSearchParams({ from: range.from, to: range.to, sort: sort.key, dir: sort.dir });
    if (storeId != null) qs.set('storeId', String(storeId));
    if (areaId != null) qs.set('areaId', String(areaId));
    if (status) qs.set('status', status);
    if (category) qs.set('category', category);
    if (review) qs.set('review', review);
    if (reOnly) qs.set('reRequest', '1');
    if (photo) qs.set('photo', photo);
    if (typed.q) qs.set('q', typed.q);
    if (typed.min) qs.set('min', typed.min);
    if (typed.max) qs.set('max', typed.max);
    return qs;
  }
  const query = filterParams();
  query.set('page', String(page));
  const requestKey = `${query}#${reloadKey}`;

  const loading = settled?.key !== requestKey;
  const error = settled && settled.key === requestKey ? settled.error : null;

  useEffect(() => {
    let stale = false;
    const key = requestKey;
    const qs = key.slice(0, key.lastIndexOf('#'));

    fetch(`/api/finance/petty-cash/transactions?${qs}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          setData(body);
          setStores(body.stores);
          setAreas(body.areas);
          setCategories(body.categories);
          setSettled({ key, error: null });
          // The server clamps a page past the end (rows vanished after a reload).
          if (body.page !== page) setPage(body.page);
        } else {
          setSettled({ key, error: body.error ?? 'Failed to load transactions.' });
        }
      })
      .catch(() => { if (!stale) setSettled({ key, error: 'Network error.' }); });

    return () => { stale = true; };
    // `page` is only read to detect the server's clamp, which is already part of requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Any filter change goes back to the first page.
  const changeRange = (next: DateRangeValue) => { setRange(next); setPage(1); };
  const changeStore = (next: number | null) => { setStoreId(next); setPage(1); };
  const changeArea = (next: number | null) => {
    setAreaId(next);
    // A store that is not in the new area can no longer be the one picked.
    if (next != null && storeId != null && stores.find((s) => s.id === storeId)?.areaId !== next) setStoreId(null);
    setPage(1);
  };
  const changeStatus = (next: TxStatus | '') => { setStatus(next); setPage(1); };
  const changeCategory = (next: string) => { setCategory(next); setPage(1); };
  const changeReview = (next: TxReviewFilter | '') => { setReview(next); setPage(1); };
  const changeReOnly = (next: boolean) => { setReOnly(next); setPage(1); };
  const changePhoto = (next: TxPhotoFilter | '') => { setPhoto(next); setPage(1); };
  const changeSort = (key: TxSortKey, dir?: SortDir) => {
    setSort((prev) => ({
      key,
      // Clicking the sorted column flips it; a new column starts in its natural order.
      dir: dir ?? (prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : defaultSortDir(key)),
    }));
    setPage(1);
  };
  // The filters inside the "Filter" popover (the OPS status is there too, as well as in the pills).
  const clearMore = () => {
    setStatus('');
    setAreaId(null);
    setCategory('');
    setReview('');
    setReOnly(false);
    setPhoto('');
    setMinInput('');
    setMaxInput('');
    setPage(1);
  };
  const clearFilters = () => {
    clearMore();
    setStoreId(null);
    setStatus('');
    setSearchInput('');
  };

  // Every filter set in the Filter popover (the OPS status included), as a removable chip under the bar.
  const rupiahInput = (v: string) => Number(v).toLocaleString('id-ID');
  const activeChips: { key: string; label: string; clear: () => void }[] = [
    status ? { key: 'status', label: TX_STATUS_LABEL[status], clear: () => changeStatus('') } : null,
    areaId != null
      ? { key: 'area', label: `Area: ${areas.find((a) => a.id === areaId)?.name ?? areaId}`, clear: () => changeArea(null) }
      : null,
    category ? { key: 'category', label: `Kategori: ${category}`, clear: () => changeCategory('') } : null,
    review ? { key: 'review', label: TX_REVIEW_FILTER_LABEL[review], clear: () => changeReview('') } : null,
    reOnly ? { key: 're', label: 'Re-request', clear: () => changeReOnly(false) } : null,
    photo ? { key: 'photo', label: TX_PHOTO_FILTER_LABEL[photo], clear: () => changePhoto('') } : null,
    minInput || maxInput
      ? {
          key: 'amount',
          label: `Nominal ${minInput ? rupiahInput(minInput) : '0'} – ${maxInput ? rupiahInput(maxInput) : '∞'}`,
          clear: () => {
            setMinInput('');
            setMaxInput('');
          },
        }
      : null,
  ].filter((c): c is { key: string; label: string; clear: () => void } => c != null);
  // The Filter button's badge: every filter set inside the popover.
  const moreCount = activeChips.length;

  // Same filters and order as the list, minus the page — the export writes every matching row.
  async function handleDownload() {
    const qs = filterParams();

    setDownloading(true);
    try {
      await downloadXlsx(`/api/finance/petty-cash/transactions/export?${qs}`, 'Petty cash transaction.xlsx');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download gagal.');
    } finally {
      setDownloading(false);
    }
  }

  const summary = data?.summary;
  const statusPills: { key: TxStatus | ''; label: string; n: number | undefined }[] = [
    { key: '', label: 'Semua', n: summary?.count },
    ...TX_STATUS_ORDER.map((s) => ({ key: s, label: TX_STATUS_LABEL[s], n: summary?.byStatus[s] })),
  ];
  const rows = data?.rows ?? [];
  const filtered =
    storeId != null ||
    areaId != null ||
    status !== '' ||
    category !== '' ||
    review !== '' ||
    reOnly ||
    photo !== '' ||
    searchInput !== '' ||
    minInput !== '' ||
    maxInput !== '';
  // The store picker only offers the stores of the chosen area.
  const storeOptions = useMemo(
    () => (areaId == null ? stores : stores.filter((s) => s.areaId === areaId)),
    [stores, areaId],
  );
  const firstRow = data && data.matching > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? (data.page - 1) * data.pageSize + rows.length : 0;

  return (
    <div className="min-h-full bg-slate-50">
      {lightbox && (
        <PhotoLightbox
          title={lightbox.title}
          photos={[{ url: lightbox.url, label: 'Struk' }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Header */}
      <PanelPageHeader
        scope="Finance · Petty Cash"
        title="Petty Cash Transactions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RangePicker value={range} onChange={changeRange} />

            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </button>

            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || downloading || !data || data.matching === 0}
              title={data ? `${data.matching} transaksi sesuai filter` : undefined}
              className="flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download Excel
            </button>
          </div>
        }
        tabs={<PettyCashTabs />}
      />

      <div className="space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {summary && !error && (
          <KpiStrip
            items={[
              { label: 'Total used', value: rp(summary.totalUsed), sub: 'Diterima Finance, actual amount' },
              { label: 'Transactions', value: String(summary.count), sub: `${summary.byStatus.completed} completed` },
              { label: 'Waiting OPS', value: String(summary.byStatus.pending_ops), sub: 'not yet approved' },
              { label: 'Awaiting actual amount', value: String(summary.byStatus.ops_approved), sub: 'approved, PIC yet to record' },
              { label: PENDING_FINANCE_LABEL, value: String(summary.pendingFinance), sub: 'completed, not yet checked', warn: summary.pendingFinance > 0 },
              { label: 'Rejected', value: String(summary.byStatus.ops_rejected), sub: 'by OPS' },
              { label: 'Re-request', value: String(summary.reRequestCount), sub: 'ditolak Finance, diajukan ulang' },
            ]}
          />
        )}

        {/* Filters — one compact bar: search · store · Filter (the rest) · sort; below it the status + active filters */}
        <div className="rounded-md border border-slate-300 bg-white">
          <div className="flex flex-wrap items-center gap-2 p-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari toko, keterangan, kategori, IS, pengaju, #ID, nominal…"
                aria-label="Cari transaksi"
                className={cn(INPUT_CLS, 'w-full pl-9 pr-8')}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <StoreCombobox
              stores={storeOptions}
              value={storeId}
              onChange={changeStore}
              loading={stores.length === 0 && loading}
              allLabel="Semua toko"
              accent="emerald"
              className="h-9 w-64 max-w-none rounded-md border-slate-300 shadow-none"
            />

            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition',
                    moreCount > 0
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Filter
                  {moreCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[11px] font-bold text-white">
                      {moreCount}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-[min(92vw,26rem)] rounded-lg border-slate-200 p-0 shadow-lg">
                <div className="space-y-4 p-4">
                  <FilterField label="Keputusan Finance">
                    <ChipGroup
                      value={review}
                      onChange={(v) => changeReview(v as TxReviewFilter | '')}
                      options={[
                        { value: '', label: 'Semua' },
                        ...TX_REVIEW_FILTER_ORDER.map((r) => ({ value: r, label: TX_REVIEW_FILTER_LABEL[r] })),
                      ]}
                    />
                  </FilterField>

                  {/* Where the request is in the OPS / PIC 1 flow. */}
                  <FilterField label="Status by OPS">
                    <ChipGroup
                      value={status}
                      onChange={(v) => changeStatus(v as TxStatus | '')}
                      options={statusPills.map(({ key, label, n }) => ({ value: key, label, count: n }))}
                    />
                  </FilterField>

                  <div className="grid grid-cols-2 gap-3">
                    <FilterField label="Area">
                      <select
                        value={areaId ?? ''}
                        onChange={(e) => changeArea(e.target.value ? Number(e.target.value) : null)}
                        className={cn(SELECT_CLS, 'w-full')}
                      >
                        <option value="">Semua area</option>
                        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </FilterField>
                    <FilterField label="Kategori">
                      <select
                        value={category}
                        onChange={(e) => changeCategory(e.target.value)}
                        className={cn(SELECT_CLS, 'w-full')}
                      >
                        <option value="">Semua kategori</option>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </FilterField>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FilterField label="Jenis request">
                      <ChipGroup
                        value={reOnly ? 're' : ''}
                        onChange={(v) => changeReOnly(v === 're')}
                        options={[{ value: '', label: 'Semua' }, { value: 're', label: 'Re-request' }]}
                      />
                    </FilterField>
                    <FilterField label="Foto struk">
                      <ChipGroup
                        value={photo}
                        onChange={(v) => changePhoto(v as TxPhotoFilter | '')}
                        options={[{ value: '', label: 'Semua' }, { value: 'with', label: 'Ada' }, { value: 'without', label: 'Tanpa' }]}
                      />
                    </FilterField>
                  </div>

                  <FilterField label="Nominal (Rp)">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={minInput}
                        onChange={(e) => setMinInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="Min"
                        aria-label="Nominal minimum"
                        className={cn(INPUT_CLS, 'w-full tabular-nums')}
                      />
                      <span className="text-slate-400">–</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={maxInput}
                        onChange={(e) => setMaxInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="Maks"
                        aria-label="Nominal maksimum"
                        className={cn(INPUT_CLS, 'w-full tabular-nums')}
                      />
                    </div>
                  </FilterField>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={clearMore}
                    disabled={moreCount === 0}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-40"
                  >
                    Reset filter
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(false)}
                    className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    Selesai
                  </button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Sort: field + direction as one control */}
            <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
              <label htmlFor="tx-sort" className="flex items-center gap-1.5 pl-2.5 text-slate-500">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="sr-only">Urutkan</span>
              </label>
              <select
                id="tx-sort"
                value={sort.key}
                onChange={(e) => changeSort(e.target.value as TxSortKey, defaultSortDir(e.target.value as TxSortKey))}
                className="cursor-pointer border-0 bg-transparent py-0 pl-1.5 pr-7 font-medium text-slate-700 focus:outline-none focus:ring-0"
              >
                {TX_SORT_KEYS.map((k) => <option key={k} value={k}>{TX_SORT_LABEL[k]}</option>)}
              </select>
              <button
                type="button"
                onClick={() => changeSort(sort.key, sort.dir === 'asc' ? 'desc' : 'asc')}
                aria-label={sort.dir === 'asc' ? 'Urutan naik — klik untuk menurun' : 'Urutan turun — klik untuk menaik'}
                title={sort.dir === 'asc' ? 'Naik (A → Z, kecil → besar, lama → baru)' : 'Turun (Z → A, besar → kecil, baru → lama)'}
                className="flex w-9 items-center justify-center border-l border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                {sort.dir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* The filters in use (set in the Filter popover), each removable — only when there are any. */}
          {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-2 py-1.5">
            {activeChips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-slate-100 pl-2.5 pr-1 text-xs font-medium text-slate-700"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.clear}
                  aria-label={`Hapus filter ${chip.label}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto px-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Reset semua
            </button>
          </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Sheet */}
        {loading && !data ? (
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
            <div className="h-9 animate-pulse bg-slate-100" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
            ))}
          </div>
        ) : data && rows.length === 0 && !error ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white py-16 text-center">
            <FileSpreadsheet className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {filtered ? 'No transactions match your filter in this period.' : 'No transactions in this period.'}
            </p>
          </div>
        ) : data && rows.length > 0 ? (
          <>
            <div
              className={cn(
                'max-h-[68vh] overflow-auto rounded-md border border-slate-300 bg-white transition-opacity',
                loading && 'opacity-60',
              )}
            >
              <table className="w-full min-w-[1240px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <SortTh label="Tanggal" sortKey="date" sort={sort} onSort={changeSort} />
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <SortTh label="Nama Toko" sortKey="store" sort={sort} onSort={changeSort} />
                    <SortTh label="Kategori" sortKey="category" sort={sort} onSort={changeSort} />
                    <th className={cn(TH, 'text-left')} title="No. item Business Central">IS</th>
                    <th className={cn(TH, 'text-left')}>Keterangan</th>
                    <SortTh label="Diajukan Oleh" sortKey="submitter" sort={sort} onSort={changeSort} />
                    <SortTh label="Diajukan (Rp)" sortKey="amount" sort={sort} onSort={changeSort} align="right" />
                    <SortTh label="Aktual (Rp)" sortKey="actual" sort={sort} onSort={changeSort} align="right" />
                    <SortTh label="Status" sortKey="status" sort={sort} onSort={changeSort} />
                    <th className={cn(TH, 'text-center')}>Struk</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((tx, i) => (
                    <TxLine
                      key={tx.id}
                      tx={tx}
                      index={(data.page - 1) * data.pageSize + i + 1}
                      onOpenPhoto={() =>
                        tx.imageUrl && setLightbox({ title: `${tx.storeNo} · ${tx.storeName}`, url: tx.imageUrl })
                      }
                    />
                  ))}
                </tbody>
                {/* Total over EVERY matching transaction (all pages), not just the 50 on screen. */}
                <tfoot>
                  <tr className="text-[13px] font-semibold text-slate-900">
                    <td className={cn(ROW_HEAD, 'sticky bottom-0 border-t-2 border-t-slate-400')} />
                    <td colSpan={7} className={cn(TD, 'sticky bottom-0 border-t-2 border-t-slate-400 bg-emerald-50 text-right text-xs uppercase tracking-wide')}>
                      Total · {data.matching} transaksi
                    </td>
                    <td className={cn(TD, 'sticky bottom-0 border-t-2 border-t-slate-400 bg-emerald-50 text-right tabular-nums')}>
                      {num(data.totals.amount)}
                    </td>
                    <td className={cn(TD, 'sticky bottom-0 border-t-2 border-t-slate-400 bg-emerald-50 text-right tabular-nums')}>
                      {num(data.totals.actual)}
                    </td>
                    <td colSpan={2} className={cn(TD, 'sticky bottom-0 border-t-2 border-t-slate-400 bg-emerald-50')} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Pager */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <p>
                Showing <span className="font-semibold tabular-nums">{firstRow}–{lastRow}</span> of{' '}
                <span className="font-semibold tabular-nums">{data.matching}</span> transaction{data.matching === 1 ? '' : 's'}
              </p>

              {data.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={loading || data.page <= 1}
                    aria-label="Previous page"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-20 text-center font-semibold tabular-nums">
                    {data.page} / {data.totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    disabled={loading || data.page >= data.totalPages}
                    aria-label="Next page"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              Tanggal = saat PIC mengajukan request. <span className="font-semibold">Diajukan</span> adalah perkiraan
              PIC; <span className="font-semibold">Aktual</span> baru terisi setelah PIC mencatat nominal yang benar-benar
              dipakai. Total used = request yang Diterima Finance (nominal aktual); baris Total di bawah tabel
              menjumlahkan semua transaksi sesuai filter (bukan hanya halaman ini). IS = No. item Business
              Central dari kategorinya. Download Excel = &ldquo;Petty cash transaction&rdquo; dalam format baris Purchase
              Invoice BC, berisi semua transaksi sesuai filter dan urutan di atas.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

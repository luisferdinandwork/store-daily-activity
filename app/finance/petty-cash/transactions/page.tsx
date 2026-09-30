'use client';
// app/finance/petty-cash/transactions/page.tsx
//
// Finance · Petty Cash Transactions
//
// Every petty cash request across the chain, newest first — the flat ledger
// behind the per-store Monitoring view. Narrow it by store (searchable
// dropdown) and by period (calendar range picker; the date is when the PIC
// made the request), and optionally by status (pills with live counts). The
// numbers in the strip follow the store + period, so picking one status still
// shows the full breakdown. "Download Excel" exports every row the current
// filters select (not just the page on screen).
//
// "Total used" counts completed requests only, at the actual amount the PIC
// recorded — the same rule as Monitoring and the Report.

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  ImageOff,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  TX_STATUS_LABEL,
  TX_STATUS_ORDER,
  isTxStatus,
  type TransactionRow,
  type TransactionsPage,
  type TransactionStoreOption,
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

const STATUS_CHIP: Record<TxStatus, string> = {
  pending_ops: 'bg-amber-50 text-amber-700 ring-amber-200',
  ops_approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ops_rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
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

function StatusChip({ status }: { status: string }) {
  const known = isTxStatus(status);
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        known ? STATUS_CHIP[status] : 'bg-slate-100 text-slate-600 ring-slate-200',
      )}
    >
      {known ? TX_STATUS_LABEL[status] : status}
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
      <td className={cn(TD, 'w-40 whitespace-nowrap text-slate-600')}>{fmtWhen(tx.createdAt)}</td>
      <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{tx.storeNo}</td>
      <td className={cn(TD, 'min-w-48 font-medium text-slate-900')}>{tx.storeName}</td>
      <td className={cn(TD, 'whitespace-nowrap font-medium text-slate-700')}>
        {tx.categoryName ?? <span className="text-slate-300">–</span>}
      </td>
      <td className={cn(TD, 'min-w-64 max-w-sm')}>
        <p className="line-clamp-2 text-slate-700" title={tx.description}>{tx.description}</p>
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
      <td className={cn(TD, 'w-44')}><StatusChip status={tx.status} /></td>
      <td className={cn(TD, 'w-16 py-1')}>
        <span className="flex justify-center">
          <ReceiptThumb url={tx.imageUrl} onOpen={onOpenPhoto} />
        </span>
      </td>
    </tr>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinancePettyCashTransactionsPage() {
  const [range, setRange] = useState<DateRangeValue>(thisMonthRange);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [status, setStatus] = useState<TxStatus | ''>('');
  const [page, setPage] = useState(1);

  // Last good response — stays on screen (dimmed) while the next one loads.
  const [data, setData] = useState<TransactionsPage | null>(null);
  // Kept apart from `data` so the store dropdown never empties while a reload is in flight.
  const [stores, setStores] = useState<TransactionStoreOption[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Which request last finished (and how) — "loading" is simply: the current request hasn't.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);

  const [lightbox, setLightbox] = useState<{ title: string; url: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const query = new URLSearchParams({ from: range.from, to: range.to, page: String(page) });
  if (storeId != null) query.set('storeId', String(storeId));
  if (status) query.set('status', status);
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
  const changeStatus = (next: TxStatus | '') => { setStatus(next); setPage(1); };
  const clearFilters = () => { setStoreId(null); setStatus(''); setPage(1); };

  // Same filters as the list, minus the page — the export writes every matching row.
  async function handleDownload() {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (storeId != null) qs.set('storeId', String(storeId));
    if (status) qs.set('status', status);

    setDownloading(true);
    try {
      await downloadXlsx(`/api/finance/petty-cash/transactions/export?${qs}`, `petty-cash-transaksi_${range.from}_${range.to}.xlsx`);
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
  const filtered = storeId != null || status !== '';
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
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 pt-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Petty Cash
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Petty Cash Transactions</h1>
            </div>

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
          </div>

          <div className="mt-3">
            <PettyCashTabs />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {summary && !error && (
          <KpiStrip
            items={[
              { label: 'Total used', value: rp(summary.totalUsed), sub: 'completed requests, actual amount' },
              { label: 'Transactions', value: String(summary.count), sub: `${summary.byStatus.completed} completed` },
              { label: 'Waiting OPS', value: String(summary.byStatus.pending_ops), sub: 'not yet approved' },
              { label: 'Awaiting actual amount', value: String(summary.byStatus.ops_approved), sub: 'approved, PIC yet to record' },
              { label: 'Rejected', value: String(summary.byStatus.ops_rejected), sub: 'by OPS' },
            ]}
          />
        )}

        {/* Filters */}
        <div className="space-y-3">
          <StoreCombobox
            stores={stores}
            value={storeId}
            onChange={changeStore}
            loading={stores.length === 0 && loading}
            allLabel="Semua toko"
            accent="emerald"
          />

          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter status">
            {statusPills.map(({ key, label, n }) => (
              <button
                key={key || 'all'}
                type="button"
                role="tab"
                aria-selected={status === key}
                onClick={() => changeStatus(key)}
                className={cn(
                  'h-8 rounded-full border px-3 text-xs font-bold transition',
                  status === key
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {label}{' '}
                <span className={cn('tabular-nums', status === key ? 'text-emerald-100' : 'text-slate-400')}>
                  {n ?? '–'}
                </span>
              </button>
            ))}
            {filtered && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-1 text-xs font-semibold text-slate-500 underline hover:text-slate-700"
              >
                Clear
              </button>
            )}
          </div>
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
                    <th className={cn(TH, 'text-left')}>Tanggal</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-left')}>Kategori</th>
                    <th className={cn(TH, 'text-left')}>Keterangan</th>
                    <th className={cn(TH, 'text-left')}>Diajukan Oleh</th>
                    <th className={cn(TH, 'text-right')}>Diajukan (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Aktual (Rp)</th>
                    <th className={cn(TH, 'text-left')}>Status</th>
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
              dipakai — hanya request Completed yang memotong saldo dan dihitung di Total used.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

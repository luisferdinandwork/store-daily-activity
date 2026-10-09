'use client';
// app/finance/sales-returns/page.tsx
//
// Finance · Sales Return
//
// Every sales return the stores have filed, newest first: the receipt number the
// employee typed, the photos of the receipt, and — recorded automatically at
// upload — who filed it and when. Narrow it by store (searchable dropdown), by
// period (calendar range picker; the date is when the return was uploaded) and
// by a free-text search over receipt number, uploader and store.
//
// Drawn like the Petty Cash Transactions sheet (same cells, pager and lightbox).
// Ops has the same list for its own area at /ops/sales-returns.

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, FileSpreadsheet, RefreshCw, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SalesReturnsTable, salesReturnKpis, useDebouncedValue } from '@/components/sales-returns/shared';
import {
  KpiStrip,
  PhotoLightbox,
  RangePicker,
  thisMonthRange,
  type DateRangeValue,
  type LightboxPhoto,
} from '@/components/finance/shared/sheet-kit';
import { StoreCombobox } from '@/components/shared/store-combobox';
import type { SalesReturnsPage, SalesReturnStoreOption } from '@/lib/sales-returns';

export default function FinanceSalesReturnsPage() {
  const [range, setRange] = useState<DateRangeValue>(thisMonthRange);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());

  // Last good response — stays on screen (dimmed) while the next one loads.
  const [data, setData] = useState<SalesReturnsPage | null>(null);
  // Kept apart from `data` so the store dropdown never empties while a reload is in flight.
  const [stores, setStores] = useState<SalesReturnStoreOption[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Which request last finished (and how) — "loading" is simply: the current request hasn't.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);

  const [lightbox, setLightbox] = useState<{ title: string; photos: LightboxPhoto[]; index: number } | null>(null);

  const query = new URLSearchParams({ from: range.from, to: range.to, page: String(page) });
  if (storeId != null) query.set('storeId', String(storeId));
  if (q) query.set('q', q);
  const requestKey = `${query}#${reloadKey}`;

  const loading = settled?.key !== requestKey;
  const error = settled && settled.key === requestKey ? settled.error : null;

  useEffect(() => {
    let stale = false;
    const key = requestKey;
    const qs = key.slice(0, key.lastIndexOf('#'));

    fetch(`/api/finance/sales-returns?${qs}`, { cache: 'no-store' })
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
          setSettled({ key, error: body.error ?? 'Failed to load sales returns.' });
        }
      })
      .catch(() => {
        if (!stale) setSettled({ key, error: 'Network error.' });
      });

    return () => {
      stale = true;
    };
    // `page` is only read to detect the server's clamp, which is already part of requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Any filter change goes back to the first page.
  const changeRange = (next: DateRangeValue) => {
    setRange(next);
    setPage(1);
  };
  const changeStore = (next: number | null) => {
    setStoreId(next);
    setPage(1);
  };
  const changeSearch = (next: string) => {
    setSearch(next);
    setPage(1);
  };
  const clearFilters = () => {
    setStoreId(null);
    setSearch('');
    setPage(1);
  };

  const rows = data?.rows ?? [];
  const filtered = storeId != null || search.trim() !== '';
  const firstRow = data && data.matching > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? (data.page - 1) * data.pageSize + rows.length : 0;

  return (
    <div className="min-h-full bg-slate-50">
      {lightbox && (
        <PhotoLightbox
          title={lightbox.title}
          photos={lightbox.photos}
          index={lightbox.index}
          onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Operations
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Sales Return</h1>
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
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {data && !error && <KpiStrip items={salesReturnKpis(data.summary)} />}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <StoreCombobox
            stores={stores}
            value={storeId}
            onChange={changeStore}
            loading={stores.length === 0 && loading}
            allLabel="Semua toko"
            accent="emerald"
            className="sm:w-80"
          />

          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              placeholder="Search receipt no., staff, store…"
              aria-label="Search sales returns"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm placeholder-slate-400 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100"
            />
            {search && (
              <button
                type="button"
                onClick={() => changeSearch('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-300 hover:text-slate-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
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
              {filtered ? 'No sales returns match your filter in this period.' : 'No sales returns in this period.'}
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
              <SalesReturnsTable
                rows={rows}
                startIndex={(data.page - 1) * data.pageSize}
                variant="finance"
                onOpenPhoto={(r, index) =>
                  setLightbox({
                    title: `${r.storeNo} · ${r.receiptNumber}`,
                    photos: r.imageUrls.map((url, n) => ({ url, label: `Struk ${n + 1}` })),
                    index,
                  })
                }
              />
            </div>

            {/* Pager */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <p>
                Showing <span className="font-semibold tabular-nums">{firstRow}–{lastRow}</span> of{' '}
                <span className="font-semibold tabular-nums">{data.matching}</span> sales return
                {data.matching === 1 ? '' : 's'}
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
              Tanggal = saat karyawan mengunggah struk, dan <span className="font-semibold">Diunggah Oleh</span> adalah
              akun yang login saat itu — keduanya tercatat otomatis. <span className="font-semibold">No. Struk</span>{' '}
              diketik karyawan dari struk retur; klik foto untuk memperbesar.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

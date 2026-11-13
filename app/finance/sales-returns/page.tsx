'use client';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
// app/finance/sales-returns/page.tsx
//
// Finance · Sales Return
//
// Filter and sort across the full result before pagination. Open a row to compare
// old/new receipts side by side, with keyboard navigation across page boundaries.
// Legacy submissions retain their unclassified receipt numbers/photos.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileSpreadsheet, RefreshCw, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SalesReturnsTable, salesReturnKpis, useDebouncedValue } from '@/components/sales-returns/shared';
import {
  KpiStrip,
  RangePicker,
  thisMonthRange,
  type DateRangeValue,
} from '@/components/finance/shared/sheet-kit';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { SalesReturnDetailModal } from '@/components/sales-returns/SalesReturnDetailModal';
import { SALES_RETURN_SEARCH_MAX, SALES_RETURN_SORT_LABELS, type SalesReturnSortKey,
  type SalesReturnRow, type SalesReturnsPage, type SalesReturnStoreOption } from '@/lib/sales-returns';

export default function FinanceSalesReturnsPage() {
  const [range, setRange] = useState<DateRangeValue>(thisMonthRange);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SalesReturnSortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
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

  const [selected, setSelected] = useState<{ row: SalesReturnRow; position: number } | null>(null);
  const pendingNavigation = useRef<'first' | 'last' | null>(null);

  const query = new URLSearchParams({ from: range.from, to: range.to, page: String(page) });
  if (storeId != null) query.set('storeId', String(storeId));
  if (q) query.set('q', q);
  if (areaId != null) query.set('areaId', String(areaId));
  query.set('sort', sort.key);
  query.set('dir', sort.dir);
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
          if (pendingNavigation.current) {
            const index = pendingNavigation.current === 'first' ? 0 : body.rows.length - 1;
            setSelected(body.rows[index] ? { row: body.rows[index], position: (body.page - 1) * body.pageSize + index + 1 } : null);
            pendingNavigation.current = null;
          }
          // The server clamps a page past the end (rows vanished after a reload).
          if (body.page !== page) setPage(body.page);
        } else {
          pendingNavigation.current = null;
          setSettled({ key, error: body.error ?? 'Gagal memuat retur penjualan.' });
        }
      })
      .catch(() => {
        if (!stale) {
          pendingNavigation.current = null;
          setSettled({ key, error: 'Koneksi bermasalah. Coba lagi.' });
        }
      });

    return () => {
      stale = true;
    };
    // `page` is only read to detect the server's clamp, which is already part of requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Any filter change goes back to the first page.
  const changeRange = (next: DateRangeValue) => {
    closeDetail();
    setRange(next);
    setPage(1);
  };
  const changeStore = (next: number | null) => {
    closeDetail();
    setStoreId(next);
    setPage(1);
  };
  const changeSearch = (next: string) => {
    closeDetail();
    setSearch(next);
    setPage(1);
  };
  const clearFilters = () => {
    closeDetail();
    setAreaId(null);
    setStoreId(null);
    setSearch('');
    setPage(1);
  };

  const rows = data?.rows ?? [];
  const filtered = storeId != null || areaId != null || search.trim() !== '';
  const firstRow = data && data.matching > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? (data.page - 1) * data.pageSize + rows.length : 0;

  function closeDetail() {
    pendingNavigation.current = null;
    setSelected(null);
  }
  function changeArea(next: number | null) {
    closeDetail();
    setAreaId(next);
    setStoreId(null);
    setPage(1);
  }
  function changeSort(next: typeof sort) {
    closeDetail();
    setSort(next);
    setPage(1);
  }
  function openDetail(row: SalesReturnRow) {
    if (loading || !data) return;
    setSelected({ row, position: (data.page - 1) * data.pageSize + rows.findIndex((r) => r.id === row.id) + 1 });
  }
  function navigate(direction: -1 | 1) {
    if (!selected || !data || loading) return;
    const index = rows.findIndex((r) => r.id === selected.row.id);
    const next = rows[index + direction];
    if (next) setSelected({ row: next, position: selected.position + direction });
    else if (data.page + direction >= 1 && data.page + direction <= data.totalPages) {
      pendingNavigation.current = direction === 1 ? 'first' : 'last';
      setPage(data.page + direction);
      setReloadKey((k) => k + 1);
    }
  }
  const activeChips = [
    ...(areaId != null ? [{ key: 'area', label: data?.areas.find((a) => a.id === areaId)?.name ?? 'Area', clear: () => changeArea(null) }] : []),
    ...(storeId != null ? [{ key: 'store', label: stores.find((s) => s.id === storeId)?.storeNo ?? 'Toko', clear: () => changeStore(null) }] : []),
    ...(search.trim() ? [{ key: 'search', label: `Cari: ${search.trim()}`, clear: () => changeSearch('') }] : []),
  ];

  return (
    <div className="min-h-full bg-slate-50">
      {selected && data && <SalesReturnDetailModal row={selected.row} position={selected.position}
        total={data.matching} busy={loading} error={error} onNavigate={navigate} onClose={closeDetail} />}

      {/* Header */}
      <PanelPageHeader
        scope="Finance · Operations"
        title="Sales Return"
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
              Muat ulang
            </button>
          </div>
        }
      />

      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {/* Key numbers */}
        {data && !error && <KpiStrip items={salesReturnKpis(data.summary)} />}

        {/* Filters */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 p-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => changeSearch(e.target.value)}
                placeholder="Cari struk lama / baru, pengunggah, toko…"
                aria-label="Cari retur penjualan"
                maxLength={SALES_RETURN_SEARCH_MAX}
                className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-8 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => changeSearch('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-300 hover:text-slate-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <StoreCombobox stores={stores.filter((s) => areaId == null || s.areaId === areaId)} value={storeId}
              onChange={changeStore} loading={stores.length === 0 && loading} allLabel="Semua toko" accent="emerald"
              className="h-9 w-60 max-w-none rounded-md border-slate-300 shadow-none" />
            <select aria-label="Filter area" value={areaId ?? ''} onChange={(e) => changeArea(e.target.value ? Number(e.target.value) : null)}
              className="h-9 max-w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-100">
              <option value="">Semua area</option>
              {data?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
              <label htmlFor="return-sort" className="flex items-center gap-1.5 pl-2.5 text-slate-500"><ArrowUpDown className="h-3.5 w-3.5" /><span className="sr-only">Urutkan retur</span></label>
              <select id="return-sort" value={sort.key} onChange={(e) => { const key = e.target.value as SalesReturnSortKey; changeSort({ key, dir: key === 'date' ? 'desc' : 'asc' }); }}
                className="min-w-0 cursor-pointer bg-transparent pl-1.5 pr-2 text-sm font-medium text-slate-700 focus:outline-none">
                {Object.entries(SALES_RETURN_SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <button type="button" onClick={() => changeSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
                aria-label={sort.dir === 'asc' ? 'Urutan naik; ubah ke turun' : 'Urutan turun; ubah ke naik'}
                title={sort.dir === 'asc' ? 'Naik (A → Z, lama → baru)' : 'Turun (Z → A, baru → lama)'}
                className="flex w-9 items-center justify-center border-l border-slate-300 text-slate-600 hover:bg-slate-50">
                {sort.dir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {activeChips.length > 0 && <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-2 py-1.5">
            {activeChips.map((chip) => <span key={chip.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 py-1 pl-2.5 pr-1 text-xs font-medium text-emerald-800">
              <span className="truncate">{chip.label}</span><button type="button" onClick={chip.clear} aria-label={`Hapus filter ${chip.label}`} className="rounded-full p-0.5 hover:bg-emerald-100"><X className="h-3.5 w-3.5" /></button>
            </span>)}
            <button type="button" onClick={clearFilters} className="ml-auto px-1 text-xs font-semibold text-slate-500 hover:text-slate-800">Reset filter</button>
          </div>}
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
              {filtered ? 'Tidak ada retur yang sesuai filter pada periode ini.' : 'Belum ada retur pada periode ini.'}
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
                onOpenDetail={openDetail}
                onOpenPhoto={openDetail}
              />
            </div>

            {/* Pager */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <p>
                Menampilkan <span className="font-semibold tabular-nums">{firstRow}–{lastRow}</span> dari{' '}
                <span className="font-semibold tabular-nums">{data.matching}</span> retur
              </p>

              {data.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={loading || data.page <= 1}
                    aria-label="Halaman sebelumnya"
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
                    aria-label="Halaman berikutnya"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              Tanggal = saat karyawan mengunggah struk, dan <span className="font-semibold">Diunggah Oleh</span> adalah
              akun yang login saat itu; keduanya tercatat otomatis. Klik baris atau Detail untuk membandingkan
              struk lama dan baru. Gunakan tombol ← / → untuk berpindah retur sesuai filter dan urutan.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

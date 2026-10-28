'use client';
// app/finance/store-sheet/page.tsx
//
// Finance · Daily Report All Store
//
// Pick a store first; then every day of the period for that store, laid out like Finance's
// Excel: Setoran cash (Harus Disetor / Sales Cash / Tidak Disetor / Setoran Tunai / Catatan),
// then BCA, Mandiri, BRI, OCBC and Indodana — one total each — and OP/ME/VOUCHER. Clicking a row
// opens that day's detail (components/finance/store-sheet/DayDetailPanel.tsx): who submitted the
// Setoran and the Store Closing, each bank's total, the proof photos. The sheet itself is
// ExcelSheet.tsx, its columns lib/store-money-sheet.ts, the data /api/finance/store-sheet (+ /day
// for the detail). "Export Excel" downloads the same sheet (/export, lib/store-money-sheet-xlsx.ts).

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, MousePointerClick, RefreshCw } from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { RangePicker, downloadXlsx, thisMonthRange, type DateRangeValue } from '@/components/finance/shared/sheet-kit';
import DayDetailPanel from '@/components/finance/store-sheet/DayDetailPanel';
import ExcelSheet from '@/components/finance/store-sheet/ExcelSheet';
import { fmtRange } from '@/lib/finance/dates';
import type { MoneyStoreOption } from '@/lib/store-closing-money';
import { sheetRows, type StoreMoneySheet } from '@/lib/store-money-sheet';
import { cn } from '@/lib/utils';

export default function FinanceStoreSheetPage() {
  const [range, setRange] = useState<DateRangeValue>(thisMonthRange);
  const [storeId, setStoreId] = useState<number | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [stores, setStores] = useState<MoneyStoreOption[]>([]);
  // The answer to one request; `loading` is simply "the answer in hand is for an older request".
  const [result, setResult] = useState<{ key: string; sheet: StoreMoneySheet | null; error: string | null } | null>(null);

  // Without a store the request only asks for the store list, whatever the period is.
  const qs =
    storeId == null
      ? ''
      : new URLSearchParams({ storeId: String(storeId), from: range.from, to: range.to }).toString();
  const requestKey = `${qs}#${reloadKey}`;
  const loading = result?.key !== requestKey;
  const error = loading ? null : (result?.error ?? null);

  useEffect(() => {
    let stale = false;

    fetch(`/api/finance/store-sheet${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          setStores(body.stores);
          setResult({ key: requestKey, sheet: body, error: null });
        } else {
          setResult({ key: requestKey, sheet: null, error: body.error ?? 'Gagal memuat data.' });
        }
      })
      .catch(() => { if (!stale) setResult({ key: requestKey, sheet: null, error: 'Network error.' }); });

    return () => { stale = true; };
  }, [qs, requestKey]);

  const current = !loading && result?.sheet?.store ? result.sheet : null;
  const lines = useMemo(
    () => (current?.store ? sheetRows(current.store, current.from, current.to, current.rows, current.openingSisa) : []),
    [current],
  );

  async function exportExcel() {
    if (!current?.store) return;
    setExporting(true);
    try {
      await downloadXlsx(
        `/api/finance/store-sheet/export?${new URLSearchParams({ storeId: String(current.store.id), from: current.from, to: current.to })}`,
        `daily-report_${current.store.storeNo}_${current.from}_${current.to}.xlsx`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengekspor Excel.');
    } finally {
      setExporting(false);
    }
  }

  // The row whose detail is open, and the days ‹ › can step through (the ones that have data).
  const [openDate, setOpenDate] = useState<string | null>(null);
  const dataDays = useMemo(() => lines.filter((l) => l.data).map((l) => l.salesDate), [lines]);
  const openIndex = openDate ? dataDays.indexOf(openDate) : -1;
  const step = (dir: -1 | 1) => {
    const next = dataDays[openIndex + dir];
    if (next) setOpenDate(next);
  };

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="Finance · Operations"
        title="Daily Report All Store"
        actions={
          storeId != null ? (
            <div className="flex flex-wrap items-center gap-2">
              <RangePicker value={range} onChange={setRange} />
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
                onClick={exportExcel}
                disabled={!current?.store || exporting}
                title="Unduh sheet ini sebagai file Excel"
                className="flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export Excel
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="space-y-4 px-6 py-5 lg:px-8">
        {/* Store first */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StoreCombobox
            stores={stores}
            value={storeId}
            onChange={setStoreId}
            loading={stores.length === 0 && loading}
            accent="emerald"
            className="sm:w-96"
          />
          {current?.store && (
            <p className="text-xs text-slate-500">
              {fmtRange(current.from, current.to)} · klik satu baris untuk melihat detail, siapa yang submit, dan foto buktinya
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {storeId == null ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white py-20 text-center">
            <MousePointerClick className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">Pilih toko terlebih dahulu</p>
            <p className="mt-1 text-xs text-slate-500">
              Setoran cash, BCA, Mandiri, BRI, OCBC, Indodana dan OP/ME/VOUCHER toko itu akan tampil per hari.
            </p>
          </div>
        ) : !current ? (
          !error && (
            <div className="flex h-64 items-center justify-center rounded-md border border-slate-300 bg-white text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Memuat daily report…
            </div>
          )
        ) : (
          <>
            {current.rows.length === 0 && (
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-400" />
                Belum ada Store Closing atau Setoran untuk penjualan {fmtRange(current.from, current.to)}.
              </div>
            )}

            <ExcelSheet
              key={`${current.store?.id}:${current.from}:${current.to}`}
              rows={lines}
              sheetName={current.store ? `${current.store.storeNo} · ${current.store.name}` : ''}
              activeDate={openDate}
              onOpen={setOpenDate}
            />

            {current.store && (
              <DayDetailPanel
                storeId={current.store.id}
                date={openDate}
                onClose={() => setOpenDate(null)}
                onStep={step}
                hasPrev={openIndex > 0}
                hasNext={openIndex >= 0 && openIndex < dataDays.length - 1}
              />
            )}

            <div className="space-y-1 text-[11px] text-slate-500">
              <p>
                Satu baris = satu <span className="font-semibold">Tanggal Sales</span>. Kolom bank dan OP/ME/VOUCHER diambil dari Store
                Closing hari itu (satu kolom per bank = total QRIS + Debit + Credit). Kolom cash diambil dari Setoran yang disubmit toko
                pagi berikutnya (<span className="font-semibold">Tanggal Setoran</span>).
              </p>
              <p>
                Sales Cash = uang diterima · Harus Disetor = uang diterima + sisa kemarin · Tidak Disetor = Harus Disetor − Setoran
                Tunai. Hari tanpa setoran menampilkan <span className="font-semibold italic text-slate-400">sisa terakhir</span> (miring,
                abu-abu) yang masih dibawa sampai setoran berikutnya. Total Sales = Sales Cash + semua bank + OP/ME/VOUCHER; setoran yang
                masih draft belum dihitung.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
// app/finance/store-closing/report/page.tsx
//
// Finance · Store Closing · Report
//
// The money the stores report, one row per store per sales day — the sheet
// Finance used to keep in Excel:
//   Kode · Store · Total Sales · Tanggal Sales · Tanggal Setoran
//   CASH             — from the Setoran the store submitted the next morning
//                      (Uang diterima / Sisa kemarin / Wajib disetor / Disetor / Sisa)
//   SETTLEMENT CARD  — from the Store Closing of the sales day, per bank
//   OTHER            — OP/ME/VOUCHER
// Total Sales = cash received + every bank + OP/ME/VOUCHER. A dash means that
// side was never submitted for the day.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { EDC_BANKS, OP_ME_VOUCHER_LABEL } from '@/lib/store-closing-edc';
import {
  fmtDateShort,
  fmtRange,
  groupRowsByCode,
  hasSalesFigure,
  sumMoney,
  totalSales,
  type ClosingMoneyRow,
  type MoneyStoreOption,
} from '@/lib/store-closing-money';
import {
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';
import {
  CodeChips,
  KpiStrip,
  RangePicker,
  downloadXlsx,
  thisMonthRange,
  type DateRangeValue,
} from '@/components/finance/shared/sheet-kit';
import { StoreCombobox } from '@/components/shared/store-combobox';

const CASH_COLS = 6; // Uang diterima · Sisa kemarin · Wajib disetor · Disetor · Sisa · Catatan
const HEAD2_TOP = 30; // px — the second header row sticks right under the first

// ─── Cells ───────────────────────────────────────────────────────────────────

const AMOUNT = 'whitespace-nowrap text-right tabular-nums';

/** An amount; null = never submitted (dash), a typed 0 reads grey. */
function Amount({ value, strong }: { value: number | null | undefined; strong?: boolean }) {
  if (value == null) return <span className="text-slate-300">–</span>;
  return (
    <span className={cn(value === 0 ? 'text-slate-400' : strong ? 'font-bold text-slate-900' : 'text-slate-800')}>
      {num(value)}
    </span>
  );
}

function MoneyRow({ row, index, newStore }: { row: ClosingMoneyRow; index: number; newStore: boolean }) {
  const s = row.setoran;
  const top = newStore ? 'border-t-2 border-t-slate-300' : '';
  const cashTitle = s ? undefined : `Setoran tanggal ${fmtDateShort(row.setoranDate)} belum disubmit`;
  const cardTitle = row.hasClosing ? undefined : `Store Closing tanggal ${fmtDateShort(row.salesDate)} belum ada`;

  return (
    <tr className="bg-white text-[13px] hover:bg-emerald-50/40">
      <td className={cn(ROW_HEAD, 'w-11', top)}>{index}</td>
      <td className={cn(TD, top, 'w-20 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
      <td className={cn(TD, top, 'min-w-56')}>
        <p className="font-medium text-slate-900">{row.storeName}</p>
        <p className="text-[11px] text-slate-500">{row.areaName}</p>
      </td>
      <td className={cn(TD, top, AMOUNT, 'w-32 bg-emerald-50/50 font-bold')}>
        {/* A day with nothing on either side has no sales figure yet — a dash, not a 0. */}
        <Amount value={hasSalesFigure(row) ? totalSales(row) : null} strong />
      </td>
      <td className={cn(TD, top, 'w-28 whitespace-nowrap text-center text-xs text-slate-700')}>{fmtDateShort(row.salesDate)}</td>
      <td className={cn(TD, top, 'w-28 whitespace-nowrap text-center text-xs text-slate-700')}>{fmtDateShort(row.setoranDate)}</td>

      <td className={cn(TD, top, AMOUNT, 'w-32')} title={cashTitle}><Amount value={s?.received} /></td>
      <td className={cn(TD, top, AMOUNT, 'w-28')} title={cashTitle}><Amount value={s?.carryIn} /></td>
      <td className={cn(TD, top, AMOUNT, 'w-32')} title={cashTitle}><Amount value={s?.required} /></td>
      <td className={cn(TD, top, AMOUNT, 'w-32')} title={cashTitle}><Amount value={s?.stored} /></td>
      <td className={cn(TD, top, AMOUNT, 'w-28', (s?.unpaid ?? 0) > 0 && 'bg-amber-50')} title={cashTitle}>
        {s && s.unpaid > 0 ? <span className="font-semibold text-amber-800">{num(s.unpaid)}</span> : <Amount value={s?.unpaid} />}
      </td>
      <td className={cn(TD, top, 'min-w-44 max-w-xs')}>
        {s?.notes ? (
          <span className="line-clamp-2 text-xs text-slate-700" title={s.notes}>{s.notes}</span>
        ) : s?.isNoSetoran ? (
          <span className="text-xs italic text-slate-400">Tanpa setoran</span>
        ) : (
          <span className="text-slate-300">–</span>
        )}
      </td>

      {EDC_BANKS.map((b) => (
        <td key={b.code} className={cn(TD, top, AMOUNT, 'w-28')} title={cardTitle}><Amount value={row.banks[b.code]} /></td>
      ))}
      <td className={cn(TD, top, AMOUNT, 'w-32')} title={cardTitle}><Amount value={row.opMeVoucher} /></td>
    </tr>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinanceStoreClosingReportPage() {
  const [range, setRange] = useState<DateRangeValue>(thisMonthRange);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<ClosingMoneyRow[]>([]);
  const [stores, setStores] = useState<MoneyStoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (storeId != null) query.set('storeId', String(storeId));
  const qs = query.toString();

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);

    fetch(`/api/finance/store-closing/money?${qs}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          setRows(body.rows);
          // Narrowed to one store the API only lists that store — keep the full dropdown.
          setStores((prev) => (storeId == null || prev.length === 0 ? body.stores : prev));
        } else {
          setError(body.error ?? 'Gagal memuat data.');
        }
      })
      .catch(() => { if (!stale) setError('Network error.'); })
      .finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
    // storeId is part of qs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, reloadKey]);

  const allGroups = useMemo(() => groupRowsByCode(rows), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (code && r.code !== code) return false;
      if (!q) return true;
      return [r.storeNo, r.storeName, r.areaName, r.setoran?.notes].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, code, search]);

  const totals = useMemo(() => sumMoney(visible), [visible]);
  const filtered = Boolean(code || search || storeId != null);

  async function exportExcel() {
    setExporting(true);
    try {
      const exportQs = new URLSearchParams(query);
      if (code) exportQs.set('code', code);
      await downloadXlsx(`/api/finance/store-closing/money/export?${exportQs}`, `store-closing-report_${range.from}_${range.to}.xlsx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunduh Excel.');
    } finally {
      setExporting(false);
    }
  }

  const totalCell = 'sticky bottom-0 z-10 whitespace-nowrap border-r border-t border-slate-300 bg-slate-100 px-2.5 py-2 text-right text-xs font-bold tabular-nums text-slate-700';
  const band = 'sticky top-0 z-10 border-b border-r border-slate-300 px-2.5 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest';
  // Second header row: SHEET_TH sticks at top-0, so it needs its own offset.
  const head2 = { top: HEAD2_TOP } as const;

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <PanelPageHeader
        scope="Finance · Operations"
        title="Store Closing · Report"
        actions={
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
              onClick={() => void exportExcel()}
              disabled={exporting || loading || rows.length === 0}
              className="flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          </div>
        }
      />

      <div className="space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {!loading && !error && (
          <KpiStrip
            items={[
              { label: 'Total Sales', value: rp(totals.totalSales), sub: `${totals.rows} baris · ${fmtRange(range.from, range.to)}` },
              { label: 'Cash diterima', value: rp(totals.received), sub: 'dari Setoran hari berikutnya' },
              { label: 'Card + OP/ME/VOUCHER', value: rp(totals.cardTotal), sub: `bank ${rp(totals.bankTotal)} · ${OP_ME_VOUCHER_LABEL} ${rp(totals.opMeVoucher)}` },
              { label: 'Disetor', value: rp(totals.stored), sub: `wajib disetor ${rp(totals.required)}` },
              { label: 'Sisa belum disetor', value: rp(totals.unpaid), sub: 'dibawa ke setoran berikutnya', warn: totals.unpaid > 0 },
              { label: 'Belum lengkap', value: String(totals.noSetoran + totals.noClosing), sub: `${totals.noSetoran} tanpa setoran · ${totals.noClosing} tanpa Store Closing`, warn: totals.noSetoran + totals.noClosing > 0 },
            ]}
          />
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <StoreCombobox
            stores={stores}
            value={storeId}
            onChange={(id) => { setStoreId(id); setCode(null); }}
            loading={stores.length === 0 && loading}
            allLabel="Semua toko"
            accent="emerald"
            className="sm:w-72"
          />

          {storeId == null && <CodeChips groups={allGroups} total={rows.length} active={code} onPick={setCode} />}

          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search store, area, catatan…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          {filtered && (
            <button
              type="button"
              onClick={() => { setStoreId(null); setCode(null); setSearch(''); }}
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
        {loading ? (
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
            <div className="h-9 animate-pulse bg-slate-100" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
            ))}
          </div>
        ) : visible.length === 0 && !error ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white py-16 text-center">
            <FileSpreadsheet className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {filtered ? 'No rows match your filter.' : `Belum ada Store Closing atau Setoran untuk penjualan ${fmtRange(range.from, range.to)}.`}
            </p>
          </div>
        ) : (
          <>
            <div className="max-h-[68vh] overflow-auto [scrollbar-gutter:stable] rounded-md border border-slate-300 bg-white">
              <table className="w-full min-w-[2000px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr style={{ height: HEAD2_TOP }}>
                    <th colSpan={6} className={cn(band, 'bg-slate-100 text-slate-500')} />
                    <th colSpan={CASH_COLS} className={cn(band, 'bg-emerald-100 text-emerald-800')}>Cash</th>
                    <th colSpan={EDC_BANKS.length} className={cn(band, 'bg-sky-100 text-sky-800')}>Settlement Card</th>
                    <th colSpan={1} className={cn(band, 'bg-violet-100 text-violet-800')}>Other</th>
                  </tr>
                  <tr>
                    <th style={head2} className={cn(TH, 'w-11 text-center')}>No</th>
                    <th style={head2} className={cn(TH, 'text-left')}>Kode</th>
                    <th style={head2} className={cn(TH, 'text-left')}>Store</th>
                    <th style={head2} className={cn(TH, 'text-right')}>Total Sales</th>
                    <th style={head2} className={cn(TH, 'text-center')}>Tanggal Sales</th>
                    <th style={head2} className={cn(TH, 'text-center')}>Tanggal Setoran</th>
                    <th style={head2} className={cn(TH, 'text-right')}>Uang diterima</th>
                    <th style={head2} className={cn(TH, 'text-right')}>Sisa kemarin</th>
                    <th style={head2} className={cn(TH, 'text-right')}>Wajib disetor</th>
                    <th style={head2} className={cn(TH, 'text-right')}>Disetor</th>
                    <th style={head2} className={cn(TH, 'text-right')}>Sisa</th>
                    <th style={head2} className={cn(TH, 'text-left')}>Catatan</th>
                    {EDC_BANKS.map((b) => (
                      <th key={b.code} style={head2} className={cn(TH, 'text-right')}>{b.label}</th>
                    ))}
                    <th style={head2} className={cn(TH, 'text-right')}>{OP_ME_VOUCHER_LABEL}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <MoneyRow key={r.key} row={r} index={i + 1} newStore={i > 0 && visible[i - 1].storeId !== r.storeId} />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="sticky bottom-0 z-10 border-r border-t border-slate-300 bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-600">
                      Total · {totals.rows} baris{filtered ? ' (sesuai filter)' : ''}
                    </td>
                    <td className={cn(totalCell, 'bg-emerald-100 text-emerald-900')}>{num(totals.totalSales)}</td>
                    <td colSpan={2} className="sticky bottom-0 z-10 border-r border-t border-slate-300 bg-slate-100" />
                    <td className={totalCell}>{num(totals.received)}</td>
                    <td className={totalCell}>{num(totals.carryIn)}</td>
                    <td className={totalCell}>{num(totals.required)}</td>
                    <td className={totalCell}>{num(totals.stored)}</td>
                    <td className={totalCell}>{num(totals.unpaid)}</td>
                    <td className="sticky bottom-0 z-10 border-r border-t border-slate-300 bg-slate-100" />
                    {EDC_BANKS.map((b) => (
                      <td key={b.code} className={totalCell}>{num(totals.banks[b.code])}</td>
                    ))}
                    <td className={totalCell}>{num(totals.opMeVoucher)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="space-y-1 text-[11px] text-slate-500">
              <p>
                Satu baris = satu toko pada satu <span className="font-semibold">Tanggal Sales</span>. Kolom{' '}
                <span className="font-semibold text-sky-700">Settlement Card</span> dan{' '}
                {OP_ME_VOUCHER_LABEL} diambil dari Store Closing hari itu (semua metode QRIS + Debit + Credit dijumlahkan);
                kolom <span className="font-semibold text-emerald-700">Cash</span> diambil dari Setoran yang disubmit toko
                pagi berikutnya (<span className="font-semibold">Tanggal Setoran</span>) — &ldquo;uang aktual diterima kemarin&rdquo;.
              </p>
              <p>
                Total Sales = Uang diterima + semua bank + {OP_ME_VOUCHER_LABEL}. Wajib disetor = Uang diterima + Sisa kemarin;
                Sisa = Wajib disetor − Disetor (dibawa ke setoran berikutnya). Tanda – berarti sisi itu belum disubmit
                (arahkan kursor ke sel untuk melihat yang mana). Setoran yang masih draft belum dihitung.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

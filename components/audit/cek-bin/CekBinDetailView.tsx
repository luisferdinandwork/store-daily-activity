'use client';
// components/audit/cek-bin/CekBinDetailView.tsx — Audit "Hasil Cek Bin" → one store's Cek Bin of one day, PER BIN.
//
// The whole Business Central answer (ppBinContentCheckHeaders + lines), grouped by bin: each bin says Benar / Salah
// (a bin is wrong when one of its items is — the report counts bins the same way), how many items are wrong and why
// (BC's own status names). Wrong bins come first and are open; inside a bin the WRONG items are listed first and
// highlighted (the cell that shows the mistake is marked), the right items sit behind "Tampilkan N item benar".
// Wide (container @3xl): one table with the API's own column names; phone: a card per item. Search, bin verdict chips,
// mistake (reason) chips, sort. Data: GET /api/audit/cek-bin/detail (lib/audit-bin-detail.ts).

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Boxes, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, RefreshCw, ScanLine, Search, XCircle } from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { cn } from '@/lib/utils';
import { TONES, rateTone } from '@/lib/status-theme';
import { longDateId } from '@/lib/audit-cash-check';
import { BIN_CHECK_REASON_META, type BinCheckReason } from '@/lib/bin-check';
import {
  BIN_DETAIL_COLUMNS,
  BIN_SORT_LABEL,
  actualBins,
  binDetailTotals,
  binViews,
  detailSku,
  lineHighlights,
  reasonCounts,
  type BinDetail,
  type BinDetailBin,
  type BinDetailLine,
  type BinSort,
  type BinVerdictFilter,
  type BinView,
} from '@/lib/audit-bin-detail';
import { formatAccuracy } from '@/lib/audit-bin-report';
import { fetchJson } from '@/components/audit/cash-check/kit';
import SoTabs from '@/components/audit/stock-opname/SoTabs';

interface Loaded extends BinDetail {
  key: string;
  state: 'ok' | 'not_configured' | 'unavailable';
  fetchedAt: string | null;
  store: { id: number; storeNo: string; name: string; areaName: string | null } | null;
  error: string | null;
}

/** Bins shown before "Tampilkan lagi". */
const PAGE_BINS = 40;

/** Each mistake keeps one colour on this page (chip, stripe of the highlighted row). */
const REASON_TONE: Record<BinCheckReason, keyof typeof TONES> = {
  qty_lower: 'warning',
  qty_higher: 'info',
  misplaced: 'active',
  not_scanned: 'sick',
  not_found: 'danger',
  unknown: 'neutral',
};

/** The table's columns: the bin is the group row, so `binCode` is not repeated per item. */
const ITEM_COLUMNS = BIN_DETAIL_COLUMNS.filter((c) => c !== 'binCode');

const nf = (n: number | null) => (n == null ? '—' : n.toLocaleString('id-ID'));

export default function CekBinDetailView({ storeId, date }: { storeId: number; date: string }) {
  const router = useRouter();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Loaded | null>(null);
  const [verdict, setVerdict] = useState<BinVerdictFilter>('all');
  const [reason, setReason] = useState<BinCheckReason | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<BinSort>('wrong');
  const [withUnscanned, setWithUnscanned] = useState(false);
  const [limit, setLimit] = useState(PAGE_BINS);
  /** Bins the auditor opened / closed by hand (otherwise: wrong bins open, right bins closed). */
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  /** Wrong bins whose right items are shown too. */
  const [showRight, setShowRight] = useState<Set<string>>(new Set());

  const key = `${storeId}|${date}|${reload}`;
  useEffect(() => {
    let alive = true;
    const refresh = reload > 0 ? '&refresh=1' : '';
    fetchJson<Omit<Loaded, 'key' | 'error'>>(`/api/audit/cek-bin/detail?storeId=${storeId}&date=${date}${refresh}`)
      .then((d) => alive && setData({ ...d, key, error: null }))
      .catch((e) =>
        alive && setData({ key, state: 'unavailable', fetchedAt: null, store: null, lines: [], bins: [], extraColumns: [], error: e instanceof Error ? e.message : 'Gagal memuat.' }),
      );
    return () => {
      alive = false;
    };
  }, [storeId, date, reload, key]);

  const loading = data?.key !== key;
  const detail = useMemo<BinDetail>(() => (loading || !data ? { lines: [], bins: [], extraColumns: [] } : data), [loading, data]);
  const totals = useMemo(() => binDetailTotals(detail), [detail]);
  const store = data?.store;

  const views = useMemo(() => binViews(detail, { verdict, reason, query: search, withUnscanned, sort }), [detail, verdict, reason, search, withUnscanned, sort]);
  const reasons = useMemo(() => reasonCounts(detail.bins.filter((b) => b.checked)), [detail.bins]);
  const filtering = search.trim() !== '' || reason != null;

  const isOpen = (v: BinView) => openOverride[v.bin.binCode] ?? (filtering || (v.bin.checked && v.bin.wrong > 0));
  const toggleBin = (v: BinView) => setOpenOverride((prev) => ({ ...prev, [v.bin.binCode]: !isOpen(v) }));
  const setAll = (open: boolean) => setOpenOverride(Object.fromEntries(views.map((v) => [v.bin.binCode, open])));
  const anyClosed = views.some((v) => !isOpen(v));
  const rightShown = (v: BinView) => v.wrongLines.length === 0 || filtering || showRight.has(v.bin.binCode);
  const toggleRight = (bin: string) =>
    setShowRight((prev) => {
      const next = new Set(prev);
      if (next.has(bin)) next.delete(bin);
      else next.add(bin);
      return next;
    });

  // A filter change starts the list at the top again.
  const resetLimit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setLimit(PAGE_BINS);
  };

  const shown = views.slice(0, limit);
  const goBack = () => (window.history.length > 1 ? router.back() : router.push('/audit/cek-bin'));
  const colCount = 2 + ITEM_COLUMNS.length + detail.extraColumns.length;

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="Audit · Hasil Cek Bin"
        title={<><ScanLine />Detail Cek Bin</>}
        subtitle={store ? `${store.storeNo} · ${store.name} · ${longDateId(date)}` : longDateId(date)}
        tabs={<SoTabs />}
        hideTabsOnPhone
        compactActions
        actions={
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            disabled={loading}
            aria-label="Muat ulang"
            className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50 md:w-auto md:px-3"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> <span className="hidden md:inline">Muat ulang</span>
          </button>
        }
      />

      <div className="space-y-3 p-3 sm:space-y-4 sm:p-6 lg:p-8">
        <button type="button" onClick={goBack} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 md:min-h-9">
          <ArrowLeft className="h-4 w-4" /> Hasil Cek Bin
        </button>

        {!loading && data?.error && <Notice tone="danger" title="Gagal memuat" body={data.error} />}
        {!loading && !data?.error && data?.state === 'not_configured' && (
          <Notice tone="warning" title="Business Central belum diatur" body="Login BC untuk Cek Bin (BC_API_BIN_USERNAME / PASSWORD) belum diisi di server." />
        )}
        {!loading && !data?.error && data?.state === 'unavailable' && (
          <Notice tone="danger" title="Data Business Central belum tersedia" body="BC tidak bisa dihubungi saat ini. Coba Muat ulang sebentar lagi." />
        )}

        {/* ── Summary: counted per bin ── */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs" aria-label="Ringkasan">
          <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Akurasi bin</p>
              {loading ? (
                <div className="mt-1.5 h-9 w-24 animate-pulse rounded bg-slate-100" />
              ) : (
                <p className={cn('text-4xl font-extrabold leading-none tabular-nums', totals.accuracy == null ? 'text-slate-300' : TONES[rateTone(totals.accuracy)].strong)}>
                  {formatAccuracy(totals.accuracy)}
                </p>
              )}
              {!loading && <SplitBar correct={totals.correctBins} wrong={totals.wrongBins} className="mt-3 h-2.5" />}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center sm:min-w-[22rem]">
              <Stat icon={CheckCircle2} label="Bin benar" value={loading ? null : nf(totals.correctBins)} valueClass={TONES.success.strong} />
              <Stat icon={XCircle} label="Bin salah" value={loading ? null : nf(totals.wrongBins)} valueClass={totals.wrongBins ? TONES.danger.strong : 'text-slate-400'} />
              <Stat icon={Boxes} label="Bin di-scan" value={loading ? null : nf(totals.bins)} valueClass="text-slate-800" />
            </dl>
          </div>
          {!loading && totals.lines > 0 && (
            <p className="border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500">
              {nf(totals.lines)} item di bin yang di-scan ·{' '}
              <b className={totals.wrongLines ? TONES.danger.strong : undefined}>{nf(totals.wrongLines)} item salah</b> · Σ scan {nf(totals.scanQty)} · Σ bin {nf(totals.binQty)}
              {totals.unscannedBins > 0 && ` · ${totals.unscannedBins} bin di daftar BC belum di-scan`}
            </p>
          )}
        </section>

        {/* ── Filters ── */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={search}
                onChange={(e) => resetLimit(setSearch)(e.target.value)}
                placeholder="Cari bin, SKU, status…"
                className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 sm:text-sm"
                aria-label="Cari"
              />
            </label>
            <select
              value={sort}
              onChange={(e) => resetLimit(setSort)(e.target.value as BinSort)}
              className="h-11 w-36 shrink-0 rounded-xl border border-slate-200 bg-white px-2 text-base font-semibold text-slate-700 outline-none focus:border-amber-400 sm:w-40 sm:text-sm"
              aria-label="Urutkan bin"
            >
              {(Object.keys(BIN_SORT_LABEL) as BinSort[]).map((k) => (
                <option key={k} value={k}>
                  {BIN_SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <Chip active={verdict === 'all'} onClick={() => resetLimit(setVerdict)('all')} label="Semua bin" count={totals.bins} />
            <Chip active={verdict === 'wrong'} onClick={() => resetLimit(setVerdict)('wrong')} label="Bin salah" count={totals.wrongBins} tone="danger" />
            <Chip active={verdict === 'right'} onClick={() => resetLimit(setVerdict)('right')} label="Bin benar" count={totals.correctBins} tone="success" />
            {totals.unscannedBins > 0 && (
              <Chip active={withUnscanned} onClick={() => resetLimit(setWithUnscanned)(!withUnscanned)} label="Bin belum di-scan" count={totals.unscannedBins} />
            )}
          </div>
          {reasons.length > 0 && (
            <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Jenis kesalahan">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Item salah</span>
              {reasons.map((r) => (
                <ReasonChip
                  key={r.reason}
                  reason={r.reason}
                  count={r.count}
                  active={reason === r.reason}
                  onClick={() => resetLimit(setReason)(reason === r.reason ? null : r.reason)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Per bin ── */}
        <div className="@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-800">Hasil per bin</p>
              <p className="text-xs text-slate-400">{loading ? '' : `${nf(views.length)} bin · item salah ditandai merah`}</p>
            </div>
            {!loading && views.length > 0 && (
              <button
                type="button"
                onClick={() => setAll(anyClosed)}
                className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:min-h-8"
              >
                {anyClosed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
                {anyClosed ? 'Buka semua' : 'Tutup semua'}
              </button>
            )}
          </div>

          {loading ? (
            <ul className="divide-y divide-slate-100">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="h-16 animate-pulse bg-slate-50/60" />
              ))}
            </ul>
          ) : views.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <ScanLine className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-600">{detail.bins.length ? 'Tidak ada bin yang cocok' : 'Tidak ada hasil Cek Bin di hari ini'}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {detail.bins.length ? 'Ubah pencarian atau filter.' : 'Business Central tidak punya bin yang di-scan untuk toko ini di tanggal tersebut.'}
              </p>
            </div>
          ) : (
            <>
              {/* Phone: a block per bin, a card per item */}
              <ul className="divide-y divide-slate-200 @3xl:hidden">
                {shown.map((v) => {
                  const open = isOpen(v);
                  const withRight = rightShown(v);
                  return (
                    <li key={v.bin.binCode}>
                      <BinHeader bin={v.bin} open={open} onToggle={() => toggleBin(v)} />
                      {open && (
                        <div className="border-t border-slate-100">
                          {v.wrongLines.length + v.rightLines.length === 0 && <p className="px-4 py-3 text-xs text-slate-400">Tidak ada item di bin ini.</p>}
                          <ul className="divide-y divide-slate-100">
                            {v.wrongLines.map((l) => (
                              <LineCard key={l.no} line={l} />
                            ))}
                            {withRight && v.rightLines.map((l) => <LineCard key={l.no} line={l} />)}
                          </ul>
                          {v.wrongLines.length > 0 && v.rightLines.length > 0 && !filtering && (
                            <RightToggle count={v.rightLines.length} shown={withRight} onClick={() => toggleRight(v.bin.binCode)} />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Wide: one table, the API's column names, a group row per bin */}
              <div className="hidden overflow-x-auto @3xl:block">
                <table className="w-full min-w-max border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-right">No</th>
                      <th className="px-3 py-2">Hasil</th>
                      {ITEM_COLUMNS.map((c) => (
                        <th key={c} className={cn('whitespace-nowrap px-3 py-2 font-mono normal-case', (c === 'scanQuantity' || c === 'binQuantity') && 'text-right')}>
                          {c}
                        </th>
                      ))}
                      {detail.extraColumns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2 font-mono normal-case">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  {shown.map((v) => {
                    const open = isOpen(v);
                    const withRight = rightShown(v);
                    return (
                      <tbody key={v.bin.binCode} className="border-b border-slate-200 last:border-b-0">
                        <tr>
                          <td colSpan={colCount} className="p-0">
                            <BinHeader bin={v.bin} open={open} onToggle={() => toggleBin(v)} />
                          </td>
                        </tr>
                        {open && (
                          <>
                            {v.wrongLines.length + v.rightLines.length === 0 && (
                              <tr className="border-t border-slate-100">
                                <td colSpan={colCount} className="px-4 py-2.5 text-xs text-slate-400">Tidak ada item di bin ini.</td>
                              </tr>
                            )}
                            {v.wrongLines.map((l) => (
                              <LineRow key={l.no} line={l} extraColumns={detail.extraColumns} />
                            ))}
                            {withRight && v.rightLines.map((l) => <LineRow key={l.no} line={l} extraColumns={detail.extraColumns} />)}
                            {v.wrongLines.length > 0 && v.rightLines.length > 0 && !filtering && (
                              <tr className="border-t border-slate-100">
                                <td colSpan={colCount} className="p-0">
                                  <RightToggle count={v.rightLines.length} shown={withRight} onClick={() => toggleRight(v.bin.binCode)} />
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                    );
                  })}
                </table>
              </div>

              {views.length > shown.length && (
                <div className="border-t border-slate-100 p-3">
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + PAGE_BINS)}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 active:bg-slate-100"
                  >
                    Tampilkan {Math.min(PAGE_BINS, views.length - shown.length)} bin lagi ({nf(views.length - shown.length)} tersisa)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {!loading && data?.fetchedAt && (
          <p className="text-[11px] text-slate-400">
            Sumber: Business Central (PP Bin Content Check) · diambil{' '}
            {new Date(data.fetchedAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB. Satu bin
            &quot;salah&quot; bila minimal satu itemnya salah. Kolom memakai nama field API; &quot;Hasil&quot; ditambahkan PRISM dari binContentCheckStatus.
            Field lain yang dikirim BC (mis. harga) muncul sebagai kolom tambahan.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** The bin's line: code, Benar / Salah, what is wrong in it (BC's names), quantities. A button that opens the bin. */
function BinHeader({ bin, open, onToggle }: { bin: BinDetailBin; open: boolean; onToggle: () => void }) {
  const wrong = bin.checked && bin.wrong > 0;
  const reasons = reasonCounts([bin]);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
        wrong ? 'bg-rose-50/40 hover:bg-rose-50/80' : 'hover:bg-slate-50',
        !bin.checked && 'opacity-70',
      )}
    >
      {wrong && <span className={cn('absolute inset-y-0 left-0 w-1', TONES.danger.dot)} aria-hidden />}
      {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all font-mono text-sm font-bold text-slate-900">{bin.binCode}</span>
          <BinChip bin={bin} />
          {wrong && reasons.map((r) => (
            <span key={r.reason} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] font-semibold', TONES[REASON_TONE[r.reason]].chip)}>
              {BIN_CHECK_REASON_META[r.reason].label} <b className="tabular-nums">{r.count}</b>
            </span>
          ))}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">
          {bin.lines} item{bin.checked && bin.wrong > 0 && <> · <b className={TONES.danger.strong}>{bin.wrong} salah</b></>} · Σ scan {nf(bin.scanQty)} · Σ bin {nf(bin.binQty)}
          {!bin.checked && ' · tidak dihitung'}
        </span>
      </span>
    </button>
  );
}

function BinChip({ bin }: { bin: BinDetailBin }) {
  if (!bin.checked) {
    return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold', TONES.neutral.chip)}>Belum di-scan</span>;
  }
  const wrong = bin.wrong > 0;
  const tone = wrong ? TONES.danger : TONES.success;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold', tone.chip)}>
      {wrong ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {wrong ? `Bin salah · ${bin.wrong}/${bin.lines} item` : 'Bin benar'}
    </span>
  );
}

function VerdictChip({ line }: { line: BinDetailLine }) {
  const tone = !line.wrong ? TONES.success : TONES[REASON_TONE[line.reason ?? 'unknown']];
  const label = !line.wrong ? 'Benar' : BIN_CHECK_REASON_META[line.reason ?? 'unknown'].label;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold', tone.chip)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {label}
    </span>
  );
}

/** A wrong item of a scanned bin is highlighted; items of a bin nobody scanned are only greyed. */
const isHighlighted = (l: BinDetailLine) => l.wrong && l.checked;

function LineRow({ line: l, extraColumns }: { line: BinDetailLine; extraColumns: string[] }) {
  const hl = isHighlighted(l);
  const mark = lineHighlights(l);
  return (
    <tr className={cn('border-t border-slate-100', hl ? 'bg-rose-50/60' : '', !l.checked && 'text-slate-400')}>
      <td className="relative px-3 py-1.5 text-right tabular-nums text-slate-400">
        {hl && <span className={cn('absolute inset-y-0 left-0 w-1', TONES[REASON_TONE[l.reason ?? 'unknown']].dot)} aria-hidden />}
        {l.no}
      </td>
      <td className="px-3 py-1.5"><VerdictChip line={l} /></td>
      <td className={cn('whitespace-nowrap px-3 py-1.5 font-mono text-xs font-semibold', hl ? 'text-slate-900' : 'text-slate-700')}>{l.itemNo}</td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{l.variantCode || '—'}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs">{l.unitOfMeasureCode || '—'}</td>
      <td className={cn('px-3 py-1.5 font-mono text-xs', hl && mark.actualBinCodes && cn('font-bold', TONES.active.strong))}>
        {l.actualBinCodes ? actualBins(l).map((b) => <div key={b}>{b}</div>) : '—'}
      </td>
      <td className={cn('px-3 py-1.5 text-right tabular-nums', hl && mark.scanQuantity && cn('font-extrabold', TONES.danger.strong))}>{nf(l.scanQuantity)}</td>
      <td className={cn('px-3 py-1.5 text-right tabular-nums', hl && 'font-semibold text-slate-800')}>{nf(l.binQuantity)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs">{l.status || '—'}</td>
      {extraColumns.map((c) => (
        <td key={c} className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums">{l.extra[c] == null || l.extra[c] === '' ? '—' : String(l.extra[c])}</td>
      ))}
    </tr>
  );
}

function LineCard({ line: l }: { line: BinDetailLine }) {
  const hl = isHighlighted(l);
  const mark = lineHighlights(l);
  const extra = Object.entries(l.extra).filter(([, v]) => v != null && v !== '');
  return (
    <li className={cn('relative py-3 pl-11 pr-4', hl && 'bg-rose-50/60', !l.checked && 'opacity-60')}>
      {hl && <span className={cn('absolute inset-y-0 left-0 w-1', TONES[REASON_TONE[l.reason ?? 'unknown']].dot)} aria-hidden />}
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-all font-mono text-[13px] font-bold leading-snug text-slate-900">{detailSku(l)}</p>
        <VerdictChip line={l} />
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        {l.actualBinCodes && (
          <>
            <dt className="text-slate-400">Actual Bin</dt>
            <dd className={cn('break-words font-mono', hl && mark.actualBinCodes ? cn('font-bold', TONES.active.strong) : 'text-slate-700')}>{actualBins(l).join(' · ')}</dd>
          </>
        )}
        <dt className="text-slate-400">Qty Scan</dt>
        <dd className="tabular-nums text-slate-700">
          <b className={hl && mark.scanQuantity ? TONES.danger.strong : undefined}>{nf(l.scanQuantity)}</b>
          {l.unitOfMeasureCode ? ` ${l.unitOfMeasureCode}` : ''}
        </dd>
        <dt className="text-slate-400">Qty BIN</dt>
        <dd className="tabular-nums text-slate-700">
          <b>{nf(l.binQuantity)}</b>
          {l.unitOfMeasureCode ? ` ${l.unitOfMeasureCode}` : ''}
        </dd>
        {l.status && (
          <>
            <dt className="text-slate-400">Status BC</dt>
            <dd className="text-slate-700">{l.status}</dd>
          </>
        )}
        {extra.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="font-mono text-slate-400">{k}</dt>
            <dd className="tabular-nums text-slate-700">{String(v)}</dd>
          </Fragment>
        ))}
      </dl>
    </li>
  );
}

function RightToggle({ count, shown, onClick }: { count: number; shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-1.5 border-t border-slate-100 py-2 pl-11 pr-4 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-800"
    >
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', shown && 'rotate-180')} />
      {shown ? 'Sembunyikan item benar' : `Tampilkan ${count} item benar`}
    </button>
  );
}

function ReasonChip({ reason, count, active, onClick }: { reason: BinCheckReason; count: number; active: boolean; onClick: () => void }) {
  const tone = TONES[REASON_TONE[reason]];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={BIN_CHECK_REASON_META[reason].hint}
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition sm:min-h-8 sm:rounded-lg sm:px-2.5',
        active ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
      {BIN_CHECK_REASON_META[reason].label}
      <span className={cn('tabular-nums', active ? 'text-amber-700' : tone.strong)}>{count.toLocaleString('id-ID')}</span>
    </button>
  );
}

function Stat({ icon: Icon, label, value, valueClass }: { icon: React.ElementType; label: string; value: string | null; valueClass: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2 py-2">
      <dt className="flex items-center justify-center gap-1 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3 w-3" /> {label}
      </dt>
      <dd className={cn('mt-0.5 text-lg font-extrabold tabular-nums', valueClass)}>{value ?? <span className="mx-auto mt-1 block h-5 w-8 animate-pulse rounded bg-slate-100" />}</dd>
    </div>
  );
}

function Chip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone?: 'danger' | 'success' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition sm:min-h-8 sm:rounded-lg sm:px-2.5',
        active ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {label}
      <span className={cn('tabular-nums', active ? 'text-amber-700' : tone ? TONES[tone].strong : 'text-slate-400')}>{count.toLocaleString('id-ID')}</span>
    </button>
  );
}

function SplitBar({ correct, wrong, className }: { correct: number; wrong: number; className?: string }) {
  const all = correct + wrong;
  const pct = all ? (correct / all) * 100 : 0;
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-slate-100', className)} role="img" aria-label={all ? `${correct} bin benar, ${wrong} bin salah` : 'Belum ada data'}>
      {all > 0 && (
        <div className="flex h-full w-full">
          <div className={cn('h-full', TONES.success.dot)} style={{ width: `${pct}%` }} />
          <div className={cn('h-full', TONES.danger.dot)} style={{ width: `${100 - pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Notice({ tone, title, body }: { tone: 'warning' | 'danger'; title: string; body: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border p-3.5 text-sm', tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
      <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'danger' ? 'text-rose-600' : 'text-amber-600')} />
      <div>
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-[13px] opacity-90">{body}</p>
      </div>
    </div>
  );
}

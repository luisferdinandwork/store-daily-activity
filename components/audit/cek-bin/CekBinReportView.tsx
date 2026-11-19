'use client';
// components/audit/cek-bin/CekBinReportView.tsx — Audit "Hasil Cek Bin".
//
// Pick a period (≤ 31 days) → every active store's daily Cek Bin as Business Central judged it: BINS right vs wrong
// (a bin is wrong when one of its items is), accuracy, and the daily averages. Two tables: "Per hari" (each day of
// the period, a store's day under it) and "Per toko" (each store over the period). Area / store filters run on the
// loaded data (one BC query per period). Rules: lib/audit-bin-report.ts. A store-day opens its bins + items on
// /audit/cek-bin/[storeId]/[date] (CekBinDetailView).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  MapPin,
  RefreshCw,
  ScanLine,
  SlidersHorizontal,
  Store,
  Target,
  XCircle,
} from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { cn } from '@/lib/utils';
import { TONES, rateTone } from '@/lib/status-theme';
import { addDaysKey, jakartaTodayKey } from '@/lib/day-bucket';
import { longDateId } from '@/lib/audit-cash-check';
import {
  BIN_REPORT_MAX_DAYS,
  BIN_STORE_SORT_LABEL,
  binTotals,
  formatAccuracy,
  formatAvg,
  groupByDay,
  groupByStore,
  periodDays,
  periodProblem,
  sortStoreGroups,
  type BinReportRow,
  type BinReportStore,
  type BinStoreSort,
  type BinTotals,
} from '@/lib/audit-bin-report';
import { fetchJson } from '@/components/audit/cash-check/kit';
import SoTabs from '@/components/audit/stock-opname/SoTabs';

type FeedState = 'ok' | 'not_configured' | 'unavailable';

interface Loaded {
  key: string;
  state: FeedState;
  fetchedAt: string | null;
  stores: BinReportStore[];
  rows: BinReportRow[];
  error: string | null;
}

type View = 'day' | 'store';

const PRESETS: { id: string; label: string; range: (today: string) => [string, string] }[] = [
  { id: '7', label: '7 hari', range: (t) => [addDaysKey(t, -6), t] },
  { id: 'month', label: 'Bulan ini', range: (t) => [`${t.slice(0, 7)}-01`, t] },
  {
    id: 'last',
    label: 'Bulan lalu',
    range: (t) => {
      const firstThis = `${t.slice(0, 7)}-01`;
      const lastPrev = addDaysKey(firstThis, -1);
      return [`${lastPrev.slice(0, 7)}-01`, lastPrev];
    },
  },
  { id: '31', label: '31 hari', range: (t) => [addDaysKey(t, -30), t] },
];

const WEEKDAY = new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' });
const weekday = (day: string) => WEEKDAY.format(new Date(`${day}T00:00:00Z`));

export default function CekBinReportView() {
  const today = jakartaTodayKey();
  const [from, setFrom] = useState(() => PRESETS[1].range(today)[0]);
  const [to, setTo] = useState(today);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [view, setView] = useState<View>('day');
  const [sort, setSort] = useState<BinStoreSort>('accuracy_asc');
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Loaded | null>(null);
  // Phone: the date / area / store boxes sit behind one summary line; from `md` they are always shown.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const problem = periodProblem(from, to, today);
  const key = `${from}|${to}|${reload}`;

  useEffect(() => {
    if (problem) return;
    let alive = true;
    const refresh = reload > 0 ? '&refresh=1' : '';
    fetchJson<Omit<Loaded, 'key' | 'error'>>(`/api/audit/cek-bin?from=${from}&to=${to}${refresh}`)
      .then((d) => alive && setData({ key, state: d.state, fetchedAt: d.fetchedAt, stores: d.stores, rows: d.rows, error: null }))
      .catch((e) => alive && setData({ key, state: 'unavailable', fetchedAt: null, stores: [], rows: [], error: e instanceof Error ? e.message : 'Gagal memuat.' }));
    return () => {
      alive = false;
    };
  }, [from, to, reload, key, problem]);

  const loading = !problem && data?.key !== key;
  const stores = useMemo(() => data?.stores ?? [], [data]);
  const areas = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of stores) if (s.areaId != null) map.set(s.areaId, s.areaName ?? `Area ${s.areaId}`);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }, [stores]);

  const scopedStores = useMemo(
    () => stores.filter((s) => (areaId == null || s.areaId === areaId) && (storeId == null || s.id === storeId)),
    [stores, areaId, storeId],
  );
  const storeOptions = useMemo(() => stores.filter((s) => areaId == null || s.areaId === areaId), [stores, areaId]);
  const scopedIds = useMemo(() => new Set(scopedStores.map((s) => s.id)), [scopedStores]);
  const rows = useMemo(() => (loading ? [] : (data?.rows ?? []).filter((r) => scopedIds.has(r.storeId))), [data, loading, scopedIds]);

  const days = useMemo(() => periodDays(from, to), [from, to]);
  const totals = useMemo(() => binTotals(rows), [rows]);
  const dayGroups = useMemo(() => groupByDay(rows, days), [rows, days]);
  const storeGroups = useMemo(() => sortStoreGroups(groupByStore(rows, scopedStores), sort), [rows, scopedStores, sort]);
  const single = storeId != null;
  const activePreset = PRESETS.find((p) => {
    const [f, t] = p.range(today);
    return f === from && t === to;
  })?.id;

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const [f, t] = p.range(today);
    setFrom(f);
    setTo(t);
  };

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="Audit · Cek Bin & SO"
        title={<><ScanLine />Hasil Cek Bin</>}
        subtitle="Hasil Cek Bin toko menurut Business Central — bin benar vs bin salah, rata-rata per hari"
        tabs={<SoTabs />}
        hideTabsOnPhone
        compactActions
        actions={
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            disabled={loading || !!problem}
            aria-label="Muat ulang"
            className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50 md:w-auto md:px-3"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> <span className="hidden md:inline">Muat ulang</span>
          </button>
        }
      />

      <div className="space-y-3 p-3 sm:space-y-4 sm:p-6 lg:p-8">
        {/* ── Periode: presets first (one thumb-swipe row), the rest behind "Filter" on a phone ── */}
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 md:hidden">
          {PRESETS.map((p) => (
            <PresetChip key={p.id} active={activePreset === p.id} label={p.label} onClick={() => applyPreset(p)} />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 text-left shadow-xs active:bg-slate-50 md:hidden"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-900">{rangeLabel(from, to)}</span>
            <span className="block truncate text-xs text-slate-500">
              {storeId != null ? (stores.find((s) => s.id === storeId)?.name ?? 'Satu toko') : areaId != null ? (areas.find((a) => a.id === areaId)?.name ?? 'Satu area') : 'Semua toko'}
              {areaId != null && storeId == null ? ' · semua toko' : ''}
            </span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', filtersOpen && 'rotate-180')} />
        </button>

        {/* ── Filters ── */}
        <div className={cn('gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:p-4 md:grid xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]', filtersOpen ? 'grid' : 'hidden')}>
          <div className="min-w-0">
            <Label>Periode</Label>
            <div className="grid grid-cols-2 items-center gap-2 md:flex md:flex-wrap">
              <DateBox value={from} max={to} onChange={setFrom} label="Dari tanggal" />
              <span className="hidden text-xs text-slate-400 md:inline">s/d</span>
              <DateBox value={to} max={today} min={from} onChange={setTo} label="Sampai tanggal" />
            </div>
            <div className="mt-2 hidden flex-wrap gap-1.5 md:flex">
              {PRESETS.map((p) => (
                <PresetChip key={p.id} active={activePreset === p.id} label={p.label} onClick={() => applyPreset(p)} />
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <Label>Area</Label>
            <label className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
              <MapPin className="h-4 w-4 shrink-0 text-amber-600" />
              <select
                value={areaId ?? ''}
                onChange={(e) => {
                  setAreaId(e.target.value ? Number(e.target.value) : null);
                  setStoreId(null);
                }}
                className="min-w-0 flex-1 truncate bg-transparent text-base font-semibold text-slate-900 outline-none sm:text-sm"
                aria-label="Area"
              >
                <option value="">Semua area</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="min-w-0">
            <Label>Toko</Label>
            <StoreCombobox
              stores={storeOptions}
              loading={loading && stores.length === 0}
              value={storeId}
              onChange={setStoreId}
              allLabel="Semua toko"
              accent="amber"
              className="max-w-none"
            />
          </div>
        </div>

        {problem && <Notice tone="warning" title={problem} body={`Pilih periode paling lama ${BIN_REPORT_MAX_DAYS} hari, sampai hari ini.`} />}
        {!problem && !loading && data?.error && <Notice tone="danger" title="Gagal memuat" body={data.error} />}
        {!problem && !loading && !data?.error && data?.state === 'not_configured' && (
          <Notice tone="warning" title="Business Central belum diatur" body="Alamat + login BC untuk Cek Bin (BC_API_BIN_BASE_URL / USERNAME / PASSWORD) belum diisi di server." />
        )}
        {!problem && !loading && !data?.error && data?.state === 'unavailable' && (
          <Notice tone="danger" title="Data Business Central belum tersedia" body="BC tidak bisa dihubungi saat ini. Coba Muat ulang sebentar lagi." />
        )}

        {/* ── KPI: one summary card on a phone, four tiles from sm ── */}
        <PhoneSummary loading={loading} totals={totals} storeCount={scopedStores.length} single={single} dayCount={days.length} />
        <div className="hidden grid-cols-2 gap-2 sm:grid sm:gap-3 xl:grid-cols-4">
          <Kpi
            icon={CheckCircle2}
            tone="success"
            label="Bin benar / hari"
            value={loading ? null : formatAvg(totals.avgCorrect)}
            hint={loading ? '' : `${totals.correct.toLocaleString('id-ID')} bin benar`}
          />
          <Kpi
            icon={XCircle}
            tone="danger"
            label="Bin salah / hari"
            value={loading ? null : formatAvg(totals.avgWrong)}
            hint={loading ? '' : `${totals.wrong.toLocaleString('id-ID')} bin salah · ${totals.wrongItems.toLocaleString('id-ID')} item salah`}
          />
          <Kpi
            icon={Target}
            tone={totals.accuracy == null ? 'neutral' : rateTone(totals.accuracy)}
            label="Akurasi bin"
            value={loading ? null : formatAccuracy(totals.accuracy)}
            hint={loading ? '' : 'bin benar ÷ bin di-scan'}
          >
            {!loading && <SplitBar correct={totals.correct} wrong={totals.wrong} className="mt-2" />}
          </Kpi>
          <Kpi
            icon={Layers}
            tone="neutral"
            label="Hari cek bin"
            value={loading ? null : totals.storeDays.toLocaleString('id-ID')}
            hint={loading ? '' : single ? `dari ${days.length} hari · ${formatAvg(totals.avgBins)} bin/hari` : `${totals.stores} dari ${scopedStores.length} toko · ${formatAvg(totals.avgBins)} bin/hari`}
          />
        </div>

        {/* ── Tables ── */}
        <div className="@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
            <div className="flex w-full rounded-xl bg-slate-100 p-0.5 sm:w-auto" role="tablist" aria-label="Tampilan">
              {(['day', 'store'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold transition sm:min-h-9 sm:flex-none',
                    view === v ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {v === 'day' ? <CalendarDays className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5" />}
                  {v === 'day' ? 'Per hari' : 'Per toko'}
                </button>
              ))}
            </div>
            {view === 'store' ? (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Urutkan
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as BinStoreSort)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-base font-semibold text-slate-700 outline-none focus:border-amber-400 sm:text-xs"
                >
                  {(Object.keys(BIN_STORE_SORT_LABEL) as BinStoreSort[]).map((k) => (
                    <option key={k} value={k}>
                      {BIN_STORE_SORT_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-xs text-slate-400">
                {longDateId(from)} – {longDateId(to)}
              </p>
            )}
          </div>

          {loading ? (
            <ul className="divide-y divide-slate-100">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="h-14 animate-pulse bg-slate-50/60" />
              ))}
            </ul>
          ) : view === 'day' ? (
            <DayTable groups={dayGroups} single={single} storeCount={scopedStores.length} />
          ) : (
            <StoreTable groups={storeGroups} />
          )}
        </div>

        {!loading && data?.fetchedAt && (
          <p className="text-[11px] text-slate-400">
            Sumber: Business Central (PP Bin Content Check) · diambil{' '}
            {new Date(data.fetchedAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB. Yang
            dihitung adalah bin: satu bin &quot;salah&quot; bila minimal satu item di dalamnya Qty Lower / Higher Than Bin, Misplaced, Not
            Scanned atau Not Found; &quot;benar&quot; bila semua itemnya benar. Buka satu toko di satu hari untuk melihat item per bin.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Per hari ────────────────────────────────────────────────────────────────

const GRID_DAY = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 @3xl:grid-cols-[minmax(0,1.3fr)_5rem_5rem_6rem_6rem_minmax(0,1.2fr)]';

function DayTable({ groups, single, storeCount }: { groups: ReturnType<typeof groupByDay>; single: boolean; storeCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (d: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  if (groups.every((g) => g.rows.length === 0)) {
    return <Empty title="Belum ada hasil Cek Bin di periode ini" body="Business Central tidak punya bin yang di-scan untuk toko yang dipilih." />;
  }

  // Days in a row without any Cek Bin fold into one line ("3 – 9 Nov · 7 hari tanpa cek bin"): the gap stays visible
  // but a month with a few checks is no longer a screen-long list of empty days.
  type Item = { kind: 'day'; g: (typeof groups)[number] } | { kind: 'gap'; from: string; to: string; count: number };
  const items: Item[] = [];
  for (const g of groups) {
    const last = items[items.length - 1];
    if (g.rows.length > 0) items.push({ kind: 'day', g });
    else if (last?.kind === 'gap') {
      last.from = g.date;
      last.count += 1;
    } else items.push({ kind: 'gap', from: g.date, to: g.date, count: 1 });
  }

  return (
    <div role="table" aria-label="Hasil Cek Bin per hari">
      <div role="row" className={cn(GRID_DAY, 'hidden border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 @3xl:grid')}>
        <span role="columnheader">Tanggal</span>
        <span role="columnheader" className="text-right">{single ? 'Bin' : 'Toko'}</span>
        <span role="columnheader" className="text-right">{single ? '' : 'Bin'}</span>
        <span role="columnheader" className="text-right">Bin benar</span>
        <span role="columnheader" className="text-right">Bin salah</span>
        <span role="columnheader">Akurasi</span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((item) => {
          if (item.kind === 'gap') {
            return (
              <div key={`gap-${item.to}`} role="row" className="flex items-center gap-2.5 bg-slate-50/50 px-4 py-2 text-xs text-slate-400">
                <span className="w-4 shrink-0" />
                <span role="cell">
                  <span className="font-semibold text-slate-500">{item.count === 1 ? shortDay(item.to) : `${shortDay(item.from)} – ${shortDay(item.to)}`}</span>
                  {' · '}
                  {item.count === 1 ? 'tanpa cek bin' : `${item.count} hari tanpa cek bin`}
                </span>
              </div>
            );
          }
          const g = item.g;
          const has = g.rows.length > 0;
          const expandable = has && !single;
          const isOpen = open.has(g.date);
          // One store picked → the day IS one store-day, so the row opens its detail page straight away.
          const detailHref = single && has ? `/audit/cek-bin/${g.rows[0].storeId}/${g.date}` : null;
          const activate = expandable ? () => toggle(g.date) : detailHref ? () => router.push(detailHref) : undefined;
          return (
            <Fragment key={g.date}>
              <div
                role="row"
                tabIndex={activate ? 0 : undefined}
                onClick={activate}
                onKeyDown={activate ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), activate()) : undefined}
                className={cn(GRID_DAY, 'px-4 py-2.5', (expandable || detailHref) && 'cursor-pointer hover:bg-amber-50/40', detailHref && 'active:bg-amber-50', !has && 'text-slate-400')}
              >
                <div role="cell" className="flex min-w-0 items-center gap-2.5">
                  {expandable ? (
                    isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  ) : detailHref ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className={cn('truncate text-sm font-bold', has ? 'text-slate-900' : 'text-slate-400')}>
                      {weekday(g.date)}, {longDateId(g.date)}
                    </p>
                    <p className="truncate text-xs text-slate-500 @3xl:hidden">
                      {has
                        ? `${single ? `${g.totals.bins} bin` : `${g.totals.stores}/${storeCount} toko · ${g.totals.bins} bin`} · ${g.totals.correct} benar · ${g.totals.wrong} salah`
                        : 'Tidak ada cek bin'}
                    </p>
                  </div>
                </div>
                {has ? (
                  <>
                    <span role="cell" className="hidden text-right text-sm tabular-nums text-slate-700 @3xl:block">
                      {single ? g.totals.bins : `${g.totals.stores}/${storeCount}`}
                    </span>
                    <span role="cell" className="hidden text-right text-sm tabular-nums text-slate-700 @3xl:block">
                      {single ? '' : g.totals.bins}
                    </span>
                    <span role="cell" className={cn('hidden text-right text-sm font-semibold tabular-nums @3xl:block', TONES.success.strong)}>
                      {g.totals.correct.toLocaleString('id-ID')}
                    </span>
                    <span role="cell" className={cn('hidden text-right text-sm font-semibold tabular-nums @3xl:block', g.totals.wrong ? TONES.danger.strong : 'text-slate-400')}>
                      {g.totals.wrong.toLocaleString('id-ID')}
                    </span>
                    <AccuracyCell totals={g.totals} />
                  </>
                ) : (
                  <span role="cell" className="text-right text-xs @3xl:col-span-5 @3xl:text-left">
                    <span className="hidden @3xl:inline">Tidak ada cek bin</span>
                    <span className="@3xl:hidden">—</span>
                  </span>
                )}
              </div>
              {expandable && isOpen && (
                <div className="bg-slate-50/60">
                  {g.rows.map((r) => (
                    <Link
                      key={r.storeId}
                      href={`/audit/cek-bin/${r.storeId}/${g.date}`}
                      role="row"
                      className={cn(GRID_DAY, 'border-t border-slate-100/80 py-2 pl-11 pr-4 transition-colors hover:bg-amber-50/60 active:bg-amber-50')}
                    >
                      <div role="cell" className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          <span className="font-mono text-xs text-amber-700">{r.location}</span> {r.storeName}
                          <span className="ml-2 inline-flex items-center text-[11px] font-bold text-amber-600">
                            Detail <ChevronRight className="h-3 w-3" />
                          </span>
                        </p>
                        <p className="truncate text-xs text-slate-500 @3xl:hidden">
                          {r.bins} bin · {r.correct} benar · {r.wrong} salah
                        </p>
                      </div>
                      <span role="cell" className="hidden @3xl:block" />
                      <span role="cell" className="hidden text-right text-sm tabular-nums text-slate-600 @3xl:block">{r.bins}</span>
                      <span role="cell" className={cn('hidden text-right text-sm tabular-nums @3xl:block', TONES.success.strong)}>{r.correct}</span>
                      <span role="cell" className={cn('hidden text-right text-sm tabular-nums @3xl:block', r.wrong ? TONES.danger.strong : 'text-slate-400')}>{r.wrong}</span>
                      <AccuracyCell totals={binTotals([r])} />
                    </Link>
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Per toko ────────────────────────────────────────────────────────────────

const GRID_STORE = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 @3xl:grid-cols-[minmax(0,1.6fr)_4.5rem_5rem_7.5rem_7.5rem_minmax(0,1.2fr)]';

function StoreTable({ groups }: { groups: ReturnType<typeof sortStoreGroups> }) {
  if (groups.length === 0) return <Empty title="Tidak ada toko" body="Ubah filter area atau toko." />;
  return (
    <div role="table" aria-label="Hasil Cek Bin per toko">
      <div role="row" className={cn(GRID_STORE, 'hidden border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 @3xl:grid')}>
        <span role="columnheader">Toko</span>
        <span role="columnheader" className="text-right">Hari</span>
        <span role="columnheader" className="text-right">Bin/hari</span>
        <span role="columnheader" className="text-right">Bin benar/hari</span>
        <span role="columnheader" className="text-right">Bin salah/hari</span>
        <span role="columnheader">Akurasi</span>
      </div>
      <div className="divide-y divide-slate-100">
        {groups.map(({ store, totals }) => {
          const has = totals.storeDays > 0;
          return (
            <div key={store.id} role="row" className={cn(GRID_STORE, 'px-4 py-2.5')}>
              <div role="cell" className="min-w-0">
                <p className={cn('truncate text-sm font-bold', has ? 'text-slate-900' : 'text-slate-400')}>
                  <span className="font-mono text-xs text-amber-700">{store.storeNo}</span> {store.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  <span className="@3xl:hidden">
                    {has ? `${totals.storeDays} hari · ${formatAvg(totals.avgCorrect)} bin benar · ${formatAvg(totals.avgWrong)} bin salah / hari` : 'Tidak ada cek bin'}
                  </span>
                  <span className="hidden @3xl:inline">{store.areaName ?? ''}</span>
                </p>
              </div>
              {has ? (
                <>
                  <span role="cell" className="hidden text-right text-sm tabular-nums text-slate-700 @3xl:block">{totals.storeDays}</span>
                  <span role="cell" className="hidden text-right text-sm tabular-nums text-slate-700 @3xl:block">{formatAvg(totals.avgBins)}</span>
                  <span role="cell" className={cn('hidden text-right text-sm font-semibold tabular-nums @3xl:block', TONES.success.strong)}>{formatAvg(totals.avgCorrect)}</span>
                  <span role="cell" className={cn('hidden text-right text-sm font-semibold tabular-nums @3xl:block', totals.wrong ? TONES.danger.strong : 'text-slate-400')}>
                    {formatAvg(totals.avgWrong)}
                  </span>
                  <AccuracyCell totals={totals} />
                </>
              ) : (
                <span role="cell" className="text-right text-xs text-slate-400 @3xl:col-span-5 @3xl:text-left">
                  <span className="hidden @3xl:inline">Tidak ada cek bin di periode ini</span>
                  <span className="@3xl:hidden">—</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const shortDay = (day: string, withYear = false) =>
  `${Number(day.slice(8))} ${MONTH_SHORT[Number(day.slice(5, 7)) - 1]}${withYear ? ` ${day.slice(0, 4)}` : ''}`;

/** "1 – 16 Nov 2026" · "28 Okt – 5 Nov 2026" · one day: "16 Nov 2026". */
function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDay(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
  return `${sameMonth ? String(Number(from.slice(8))) : shortDay(from, !sameYear)} – ${shortDay(to, true)}`;
}

function PresetChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-h-10 shrink-0 rounded-full border px-3.5 text-xs font-semibold transition md:min-h-8 md:rounded-lg md:px-2.5',
        active ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {label}
    </button>
  );
}

/** Phone-only result summary: accuracy first, then the three averages in one row (the four tiles take over from `sm`). */
function PhoneSummary({
  loading,
  totals,
  storeCount,
  single,
  dayCount,
}: {
  loading: boolean;
  totals: BinTotals;
  storeCount: number;
  single: boolean;
  dayCount: number;
}) {
  const tone = totals.accuracy == null ? null : TONES[rateTone(totals.accuracy)];
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs sm:hidden" aria-label="Ringkasan">
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Akurasi bin</p>
            {loading ? (
              <div className="mt-1.5 h-9 w-24 animate-pulse rounded bg-slate-100" />
            ) : (
              <p className={cn('text-4xl font-extrabold leading-none tabular-nums', tone?.strong ?? 'text-slate-300')}>{formatAccuracy(totals.accuracy)}</p>
            )}
          </div>
          <p className="shrink-0 pb-0.5 text-right text-[11px] leading-snug text-slate-400">
            {loading ? '' : single ? `${totals.storeDays} dari ${dayCount} hari` : `${totals.stores} dari ${storeCount} toko`}
            <br />
            {loading ? '' : `${totals.correct.toLocaleString('id-ID')} bin benar · ${totals.wrong.toLocaleString('id-ID')} bin salah`}
          </p>
        </div>
        {!loading && <SplitBar correct={totals.correct} wrong={totals.wrong} className="mt-3 h-2.5" />}
      </div>
      <dl className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/60">
        <PhoneStat label="Bin benar / hari" value={loading ? null : formatAvg(totals.avgCorrect)} valueClass={TONES.success.strong} />
        <PhoneStat label="Bin salah / hari" value={loading ? null : formatAvg(totals.avgWrong)} valueClass={totals.wrong ? TONES.danger.strong : 'text-slate-400'} />
        <PhoneStat label="Bin / hari" value={loading ? null : formatAvg(totals.avgBins)} valueClass="text-slate-800" />
      </dl>
    </section>
  );
}

function PhoneStat({ label, value, valueClass }: { label: string; value: string | null; valueClass: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-center">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={cn('mt-0.5 text-lg font-extrabold tabular-nums', valueClass)}>{value ?? <span className="mx-auto mt-1 block h-5 w-8 animate-pulse rounded bg-slate-100" />}</dd>
    </div>
  );
}

function AccuracyCell({ totals }: { totals: BinTotals }) {
  const tone = totals.accuracy == null ? null : TONES[rateTone(totals.accuracy)];
  return (
    <div role="cell" className="flex min-w-0 items-center gap-2.5">
      <SplitBar correct={totals.correct} wrong={totals.wrong} className="hidden flex-1 @3xl:flex" />
      <span className={cn('w-14 shrink-0 text-right text-sm font-bold tabular-nums', tone?.strong ?? 'text-slate-400')}>{formatAccuracy(totals.accuracy)}</span>
    </div>
  );
}

/** Right (emerald) vs wrong (rose), side by side in one bar. */
function SplitBar({ correct, wrong, className }: { correct: number; wrong: number; className?: string }) {
  const all = correct + wrong;
  const pct = all ? (correct / all) * 100 : 0;
  return (
    <div
      className={cn('h-2 overflow-hidden rounded-full bg-slate-100', className)}
      role="img"
      aria-label={all ? `${correct} bin benar, ${wrong} bin salah` : 'Belum ada data'}
    >
      {all > 0 && (
        <div className="flex h-full w-full">
          <div className={cn('h-full', TONES.success.dot)} style={{ width: `${pct}%` }} />
          <div className={cn('h-full', TONES.danger.dot)} style={{ width: `${100 - pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  children,
}: {
  icon: React.ElementType;
  tone: keyof typeof TONES;
  label: string;
  value: string | null;
  hint: string;
  children?: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-xs sm:px-4">
      <div className="flex items-start gap-3">
        <span className={cn('hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex', t.soft)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          {value == null ? (
            <div className="mt-1.5 h-6 w-16 animate-pulse rounded bg-slate-100" />
          ) : (
            <p className={cn('mt-0.5 text-2xl font-extrabold tabular-nums leading-tight', tone === 'neutral' ? 'text-slate-900' : t.strong)}>{value}</p>
          )}
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</p>;
}

function DateBox({ value, onChange, min, max, label }: { value: string; onChange: (v: string) => void; min?: string; max?: string; label: string }) {
  return (
    <label className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
      <CalendarDays className="hidden h-4 w-4 shrink-0 text-amber-600 min-[400px]:block" />
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none md:w-[8.5rem] md:flex-none sm:text-sm"
        aria-label={label}
      />
    </label>
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

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <ScanLine className="mx-auto h-9 w-9 text-slate-300" />
      <p className="mt-2 text-sm font-semibold text-slate-600">{title}</p>
      <p className="mt-0.5 text-xs text-slate-400">{body}</p>
    </div>
  );
}

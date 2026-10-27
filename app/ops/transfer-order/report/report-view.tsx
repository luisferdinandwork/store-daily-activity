'use client';
// app/ops/transfer-order/report/report-view.tsx
//
// The TO Report for ONE process (Item Return / Item Receiving / Item Delivery —
// one page each, switched by the header tabs or the sidebar): per store, how many
// of that process it had in the period and how many it has finished. Same shape
// as Task Progress: the Harian / Mingguan / Bulanan header, a KPI band, a filter
// bar, one row per store. In a week or month each row also carries a day-by-day
// trend strip. A row opens that store's processes (store-sheet.tsx); a day square
// opens that day.
//
// What counts, and when: lib/transfer-order-report.ts. Data:
// GET /api/ops/item-transfers/report?process=….

import { useMemo, useState } from 'react';
import { AlertCircle, ChevronRight, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES, heatStep, rateTone } from '@/lib/status-theme';
import { useApi } from '@/lib/client/use-api';
import { jakartaTime, jakartaTodayKey } from '@/lib/day-bucket';
import { periodDays } from '@/lib/task-progress';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';
import { OpsChipTabs, OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import { MetricTile, RateBar } from '@/components/tasks/MetricTile';
import { PctLegend } from '@/components/tasks/HeatGrid';
import { SectionTabs } from '@/components/finance/shared/sheet-kit';
import { formatMinutes } from '@/lib/transfer-order-metrics';
import {
  PROCESSES,
  PROCESS_META,
  avgMinutes,
  filterCounts,
  matchesFilter,
  matchesSearch,
  pct,
  sortReports,
  summarise,
  type Process,
  type ReportFilter,
  type ReportSort,
  type StoreReport,
  type TransferReportResponse,
} from '@/lib/transfer-order-report';
import StoreSheet, { type StoreSheetTarget } from './store-sheet';

// ─── Small helpers ───────────────────────────────────────────────────────────

function fmtDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function rangeLabel(days: string[]): string {
  const f = (k: string, withYear = false) =>
    new Date(`${k}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return `${f(days[0])} – ${f(days[days.length - 1], true)}`;
}

/** Hold the last good response while a new day / period loads (no flash, no jump). */
function useHeld<T extends { success: boolean }>(data: T | undefined): T | null {
  const [held, setHeld] = useState<T | null>(null);
  if (data?.success && data !== held) setHeld(data);
  return data?.success ? data : held;
}

const WEEKDAY = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

/** An open process waiting this long (a day / two) turns the figure amber / red. */
const WAIT_WARN_MIN = 24 * 60;
const WAIT_ALERT_MIN = 48 * 60;
const waitTone = (m: number) => (m >= WAIT_ALERT_MIN ? TONES.danger : m >= WAIT_WARN_MIN ? TONES.warning : TONES.neutral);

// One template for the header and every row so the columns line up.
const GRID_BASE = 'grid items-center gap-x-5';
const COLS_DAY = 'grid-cols-[minmax(180px,1.5fr)_minmax(150px,1.1fr)_minmax(90px,0.6fr)_minmax(90px,0.6fr)_minmax(100px,0.7fr)_20px]';
const COLS_RANGE = 'grid-cols-[minmax(180px,1.2fr)_minmax(140px,0.9fr)_minmax(80px,0.5fr)_minmax(80px,0.5fr)_minmax(90px,0.6fr)_minmax(180px,1.4fr)_20px]';

// ─── Row parts ───────────────────────────────────────────────────────────────

function ProgressCell({ store }: { store: StoreReport }) {
  if (store.total === 0) {
    return <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-400">Tidak ada proses</span>;
  }
  const p = pct(store.done, store.total);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums text-slate-900">
          {store.done}<span className="font-medium text-slate-400">/{store.total}</span>
        </span>
        <span className={cn('inline-flex items-center rounded-full border px-2 py-px text-[11px] font-bold tabular-nums', TONES[rateTone(p)].chip)}>{p}%</span>
      </div>
      <RateBar rate={p} className="mt-1.5" />
    </div>
  );
}

function OpenCell({ store }: { store: StoreReport }) {
  if (store.total === 0) return <span className="text-sm text-slate-300">—</span>;
  const open = store.total - store.done;
  if (open === 0) return <span className={cn('text-xs font-semibold', TONES.success.strong)}>Selesai semua</span>;
  return (
    <div className="min-w-0">
      <span className={cn('text-sm font-semibold tabular-nums', TONES.warning.strong)}>{open}<span className="ml-1 text-[11px] font-medium text-slate-400">belum</span></span>
      {store.notStarted > 0 && (
        <p className="truncate text-[10px] text-slate-400" title="Belum difoto terima fisik oleh toko — waktu belum berjalan">
          {store.notStarted} belum difoto
        </p>
      )}
    </div>
  );
}

function DurationCell({ minutes, tone }: { minutes: number | null; tone?: (typeof TONES)['neutral'] }) {
  if (minutes == null) return <span className="text-sm text-slate-300">—</span>;
  return <span className={cn('text-sm font-semibold tabular-nums', tone ? tone.strong : 'text-slate-700')}>{formatMinutes(minutes)}</span>;
}

function TrendHeader({ days, today }: { days: string[]; today: string }) {
  const weekly = days.length <= 7;
  return (
    <div className="flex gap-[3px]" aria-hidden>
      {days.map((day) => {
        const d = new Date(`${day}T00:00:00Z`);
        const label = weekly ? WEEKDAY[d.getUTCDay()] : (d.getUTCDate() === 1 || d.getUTCDate() % 5 === 0 ? String(d.getUTCDate()) : '');
        return (
          <span key={day} className={cn('min-w-0 flex-1 text-center text-[9px] font-medium normal-case tracking-normal', day === today ? 'font-bold text-slate-900' : 'text-slate-400')}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

function TrendStrip({
  store, days, today, onPick,
}: {
  store: StoreReport;
  days: string[];
  today: string;
  onPick: (day: string) => void;
}) {
  return (
    <div className="flex gap-[3px]">
      {days.map((day) => {
        const c = store.days[day];
        const p = c && c.total > 0 ? pct(c.done, c.total) : null;
        const future = day > today;
        const title = `${new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${
          c && c.total > 0 ? `${c.done}/${c.total} selesai (${p}%)` : 'tidak ada proses'
        }`;
        return (
          <button
            key={day}
            type="button"
            disabled={p === null}
            title={title}
            aria-label={title}
            onClick={(e) => { e.stopPropagation(); onPick(day); }}
            className={cn(
              'h-6 min-w-0 flex-1 rounded-[5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
              p === null ? (future ? 'bg-slate-50' : 'bg-slate-100') : cn(heatStep(p).cell, 'hover:scale-110 hover:shadow-sm'),
              day === today && 'ring-2 ring-slate-900/60 ring-offset-1',
            )}
          />
        );
      })}
    </div>
  );
}

// ─── View ────────────────────────────────────────────────────────────────────

export default function ReportView({ process }: { process: Process }) {
  const meta = PROCESS_META[process];

  const [date, setDate] = useState(jakartaTodayKey());
  const [period, setPeriod] = useState<Period>('weekly');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('all');
  const [sort, setSort] = useState<ReportSort>('attention');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [sheet, setSheet] = useState<StoreSheetTarget | null>(null);

  const today = jakartaTodayKey();
  const days = useMemo(() => periodDays(period, date), [period, date]);
  const from = days[0];
  const to = days[days.length - 1];

  const api = useApi<TransferReportResponse>(`/api/ops/item-transfers/report?process=${process}&startDate=${from}&endDate=${to}`);
  const data = useHeld(api.data);
  const error = api.data && !api.data.success ? (api.data.error ?? 'Gagal memuat data.') : api.error?.message ?? null;
  const reloading = api.validating;
  const firstLoad = !data;

  const areaOptions = useMemo(
    () => [...new Set((data?.stores ?? []).map((s) => s.areaName).filter((a): a is string => !!a))].sort(),
    [data],
  );
  const activeArea = area !== 'all' && areaOptions.includes(area) ? area : 'all';

  // KPIs and the status chips look at everything the search + area narrow to; the
  // chip then narrows the list itself.
  const scoped = useMemo(() => (data?.stores ?? []).filter((s) => matchesSearch(s, activeArea, search)), [data, activeArea, search]);
  const totals = useMemo(() => summarise(scoped), [scoped]);
  const counts = useMemo(() => filterCounts(scoped), [scoped]);
  const rows = useMemo(() => sortReports(scoped.filter((s) => matchesFilter(s, filter)), sort), [scoped, filter, sort]);

  const scopeLabel = data?.scope === 'area' ? (data.areaName ?? 'Area') : activeArea !== 'all' ? activeArea : 'Semua area';
  const subtitle = period === 'daily' ? fmtDateLabel(date) : rangeLabel(days);
  const ranged = period !== 'daily';

  const openStore = (store: StoreReport) => setSheet({ process, store, from, to, label: subtitle });
  const openDay = (store: StoreReport, day: string) => {
    setPeriod('daily');
    setDate(day);
    setSheet({ process, store, from: day, to: day, label: fmtDateLabel(day) });
  };

  const tabs = PROCESSES.map((p) => ({ href: `/ops/transfer-order/report/${p}`, label: PROCESS_META[p].label }));

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · TO Report"
        title={meta.label}
        subtitle={`${scopeLabel} · ${subtitle}`}
        periodProps={{ period, onPeriodChange: setPeriod, date, onDateChange: setDate }}
        onRefresh={() => void api.refresh()}
        refreshing={reloading}
        tabs={<SectionTabs tabs={tabs} label="TO Report" />}
        contentClassName="w-full"
      />

      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <p className="text-sm text-slate-500">{meta.blurb}. <span className="text-slate-400">{meta.rangeHint}.</span></p>

        {/* ── KPI band ─────────────────────────────────────────────────── */}
        <div className={cn('grid grid-cols-2 gap-3 transition-opacity lg:grid-cols-3 xl:grid-cols-5', reloading && 'opacity-70')}>
          <MetricTile
            label="Penyelesaian"
            value={firstLoad || totals.total === 0 ? '–' : `${totals.rate}%`}
            tone={totals.total === 0 ? 'default' : rateTone(totals.rate)}
            hint={totals.total === 0 ? 'Belum ada proses pada periode ini' : `${totals.done} dari ${totals.total} proses selesai`}
            footer={totals.total > 0 ? <RateBar rate={totals.rate} /> : undefined}
          />
          <MetricTile
            label="Total proses"
            value={firstLoad ? '–' : totals.total}
            hint={`${totals.storesWithTo} toko terlibat`}
          />
          <MetricTile
            label="Belum selesai"
            value={firstLoad ? '–' : totals.open}
            tone={firstLoad || totals.total === 0 ? 'default' : totals.open > 0 ? 'warning' : 'success'}
            hint={
              totals.open > 0
                ? `${totals.storesOpen} toko perlu tindak lanjut${totals.notStarted > 0 ? ` · ${totals.notStarted} belum difoto toko` : ''}`
                : totals.total > 0 ? 'Semua proses sudah selesai' : '—'
            }
          />
          <MetricTile
            label={meta.avgLabel}
            value={firstLoad || totals.avgMinutes == null ? '–' : formatMinutes(totals.avgMinutes)}
            hint={meta.rangeHint}
          />
          <MetricTile
            label="Menunggu terlama"
            value={firstLoad || totals.longestWaitMinutes == null ? '–' : formatMinutes(totals.longestWaitMinutes)}
            tone={totals.longestWaitMinutes == null ? 'default' : totals.longestWaitMinutes >= WAIT_ALERT_MIN ? 'danger' : totals.longestWaitMinutes >= WAIT_WARN_MIN ? 'warning' : 'default'}
            hint={totals.longestWaitMinutes == null ? 'Tidak ada yang menunggu' : meta.waitHint}
          />
        </div>

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <OpsSearchInput value={search} onChange={setSearch} placeholder="Cari nama / kode toko…" className="max-w-sm" />
            {data?.scope !== 'area' && areaOptions.length > 1 && (
              <OpsFilterSelect label="Area" value={activeArea} onChange={setArea}>
                <option value="all">Semua area</option>
                {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </OpsFilterSelect>
            )}
            <OpsFilterSelect label="Urutkan" value={sort} onChange={(v) => setSort(v as ReportSort)} highlight={false}>
              <option value="attention">Urut: Paling tertinggal</option>
              <option value="oldest">Urut: Menunggu terlama</option>
              <option value="progress">Urut: Progress tertinggi</option>
              <option value="volume">Urut: Proses terbanyak</option>
              <option value="name">Urut: Nama toko</option>
            </OpsFilterSelect>
          </div>
          <OpsChipTabs<ReportFilter>
            value={filter}
            onChange={setFilter}
            items={[
              { key: 'all', label: 'Semua toko', count: counts.all },
              { key: 'open', label: 'Ada yang belum selesai', count: counts.open, tone: 'amber' },
              { key: 'complete', label: 'Semua selesai', count: counts.complete, tone: 'emerald' },
              { key: 'none', label: 'Tanpa proses', count: counts.none, tone: 'slate' },
            ]}
          />
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-sm font-bold">Gagal memuat data</p><p className="mt-0.5 text-xs">{error}</p></div>
          </div>
        )}

        {/* ── Store list ───────────────────────────────────────────────── */}
        {firstLoad ? (
          <div className="h-[420px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm font-semibold text-slate-700">Tidak ada toko</p>
            <p className="mt-1 text-xs text-slate-400">Coba ubah periode, area, filter, atau kata kunci pencarian.</p>
          </div>
        ) : (
          <div className={cn('overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-opacity', reloading && 'opacity-60')}>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">
                {rows.length} toko
                {data && <span className="ml-2 text-xs font-normal text-slate-400">diperbarui {jakartaTime(data.generatedAt).replace(':', '.')} WIB</span>}
              </p>
              {ranged ? <PctLegend /> : (
                <p className="text-xs text-slate-400">Klik toko untuk melihat daftar prosesnya.</p>
              )}
            </div>

            {/* Scrolls sideways on a narrow window instead of squeezing the columns. */}
            <div className="overflow-x-auto">
              <div className={ranged ? 'min-w-[1000px]' : 'min-w-[720px]'}>
                <div className={cn(GRID_BASE, ranged ? COLS_RANGE : COLS_DAY, 'border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500')}>
                  <span>Toko</span>
                  <span>Penyelesaian</span>
                  <span>Belum selesai</span>
                  <span>Rata-rata</span>
                  <span>Terlama menunggu</span>
                  {ranged && <TrendHeader days={days} today={today} />}
                  <span />
                </div>

                <ul className="divide-y divide-slate-100">
                  {rows.map((store) => {
                    const idle = store.total === 0;
                    return (
                      <li key={store.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => openStore(store)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStore(store); } }}
                          className={cn(
                            GRID_BASE, ranged ? COLS_RANGE : COLS_DAY,
                            'group cursor-pointer px-4 py-3 transition hover:bg-slate-50 focus:outline-none focus-visible:bg-indigo-50',
                            idle && 'opacity-60 hover:opacity-100',
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{store.name}</p>
                            <p className="truncate text-[11px] text-slate-400">
                              <span className="font-mono font-medium text-slate-500">{store.storeNo}</span>
                              {store.areaName && <> · {store.areaName}</>}
                            </p>
                          </div>
                          <ProgressCell store={store} />
                          <OpenCell store={store} />
                          <DurationCell minutes={avgMinutes(store)} />
                          <DurationCell minutes={store.oldestOpenMinutes} tone={store.oldestOpenMinutes != null ? waitTone(store.oldestOpenMinutes) : undefined} />
                          {ranged && <TrendStrip store={store} days={days} today={today} onPick={(day) => openDay(store, day)} />}
                          <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ── How to read it ───────────────────────────────────────────── */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p>
            {meta.howItCounts} Yang tampil adalah TO yang tercatat di sistem — TO yang sudah selesai di Business Central tanpa konfirmasi toko
            tidak ikut terhitung. Waktu dalam WIB.
          </p>
        </div>
      </div>

      <StoreSheet target={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

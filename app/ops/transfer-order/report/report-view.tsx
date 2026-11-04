'use client';
// app/ops/transfer-order/report/report-view.tsx
//
// The TO Report for ONE process (Item Return / Item Receiving / Item Delivery —
// one page each, switched by the header tabs or the sidebar): per store, how many
// of that process it had in the period and how many it has finished. Same shape
// as Task Progress: the Harian / Mingguan / Bulanan header, four KPI tiles, one
// search / area / sort row, one list of stores. A row opens that store's processes
// (store-sheet.tsx).
//
// What counts, and when: lib/transfer-order-report.ts. Averages (the tile, each
// row, the sheet) are made of COMPLETED processes only — an open one never moves
// them; it only shows as "Belum selesai" and "Menunggu terlama". Data:
// GET /api/ops/item-transfers/report?process=….

import { useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES, rateTone } from '@/lib/status-theme';
import { useApi } from '@/lib/client/use-api';
import { jakartaTime, jakartaTodayKey } from '@/lib/day-bucket';
import { periodDays } from '@/lib/task-progress';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';
import { OpsList, OpsListRow, OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsChipTabs, OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import { MetricTile, RateBar } from '@/components/tasks/MetricTile';
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

/** An open process waiting this long (a day / two) turns the figure amber / red. */
const WAIT_WARN_MIN = 24 * 60;
const WAIT_ALERT_MIN = 48 * 60;
const waitTone = (m: number) => (m >= WAIT_ALERT_MIN ? TONES.danger : m >= WAIT_WARN_MIN ? TONES.warning : TONES.neutral);

const SORT_OPTIONS: { key: ReportSort; label: string }[] = [
  { key: 'attention', label: 'Paling tertinggal' },
  { key: 'oldest', label: 'Menunggu terlama' },
  { key: 'volume', label: 'Proses terbanyak' },
  { key: 'name', label: 'Nama toko' },
];

// ─── Row ─────────────────────────────────────────────────────────────────────
// One list row per store. Below the container's `@3xl` the four figures fold into
// two columns under the store name (each with its own small label); from `@3xl` up
// they sit on one line beside it and the header row above names the columns.
// Widths are shared with the header so the columns line up.

const W_PROGRESS = '@3xl:w-44';
const W_FIGURE = '@3xl:w-24';
const W_WAIT = '@3xl:w-28';

function Figure({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 @3xl:hidden">{label}</p>
      {children}
    </div>
  );
}

const dash = <span className="text-sm text-slate-300">—</span>;

function ProgressFigure({ store }: { store: StoreReport }) {
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

function OpenFigure({ store }: { store: StoreReport }) {
  const open = store.total - store.done;
  if (open === 0) return <span className={cn('text-xs font-semibold', TONES.success.strong)}>Selesai semua</span>;
  return (
    <div className="min-w-0">
      <span className={cn('text-sm font-semibold tabular-nums', TONES.warning.strong)}>{open}</span>
      {store.notStarted > 0 && (
        <p className="truncate text-[10px] text-slate-400" title="Belum difoto terima fisik oleh toko — waktu belum berjalan">
          {store.notStarted} belum difoto
        </p>
      )}
    </div>
  );
}

function Duration({ minutes, tone, sub }: { minutes: number | null; tone?: (typeof TONES)['neutral']; sub?: string }) {
  if (minutes == null) return dash;
  return (
    <div className="min-w-0">
      <span className={cn('text-sm font-semibold tabular-nums', tone ? tone.strong : 'text-slate-700')}>{formatMinutes(minutes)}</span>
      {sub && <p className="truncate text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function StoreRow({ store, onOpen }: { store: StoreReport; onOpen: () => void }) {
  const idle = store.total === 0;
  return (
    <OpsListRow onClick={onOpen} ariaLabel={`Lihat proses ${store.name}`} className={cn(idle && 'py-2.5 opacity-60 hover:opacity-100')}>
      <div className="grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-2.5 @3xl:flex @3xl:items-center @3xl:gap-5">
        <div className="col-span-2 min-w-0 @3xl:col-span-1 @3xl:flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{store.name}</p>
          <p className="truncate text-[11px] text-slate-400">
            <span className="font-mono font-medium text-slate-500">{store.storeNo}</span>
            {store.areaName && <> · {store.areaName}</>}
          </p>
        </div>

        {idle ? (
          <p className="col-span-2 text-xs text-slate-400 @3xl:col-span-1 @3xl:w-[33.75rem]">Tidak ada proses pada periode ini</p>
        ) : (
          <>
            <Figure label="Selesai" className={cn('col-span-2 @3xl:col-span-1', W_PROGRESS)}><ProgressFigure store={store} /></Figure>
            <Figure label="Belum selesai" className={W_FIGURE}><OpenFigure store={store} /></Figure>
            <Figure label="Rata-rata" className={W_FIGURE}>
              <Duration minutes={avgMinutes(store)} sub={store.timed > 0 ? `dari ${store.timed} selesai` : undefined} />
            </Figure>
            <Figure label="Menunggu terlama" className={W_WAIT}>
              <Duration minutes={store.oldestOpenMinutes} tone={store.oldestOpenMinutes != null ? waitTone(store.oldestOpenMinutes) : undefined} />
            </Figure>
          </>
        )}
      </div>
    </OpsListRow>
  );
}

function ColumnHeads() {
  const th = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500';
  return (
    <div className="hidden items-center gap-x-5 border-b border-slate-100 bg-slate-50 px-5 py-2.5 @3xl:flex" aria-hidden>
      <span className={cn(th, 'flex-1')}>Toko</span>
      <span className={cn(th, 'w-44')}>Selesai</span>
      <span className={cn(th, 'w-24')}>Belum selesai</span>
      <span className={cn(th, 'w-24')} title="Rata-rata hanya dari proses yang sudah selesai">Rata-rata</span>
      <span className={cn(th, 'w-28')} title="Proses terbuka yang paling lama menunggu">Menunggu terlama</span>
      <span className="w-4 shrink-0" />
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

  const openStore = (store: StoreReport) => setSheet({ process, store, from, to, label: subtitle });
  const tabs = PROCESSES.map((p) => ({ href: `/ops/transfer-order/report/${p}`, label: PROCESS_META[p].label }));

  const noTotal = firstLoad || totals.total === 0;
  const unclocked = totals.done - totals.timed; // completed, but no clock to average

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
        <details className="group text-sm text-slate-500">
          <summary className="cursor-pointer list-none">
            {meta.blurb}. <span className="text-slate-400">{meta.rangeHint}.</span>{' '}
            <span className="font-semibold text-indigo-600 group-open:hidden">Cara dihitung</span>
          </summary>
          <div className="mt-2 flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p>
              {meta.howItCounts} Rata-rata hanya dihitung dari proses yang sudah selesai — proses yang masih menunggu tidak ikut, dan
              hanya tampil sebagai &ldquo;Belum selesai&rdquo; dan &ldquo;Menunggu terlama&rdquo;. Yang tampil adalah TO yang tercatat di sistem; TO yang
              sudah selesai di Business Central tanpa konfirmasi toko tidak terhitung. Waktu dalam WIB.
            </p>
          </div>
        </details>

        {/* ── KPI band ─────────────────────────────────────────────────── */}
        <div className={cn('grid grid-cols-2 gap-3 transition-opacity xl:grid-cols-4', reloading && 'opacity-70')}>
          <MetricTile
            label="Selesai"
            value={noTotal ? '–' : `${totals.rate}%`}
            tone={noTotal ? 'default' : rateTone(totals.rate)}
            hint={noTotal ? 'Belum ada proses pada periode ini' : `${totals.done} dari ${totals.total} proses · ${totals.storesWithTo} toko`}
            footer={!noTotal ? <RateBar rate={totals.rate} /> : undefined}
          />
          <MetricTile
            label="Belum selesai"
            value={firstLoad ? '–' : totals.open}
            tone={noTotal ? 'default' : totals.open > 0 ? 'warning' : 'success'}
            hint={
              totals.open > 0
                ? `${totals.storesOpen} toko perlu tindak lanjut${totals.notStarted > 0 ? ` · ${totals.notStarted} belum difoto toko` : ''}`
                : totals.total > 0 ? 'Semua proses sudah selesai' : '—'
            }
          />
          <MetricTile
            label={meta.avgLabel}
            value={firstLoad || totals.avgMinutes == null ? '–' : formatMinutes(totals.avgMinutes)}
            hint={
              totals.avgMinutes == null
                ? 'Belum ada proses selesai untuk dirata-rata'
                : `rata-rata dari ${totals.timed} selesai${unclocked > 0 ? ` · ${unclocked} selesai tanpa foto toko tidak dihitung` : ''}`
            }
          />
          <MetricTile
            label="Menunggu terlama"
            value={firstLoad || totals.longestWaitMinutes == null ? '–' : formatMinutes(totals.longestWaitMinutes)}
            tone={totals.longestWaitMinutes == null ? 'default' : totals.longestWaitMinutes >= WAIT_ALERT_MIN ? 'danger' : totals.longestWaitMinutes >= WAIT_WARN_MIN ? 'warning' : 'default'}
            hint={totals.longestWaitMinutes == null ? 'Tidak ada yang menunggu' : `${meta.waitHint} · tidak masuk rata-rata`}
          />
        </div>

        {/* ── Search / area / sort ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <OpsSearchInput value={search} onChange={setSearch} placeholder="Cari nama / kode toko…" className="max-w-sm" />
          {data?.scope !== 'area' && areaOptions.length > 1 && (
            <OpsFilterSelect label="Area" value={activeArea} onChange={setArea}>
              <option value="all">Semua area</option>
              {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </OpsFilterSelect>
          )}
          <OpsFilterSelect label="Urutkan" value={sort} onChange={(v) => setSort(v as ReportSort)} highlight={false}>
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Urut: {o.label}</option>)}
          </OpsFilterSelect>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-sm font-bold">Gagal memuat data</p><p className="mt-0.5 text-xs">{error}</p></div>
          </div>
        )}

        {/* ── Store list ───────────────────────────────────────────────── */}
        {firstLoad ? (
          <OpsListSkeleton rows={8} />
        ) : (
          <div className={cn('@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-opacity', reloading && 'opacity-60')}>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-5">
              <OpsChipTabs<ReportFilter>
                value={filter}
                onChange={setFilter}
                items={[
                  { key: 'all', label: 'Semua toko', count: counts.all },
                  { key: 'open', label: 'Belum selesai', count: counts.open, tone: 'amber' },
                  { key: 'complete', label: 'Selesai semua', count: counts.complete, tone: 'emerald' },
                  { key: 'none', label: 'Tanpa proses', count: counts.none, tone: 'slate' },
                ]}
              />
              {data && <p className="text-xs text-slate-400">diperbarui {jakartaTime(data.generatedAt).replace(':', '.')} WIB</p>}
            </div>

            {rows.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-semibold text-slate-700">Tidak ada toko</p>
                <p className="mt-1 text-xs text-slate-400">Coba ubah periode, area, filter, atau kata kunci pencarian.</p>
              </div>
            ) : (
              <>
                <ColumnHeads />
                <OpsList className="rounded-none border-0 shadow-none">
                  {rows.map((store) => <StoreRow key={store.id} store={store} onOpen={() => openStore(store)} />)}
                </OpsList>
              </>
            )}
          </div>
        )}
      </div>

      <StoreSheet target={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

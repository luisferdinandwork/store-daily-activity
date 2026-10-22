'use client';
// app/ops/store-visits/report/page.tsx
//
// Report Visit. Filters (search, area, category, Ops, sort) sit above and scope
// both views:
//   • Kalender (default): the month in Monday–Sunday weeks — the same weeks a
//     7-day store's visit cycle uses — with each day's visits and each week's
//     "x / y toko" coverage. A day or a week opens the side panel: who visited
//     what, or which stores still owe (or missed) that week's visit.
//   • Per toko: every store's current cycle, worst first, with its history strip.
// Aktivitas Ops (last 28 days) closes the page.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CalendarClock, CalendarDays, ChevronRight, List, UserRound } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsSearchInput, OpsFilterSelect, OpsChipTabs } from '@/components/ops/layout/OpsToolbar';
import { Pill, ProgressBar, StatTile, daysAgoLabel, type Tone } from '@/components/ops/store-visits/shared';
import VisitCalendar, { VisitCalendarPanel, type CalendarPick, type PanelSort } from '@/components/ops/store-visits/VisitCalendar';
import { useApi } from '@/lib/client/use-api';
import { cycleName, cycleRangeLabel } from '@/lib/store-visit/cycles';
import {
  attentionOrder,
  calendarWeeks,
  missedLastCycle,
  missedStreak,
  reportState,
  reportTotals,
  type ReportOps,
  type ReportStore,
  type VisitReport,
} from '@/lib/store-visit/report';
import { jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | 'open' | 'met' | 'missed' | 'unset';
type SortKey = 'attention' | 'deadline' | 'last' | 'name';
type View = 'calendar' | 'stores';

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });

function matchesQuery(s: ReportStore, q: string): boolean {
  return !q || `${s.name} ${s.storeNo} ${s.areaName} ${s.policy?.city ?? ''} ${s.opsNames.join(' ')}`.toLowerCase().includes(q);
}

function sortStores(list: ReportStore[], sort: SortKey): ReportStore[] {
  const byName = (a: ReportStore, b: ReportStore) => a.name.localeCompare(b.name);
  switch (sort) {
    case 'name': return [...list].sort(byName);
    case 'last': return [...list].sort((a, b) => (a.lastVisit?.at ?? '').localeCompare(b.lastVisit?.at ?? '') || byName(a, b));
    case 'deadline': return [...list].sort((a, b) => {
      const da = a.cycle && !a.cycle.met ? a.cycle.daysLeft : Infinity;
      const db = b.cycle && !b.cycle.met ? b.cycle.daysLeft : Infinity;
      return da - db || byName(a, b);
    });
    default: return [...list].sort(attentionOrder);
  }
}

export default function StoreVisitReportPage() {
  const today = jakartaTodayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<View>('calendar');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [category, setCategory] = useState('all');
  const [opsId, setOpsId] = useState('all');
  const [sort, setSort] = useState<SortKey>('attention');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [pick, setPick] = useState<CalendarPick | null>(null);

  const api = useApi<VisitReport & { success: boolean; error?: string }>(`/api/ops/store-visits/report?month=${month}`);
  // Refetch keeps the frame: hold the last report while another month loads.
  const [held, setHeld] = useState<(VisitReport & { success: boolean }) | null>(null);
  if (api.data?.success && api.data !== held) setHeld(api.data);
  const report = api.data?.success ? api.data : held;
  const loading = !report && api.validating;
  const error = api.data && !api.data.success ? (api.data.error || 'Report visit gagal dimuat.') : api.error ? 'Report visit gagal dimuat.' : '';
  const load = () => void api.refresh();

  const weeks = useMemo(() => calendarWeeks(month), [month]);
  // Default pick: this week while looking at this month, else the month's first week.
  const activePick: CalendarPick | null = pick ?? (weeks.length
    ? { kind: 'week', week: weeks.find((w) => w[0] <= today && today <= w[6]) ?? weeks[0] }
    : null);

  // Area + category narrow the whole page (numbers included); search, Ops and chips narrow the lists.
  const scoped = useMemo(() => (report?.stores ?? []).filter((s) =>
    (area === 'all' || String(s.areaId) === area) && (category === 'all' || s.policy?.category === category),
  ), [report, area, category]);
  const totals = useMemo(() => reportTotals(scoped), [scoped]);

  const q = query.trim().toLowerCase();
  const opsName = opsId === 'all' ? null : report?.ops.find((o) => o.id === opsId)?.name ?? null;

  const calendarStores = useMemo(() => scoped.filter((s) => matchesQuery(s, q)), [scoped, q]);
  const calendarVisits = useMemo(() => {
    const ids = new Set(calendarStores.map((s) => s.id));
    return (report?.calendarVisits ?? []).filter((v) => ids.has(v.storeId) && (opsId === 'all' || v.byId === opsId));
  }, [report, calendarStores, opsId]);

  // Ops filter on the store list: that Ops's stores (assigned area) plus any they visited this cycle.
  const visible = useMemo(() => sortStores(scoped.filter((s) => {
    if (!matchesQuery(s, q)) return false;
    if (opsId !== 'all' && !(opsName && s.opsNames.includes(opsName)) && !s.visits.some((v) => v.byId === opsId)) return false;
    if (filter === 'missed') return !!missedLastCycle(s);
    return filter === 'all' || reportState(s) === filter;
  }), sort), [scoped, q, opsId, opsName, filter, sort]);

  const groups = [
    { key: 'open', title: 'Belum dikunjungi', hint: 'periode berjalan', tone: 'amber' as const, stores: visible.filter((s) => reportState(s) === 'open') },
    { key: 'met', title: 'Sudah dikunjungi', hint: 'periode berjalan', tone: 'emerald' as const, stores: visible.filter((s) => reportState(s) === 'met') },
    { key: 'unset', title: 'Belum diatur', hint: 'IT belum mengatur kategori & jumlah wajib', tone: 'slate' as const, stores: visible.filter((s) => reportState(s) === 'unset') },
  ].filter((g) => g.stores.length > 0);

  const coverage = totals.withPolicy ? Math.round((totals.met / totals.withPolicy) * 100) : 0;
  const multiArea = (report?.areas.length ?? 0) > 1;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader title="Report Visit" scope="OPS · Kunjungan Area" subtitle="Toko mana yang sudah dan belum dikunjungi Ops pada periodenya." onRefresh={load} refreshing={api.validating} className="max-md:[&_h1]:text-xl" contentClassName="w-full" />
      <div className="space-y-4 p-4 pb-8 sm:space-y-5 sm:p-6 lg:px-8">
        <Link href="/ops/store-visits" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700"><ArrowLeft className="h-4 w-4" />Daftar toko</Link>

        {!error && (
          <section aria-label="Ringkasan report" className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 p-4 text-white shadow-sm sm:p-5">
              {loading ? <div className="h-16 animate-pulse rounded-xl bg-white/10" /> : <>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-100">Sudah dikunjungi periode ini</p>
                    <p className="mt-1 text-3xl font-bold tabular-nums">{totals.met}<span className="text-lg font-semibold text-indigo-200"> / {totals.withPolicy} toko</span></p>
                  </div>
                  <p className="pb-1 text-right text-sm font-semibold text-indigo-50">
                    {totals.open ? `${totals.open} toko belum dikunjungi` : totals.withPolicy ? 'Semua toko sudah dikunjungi' : 'Belum ada toko yang diatur'}
                  </p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${coverage}%` }} /></div>
                <p className="mt-3 text-xs leading-5 text-indigo-100">
                  Tiap toko punya periode sendiri (7 hari = Senin–Minggu). Visit boleh kapan saja selama periode berjalan; setelah periode berakhir hitungan mulai dari nol.
                  {report?.trackedFrom && ` Riwayat dicatat sejak ${new Date(`${report.trackedFrom}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`}
                </p>
              </>}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <StatTile label="Belum dikunjungi" value={loading ? '–' : totals.open} tone="amber" hint={!loading && totals.endingSoon ? `${totals.endingSoon} berakhir ≤ besok` : 'periode berjalan'} />
              <StatTile label="Sudah dikunjungi" value={loading ? '–' : totals.met} tone="emerald" hint="periode berjalan" />
              <StatTile label="Terlewat" value={loading ? '–' : totals.missed} tone="rose" hint="periode lalu" />
            </div>
          </section>
        )}

        {/* Filters — one row, scoping everything below */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Tampilan" className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5">
            {([['calendar', 'Kalender', CalendarDays], ['stores', 'Per toko', List]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={cn('inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition', view === key ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50')}
              >
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
          <OpsSearchInput value={query} onChange={setQuery} placeholder="Cari toko, kode, kota, atau Ops…" className="basis-full sm:basis-auto sm:max-w-sm" />
          {multiArea && (
            <OpsFilterSelect label="Area" value={area} onChange={setArea}>
              <option value="all">Semua area</option>
              {report?.areas.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
            </OpsFilterSelect>
          )}
          <OpsFilterSelect label="Kategori visit" value={category} onChange={setCategory}>
            <option value="all">Semua kategori</option>
            <option value="in_city">Dalam kota</option><option value="out_city">Luar kota</option>
          </OpsFilterSelect>
          {(report?.ops.length ?? 0) > 1 && (
            <OpsFilterSelect label="Ops" value={opsId} onChange={setOpsId}>
              <option value="all">Semua Ops</option>
              {report?.ops.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </OpsFilterSelect>
          )}
          <OpsFilterSelect label="Urutkan" value={sort} onChange={(v) => setSort(v as SortKey)} highlight={false}>
            <option value="attention">Urut: Perlu perhatian</option>
            <option value="deadline">Urut: Batas terdekat</option>
            <option value="last">Urut: Terlama tidak dikunjungi</option>
            <option value="name">Urut: Nama toko</option>
          </OpsFilterSelect>
        </div>

        {error ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-semibold">{error}</p><button className="mt-1 min-h-11 text-sm font-semibold underline" onClick={load}>Coba lagi</button></div>
          </div>
        ) : loading ? <OpsListSkeleton /> : view === 'calendar' ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <VisitCalendar
              month={month}
              weeks={weeks}
              visits={calendarVisits}
              stores={calendarStores}
              today={today}
              trackedFrom={report?.trackedFrom ?? null}
              pick={activePick}
              onPick={setPick}
              onMonthChange={(m) => { setMonth(m); setPick(null); }}
              loading={api.validating}
            />
            <div className="xl:sticky xl:top-28">
              <VisitCalendarPanel
                pick={activePick}
                visits={calendarVisits}
                stores={calendarStores}
                today={today}
                trackedFrom={report?.trackedFrom ?? null}
                sort={(sort === 'name' ? 'name' : sort === 'last' ? 'last' : 'attention') satisfies PanelSort}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [&>div]:flex-nowrap [&>div]:sm:flex-wrap">
              <OpsChipTabs<FilterKey> value={filter} onChange={setFilter} items={[
                { key: 'all', label: 'Semua', count: scoped.length },
                { key: 'open', label: 'Belum dikunjungi', count: totals.open, tone: 'amber' },
                { key: 'met', label: 'Sudah dikunjungi', count: totals.met, tone: 'emerald' },
                { key: 'missed', label: 'Terlewat periode lalu', count: totals.missed, tone: 'rose' },
                { key: 'unset', label: 'Belum diatur', count: totals.unset, tone: 'slate' },
              ]} />
            </div>
            {groups.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>
            ) : (
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.key} aria-label={group.title} className="space-y-2.5">
                    <div className="flex items-baseline gap-2 px-1">
                      <h2 className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-900">{group.title}</h2>
                      <Pill tone={group.tone}>{group.stores.length}</Pill>
                      <span className="truncate text-xs text-slate-500">{group.hint}</span>
                    </div>
                    <ul className="grid gap-2.5 2xl:grid-cols-2">
                      {group.stores.map((store) => <StoreReportRow key={store.id} store={store} showArea={multiArea} />)}
                    </ul>
                  </section>
                ))}
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-slate-500">
                  <span className="font-semibold text-slate-600">Riwayat periode:</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] bg-emerald-500" />terpenuhi</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] bg-rose-400" />terlewat</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] bg-white ring-2 ring-inset ring-amber-400" />periode berjalan</span>
                </p>
              </div>
            )}
          </>
        )}

        {!error && !loading && report && report.ops.length > 0 && <OpsActivity ops={report.ops} days={report.activityDays} showArea={multiArea} />}
      </div>
    </div>
  );
}

function StoreReportRow({ store, showArea }: { store: ReportStore; showArea: boolean }) {
  const state = reportState(store);
  const cycle = store.cycle;
  const policy = store.policy;
  // The red "terlewat" note is for stores still owed a visit; a store already visited this cycle just keeps the red square in its history.
  const missed = state === 'open' ? missedLastCycle(store) : null;
  const streak = missedStreak(store);
  const edge = state === 'open' ? (missed ? 'bg-rose-500' : 'bg-amber-400') : state === 'met' ? 'bg-emerald-500' : 'bg-slate-200';

  const latest = store.visits[0] ?? null;
  const visitLine = latest
    ? `Dikunjungi ${dayLabel(latest.at)}${latest.by ? ` oleh ${latest.by}` : ''}${store.visits.length > 1 ? ` · +${store.visits.length - 1} visit lain` : ''}`
    : store.lastVisit
      ? `Terakhir ${daysAgoLabel(jakartaDateKey(store.lastVisit.at)).toLowerCase()}${store.lastVisit.by ? ` · ${store.lastVisit.by}` : ''}`
      : 'Belum pernah dikunjungi';

  return (
    <li>
      <Link href={`/ops/store-visits/${store.id}`} aria-label={`Buka visit ${store.name}`}
        className="relative flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-[0.99]">
        <span aria-hidden className={cn('w-1.5 shrink-0', edge)} />
        <div className="min-w-0 flex-1 space-y-2.5 p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold leading-snug text-slate-900">{store.name}</p>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {store.storeNo} · {policy?.city || store.areaName}
                {showArea && policy?.city && ` · ${store.areaName}`}
                {store.opsNames.length > 0 && ` · Ops: ${store.opsNames.join(', ')}`}
              </p>
            </div>
            <StatePill store={store} />
          </div>

          {cycle && policy ? (
            <>
              <div className="space-y-1.5">
                <ProgressBar value={cycle.count} max={policy.minimumVisits} tone={cycle.met ? 'emerald' : 'amber'} />
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span>{cycleName(policy.intervalDays)} · {cycleRangeLabel(cycle)} · {Math.min(cycle.count, policy.minimumVisits)}/{policy.minimumVisits} visit</span>
                  {!cycle.met && (
                    <span className={cn('inline-flex items-center gap-1 font-semibold', cycle.daysLeft <= 1 ? 'text-rose-600' : 'text-slate-600')}>
                      <CalendarClock className="h-3.5 w-3.5" />{cycle.daysLeft === 0 ? 'Hari terakhir' : `Sisa ${cycle.daysLeft} hari`}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className={cn('flex min-w-0 items-center gap-1.5 text-xs', latest ? 'font-semibold text-slate-700' : 'text-slate-500')}>
                  <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{visitLine}</span>
                </p>
                <HistoryStrip store={store} />
              </div>
              {missed && (
                <p className="text-xs font-semibold text-rose-700">
                  {streak > 1 ? `${streak} periode terlewat berturut-turut` : `${policy.intervalDays === 7 ? 'Minggu lalu' : 'Periode lalu'} terlewat`} ({cycleRangeLabel(missed)})
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">Kategori dan jumlah wajib belum diatur IT. {visitLine}.</p>
          )}
        </div>
        <div className="flex items-center pr-3 text-slate-300"><ChevronRight className="h-5 w-5" /></div>
      </Link>
    </li>
  );
}

function StatePill({ store }: { store: ReportStore }) {
  const state = reportState(store);
  if (state === 'unset') return <Pill tone="slate">Belum diatur</Pill>;
  if (state === 'met') return <Pill tone="emerald">Terpenuhi</Pill>;
  const remaining = store.cycle?.remaining ?? 0;
  const tone: Tone = missedLastCycle(store) ? 'rose' : 'amber';
  return <Pill tone={tone}>{remaining > 1 ? `Kurang ${remaining} visit` : 'Belum dikunjungi'}</Pill>;
}

function HistoryStrip({ store }: { store: ReportStore }) {
  const cycle = store.cycle;
  if (!cycle) return null;
  const label = (start: string, end: string, count: number) => `${cycleRangeLabel({ start, end })}: ${count} visit`;
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`Riwayat ${store.history.length + 1} periode terakhir; paling kanan periode berjalan`}>
      {store.history.length === 0 && <span className="mr-1 text-[11px] text-slate-400">Riwayat mulai periode ini</span>}
      {store.history.map((c) => (
        <span key={c.start} title={label(c.start, c.end, c.count)} className={cn('h-3.5 w-3.5 rounded-[4px]', c.met ? 'bg-emerald-500' : 'bg-rose-400')} />
      ))}
      <span
        title={`${label(cycle.start, cycle.end, cycle.count)} (berjalan)`}
        className={cn('h-3.5 w-3.5 rounded-[4px] ring-2 ring-inset', cycle.met ? 'bg-emerald-500 ring-emerald-500' : 'bg-white ring-amber-400')}
      />
    </div>
  );
}

function OpsActivity({ ops, days, showArea }: { ops: ReportOps[]; days: number; showArea: boolean }) {
  return (
    <section aria-label="Aktivitas Ops" className="space-y-2.5">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-sm font-bold text-slate-900">Aktivitas Ops</h2>
        <span className="text-xs text-slate-500">{days} hari terakhir</span>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {ops.map((o) => (
          <li key={o.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">{o.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{o.name}</p>
              <p className="truncate text-xs text-slate-500">
                {showArea && o.areaName ? `${o.areaName} · ` : ''}
                {o.lastVisitAt ? `Terakhir ${daysAgoLabel(jakartaDateKey(o.lastVisitAt)).toLowerCase()}` : 'Belum ada visit'}
              </p>
            </div>
            <div className="text-right">
              <p className={cn('text-sm font-bold tabular-nums', o.visits ? 'text-slate-900' : 'text-amber-600')}>{o.visits} visit</p>
              <p className="text-xs text-slate-500">{o.stores} toko</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

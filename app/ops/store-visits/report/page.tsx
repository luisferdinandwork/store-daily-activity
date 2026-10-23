'use client';
// app/ops/store-visits/report/page.tsx
//
// Report Visit — "which store do I visit next?".
//
//   Ops Area  Kunjungi berikutnya (the stores to go to first) → summary tiles →
//             the calendar of suggested visits (and what was visited).
//   Ops HO    Siapa yang harus visit apa: every area's backlog, worst first; a click
//             narrows the page to that area → summary tiles → the same calendar.
//
// Two views share one filter row: Kalender (default) and Antrean (every store as a row,
// grouped by urgency, or by area for HO). Colours come from one map (components/ops/
// store-visits/tones.ts); the schedule is derived on the fly (lib/store-visit/plan.ts).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CalendarDays, List } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsSearchInput, OpsFilterSelect, OpsChipTabs } from '@/components/ops/layout/OpsToolbar';
import { daysAgoLabel } from '@/components/ops/store-visits/shared';
import VisitPlanCalendar, { VisitLegend, VisitPlanPanel, type CalendarPick } from '@/components/ops/store-visits/VisitPlanCalendar';
import VisitQueue, { type QueueGroupBy } from '@/components/ops/store-visits/VisitQueue';
import { AreaMonitor, NextUp, SummaryTiles } from '@/components/ops/store-visits/PlanOverview';
import { useApi } from '@/lib/client/use-api';
import { addDaysKey, jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import { SOON_DAYS, areaRollups, buildPlanByArea, nextUp, planHorizonEnd, storeUrgency, type Urgency } from '@/lib/store-visit/plan';
import { calendarWeeks, type ReportOps, type ReportStore, type VisitReport } from '@/lib/store-visit/report';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | Urgency;
type View = 'calendar' | 'queue';

function matchesQuery(s: ReportStore, q: string): boolean {
  return !q || `${s.name} ${s.storeNo} ${s.areaName} ${s.policy?.city ?? ''} ${s.opsNames.join(' ')}`.toLowerCase().includes(q);
}

export default function StoreVisitReportPage() {
  const today = jakartaTodayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<View>('calendar');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [groupBy, setGroupBy] = useState<QueueGroupBy>('urgency');
  const [pick, setPick] = useState<CalendarPick | null>(null);

  const api = useApi<VisitReport & { success: boolean; error?: string }>(`/api/ops/store-visits/report?month=${month}`);
  // Refetch keeps the frame: hold the last report while another month loads.
  const [held, setHeld] = useState<(VisitReport & { success: boolean }) | null>(null);
  if (api.data?.success && api.data !== held) setHeld(api.data);
  const report = api.data?.success ? api.data : held;
  const loading = !report && api.validating;
  const error = api.data && !api.data.success ? (api.data.error || 'Report visit gagal dimuat.') : api.error ? 'Report visit gagal dimuat.' : '';
  const load = () => void api.refresh();

  const isHO = report?.scope === 'all';
  const weeks = useMemo(() => calendarWeeks(month), [month]);
  const horizonEnd = planHorizonEnd(today);

  // The schedule is worked out per area from every store (never from the filtered list), so a
  // filter or a search can't move a store to another day.
  const fullPlan = useMemo(() => buildPlanByArea(report?.stores ?? [], today, horizonEnd), [report, today, horizonEnd]);

  // Area + category narrow the whole page (numbers included); search and chips narrow what is listed.
  const scoped = useMemo(() => (report?.stores ?? []).filter((s) =>
    (area === 'all' || String(s.areaId) === area) && (category === 'all' || s.policy?.category === category),
  ), [report, area, category]);
  const scopedIds = useMemo(() => new Set(scoped.map((s) => s.id)), [scoped]);
  const scopedPlan = useMemo(() => fullPlan.filter((p) => scopedIds.has(p.storeId)), [fullPlan, scopedIds]);

  const q = query.trim().toLowerCase();
  const searched = useMemo(() => scoped.filter((s) => matchesQuery(s, q)), [scoped, q]);
  const searchedIds = useMemo(() => new Set(searched.map((s) => s.id)), [searched]);
  const calendarPlan = useMemo(() => scopedPlan.filter((p) => searchedIds.has(p.storeId)), [scopedPlan, searchedIds]);
  const calendarVisits = useMemo(() => (report?.calendarVisits ?? []).filter((v) => searchedIds.has(v.storeId)), [report, searchedIds]);

  const counts = useMemo(() => {
    const c: Record<Urgency, number> = { overdue: 0, soon: 0, open: 0, met: 0, unset: 0 };
    for (const s of scoped) c[storeUrgency(s)]++;
    return c;
  }, [scoped]);
  const withPolicy = scoped.length - counts.unset;
  const next7 = useMemo(() => scopedPlan.filter((p) => p.day <= addDaysKey(today, 6)).length, [scopedPlan, today]);

  const queueStores = useMemo(() => searched.filter((s) => filter === 'all' || storeUrgency(s) === filter), [searched, filter]);
  const rollups = useMemo(() => areaRollups(report?.stores ?? [], report?.ops ?? [], fullPlan, today)
    .filter((r) => category === 'all' || scoped.some((s) => s.areaId === r.areaId)), [report, fullPlan, today, category, scoped]);

  // Default pick: today's date (or the next day that has something planned); another month → its first week.
  const nextDay = calendarPlan.find((p) => p.day >= today)?.day;
  const todayBusy = calendarPlan.some((p) => p.day === today) || calendarVisits.some((v) => v.day === today);
  const activePick: CalendarPick | null = pick ?? (month === today.slice(0, 7)
    ? { kind: 'day', day: todayBusy ? today : nextDay && weeks.some((w) => w.includes(nextDay)) ? nextDay : today }
    : weeks.length ? { kind: 'week', week: weeks[0] } : null);

  const trackedLabel = report?.trackedFrom
    ? new Date(`${report.trackedFrom}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
  const multiArea = (report?.areas.length ?? 0) > 1;

  const tiles = [
    { key: 'overdue', tone: 'overdue' as const, label: 'Terlewat', value: counts.overdue, hint: 'periode lalu tidak terpenuhi' },
    { key: 'soon', tone: 'soon' as const, label: 'Segera berakhir', value: counts.soon, hint: `periode habis ≤ ${SOON_DAYS} hari` },
    { key: 'planned7', tone: 'planned' as const, label: 'Dijadwalkan', value: next7, hint: '7 hari ke depan' },
    { key: 'met', tone: 'done' as const, label: 'Terpenuhi', value: counts.met, hint: `dari ${withPolicy} toko periode ini` },
  ];
  const selectTile = (key: string) => {
    setView('queue');
    setFilter(key === 'planned7' ? 'open' : (key as FilterKey));
  };

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title="Report Visit"
        scope="OPS · Kunjungan Area"
        subtitle={isHO ? 'Pantau toko mana yang harus dikunjungi tiap Ops Area.' : 'Rencana kunjungan: toko mana yang perlu didatangi berikutnya.'}
        onRefresh={load}
        refreshing={api.validating}
        className="max-md:[&_h1]:text-xl"
        contentClassName="w-full"
      />
      <div className="space-y-4 p-4 pb-8 sm:space-y-5 sm:p-6 lg:px-8">
        <Link href="/ops/store-visits" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700"><ArrowLeft className="h-4 w-4" />Daftar toko</Link>

        {error ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-semibold">{error}</p><button className="mt-1 min-h-11 text-sm font-semibold underline" onClick={load}>Coba lagi</button></div>
          </div>
        ) : loading ? (
          <OpsListSkeleton />
        ) : (
          <>
            {isHO ? (
              <AreaMonitor rows={rollups} selected={area} onSelect={setArea} activityDays={report?.activityDays ?? 28} />
            ) : (
              <NextUp items={nextUp(scopedPlan, today)} stores={scoped} today={today} allDone={withPolicy > 0 && counts.met === withPolicy} />
            )}

            <section aria-label="Ringkasan">
              <SummaryTiles tiles={tiles} onSelect={selectTile} />
            </section>

            {/* Filters — one row, scoping everything below */}
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="Tampilan" className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5">
                {([['calendar', 'Kalender', CalendarDays], ['queue', 'Antrean', List]] as const).map(([key, label, Icon]) => (
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
              {isHO && view === 'queue' && (
                <OpsFilterSelect label="Kelompokkan" value={groupBy} onChange={(v) => setGroupBy(v as QueueGroupBy)} highlight={groupBy === 'area'}>
                  <option value="urgency">Kelompok: Urgensi</option>
                  <option value="area">Kelompok: Area / Ops</option>
                </OpsFilterSelect>
              )}
            </div>

            {view === 'calendar' ? (
              <div className="space-y-3">
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <VisitPlanCalendar
                    month={month}
                    weeks={weeks}
                    visits={calendarVisits}
                    stores={searched}
                    plan={calendarPlan}
                    today={today}
                    trackedFrom={report?.trackedFrom ?? null}
                    horizonEnd={horizonEnd}
                    pick={activePick}
                    onPick={setPick}
                    onMonthChange={(m) => { setMonth(m); setPick(null); }}
                    loading={api.validating}
                  />
                  <div className="xl:sticky xl:top-4">
                    <VisitPlanPanel pick={activePick} visits={calendarVisits} stores={searched} plan={calendarPlan} today={today} trackedFrom={report?.trackedFrom ?? null} showArea={isHO && area === 'all' && multiArea} />
                  </div>
                </div>
                <VisitLegend className="px-1" />
                <p className="px-1 text-xs leading-5 text-slate-500">
                  Tiap toko punya periodenya sendiri (7 hari = Senin–Minggu); visit boleh kapan saja selama periode berjalan, lalu hitungan mulai dari nol. Hari yang disarankan menyebar kunjungan
                  merata dan mengelompokkan toko sekota. Minggu dibiarkan kosong.{trackedLabel && ` Riwayat dicatat sejak ${trackedLabel}.`}
                </p>
              </div>
            ) : (
              <>
                <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [&>div]:flex-nowrap [&>div]:sm:flex-wrap">
                  <OpsChipTabs<FilterKey> value={filter} onChange={setFilter} items={[
                    { key: 'all', label: 'Semua', count: scoped.length },
                    { key: 'overdue', label: 'Terlewat', count: counts.overdue, tone: 'rose' },
                    { key: 'soon', label: 'Segera berakhir', count: counts.soon, tone: 'amber' },
                    { key: 'open', label: 'Berjalan', count: counts.open, tone: 'indigo' },
                    { key: 'met', label: 'Terpenuhi', count: counts.met, tone: 'emerald' },
                    { key: 'unset', label: 'Belum diatur', count: counts.unset, tone: 'slate' },
                  ]} />
                </div>
                <VisitQueue stores={queueStores} plan={scopedPlan} today={today} showArea={isHO && multiArea} groupBy={isHO ? groupBy : 'urgency'} />
              </>
            )}

            {isHO && report && report.ops.length > 0 && <OpsActivity ops={report.ops} days={report.activityDays} />}
          </>
        )}
      </div>
    </div>
  );
}

function OpsActivity({ ops, days }: { ops: ReportOps[]; days: number }) {
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
                {o.areaName ? `${o.areaName} · ` : ''}
                {o.lastVisitAt ? `Terakhir ${daysAgoLabel(jakartaDateKey(o.lastVisitAt)).toLowerCase()}` : 'Belum ada visit'}
              </p>
            </div>
            <div className="text-right">
              <p className={cn('text-sm font-bold tabular-nums', o.visits ? 'text-slate-900' : 'text-rose-600')}>{o.visits} visit</p>
              <p className="text-xs text-slate-500">{o.stores} toko</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

'use client';
// app/ops/store-visits/report/page.tsx
//
// Visit Toko ▸ Report — what already happened, nothing upcoming (that is the Upcoming page).
//
//   Kalender  every day with the stores visited (green) and the periods that ended without
//             enough visits (rose); a day opens its details.
//   Daftar    the visits that were made, newest first, one thin row each.
//
// A visit (calendar day panel or list row) opens its RESULT in a side sheet — what Ops wrote,
// the store photo and geotag; the answering form itself is /ops/store-visits/[storeId].
// Ops Area sees only their own area's data (resolved server-side); Ops HO / IT pick an area.

import { useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, ChevronRight, List } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsSearchInput, OpsFilterSelect } from '@/components/ops/layout/OpsToolbar';
import { StoreCombobox } from '@/components/shared/store-combobox';
import VisitTabs from '@/components/ops/store-visits/VisitTabs';
import VisitResultSheet from '@/components/ops/store-visits/VisitResultSheet';
import ReportCalendar, { MonthNav, ReportDayPanel, ReportLegend } from '@/components/ops/store-visits/ReportCalendar';
import { TONE } from '@/components/ops/store-visits/tones';
import { useApi } from '@/lib/client/use-api';
import { jakartaTime, jakartaTodayKey } from '@/lib/day-bucket';
import { calendarWeeks, missedCycles, type CalendarVisit, type ReportStore, type VisitReport } from '@/lib/store-visit/report';
import { cn } from '@/lib/utils';

type View = 'calendar' | 'list';

const dayShort = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function matchesQuery(s: ReportStore, q: string): boolean {
  return !q || `${s.name} ${s.storeNo} ${s.areaName} ${s.policy?.city ?? ''} ${s.opsNames.join(' ')}`.toLowerCase().includes(q);
}

export default function StoreVisitReportPage() {
  const today = jakartaTodayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<View>('calendar');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [storeId, setStoreId] = useState<number | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [openVisit, setOpenVisit] = useState<string | null>(null);

  const api = useApi<VisitReport & { success: boolean; error?: string }>(`/api/ops/store-visits/report?month=${month}`);
  // Refetch keeps the frame: hold the last report while another month loads.
  const [held, setHeld] = useState<(VisitReport & { success: boolean }) | null>(null);
  if (api.data?.success && api.data !== held) setHeld(api.data);
  const report = api.data?.success ? api.data : held;
  const loading = !report && api.validating;
  const error = api.data && !api.data.success ? (api.data.error || 'Report visit gagal dimuat.') : api.error ? 'Report visit gagal dimuat.' : '';
  const load = () => void api.refresh();

  const isHO = report?.scope === 'all';
  const multiArea = (report?.areas.length ?? 0) > 1;
  const weeks = useMemo(() => calendarWeeks(month), [month]);

  // Area and store narrow the whole page; search narrows what is shown (numbers follow all three).
  const q = query.trim().toLowerCase();
  const areaStores = useMemo(() => (report?.stores ?? []).filter((s) => area === 'all' || String(s.areaId) === area), [report, area]);
  const stores = useMemo(() => (storeId == null ? areaStores : areaStores.filter((s) => s.id === storeId)), [areaStores, storeId]);
  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);
  const visits = useMemo(() => (report?.calendarVisits ?? []).filter((v) => {
    const s = storeById.get(v.storeId);
    return !!s && (!q || matchesQuery(s, q) || (v.by ?? '').toLowerCase().includes(q));
  }), [report, storeById, q]);
  const missed = useMemo(() => missedCycles(stores.filter((s) => matchesQuery(s, q)), weeks[0][0], weeks[weeks.length - 1][6], today), [stores, q, weeks, today]);

  // The numbers and the list are for the month itself (the calendar also shows its edge weeks).
  const monthVisits = useMemo(() => visits.filter((v) => v.day.slice(0, 7) === month), [visits, month]);
  const monthMissed = useMemo(() => missed.filter((m) => m.day.slice(0, 7) === month), [missed, month]);
  const visitedStores = useMemo(() => new Set(monthVisits.map((v) => v.storeId)).size, [monthVisits]);

  // Default pick: today when it's in the month, else the latest day that has something.
  const activeDays = useMemo(() => [...new Set([...monthVisits.map((v) => v.day), ...monthMissed.map((m) => m.day)])].sort(), [monthVisits, monthMissed]);
  const activePick = pick && pick.slice(0, 7) === month ? pick : month === today.slice(0, 7) ? today : activeDays[activeDays.length - 1] ?? null;

  const trackedLabel = report?.trackedFrom
    ? new Date(`${report.trackedFrom}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
  const showArea = isHO && area === 'all' && multiArea;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title="Report Visit"
        scope="OPS · Kunjungan Area"
        subtitle={isHO ? 'Visit yang sudah dilakukan dan periode yang terlewat, per area.' : 'Visit yang sudah Anda lakukan dan periode yang terlewat.'}
        onRefresh={load}
        refreshing={api.validating}
        className="max-md:[&_h1]:text-xl"
        contentClassName="w-full"
      />
      <div className="space-y-3 p-4 pb-8 sm:space-y-4 sm:p-6 lg:px-8">
        <VisitTabs />

        {error ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-semibold">{error}</p><button className="mt-1 min-h-11 text-sm font-semibold underline" onClick={load}>Coba lagi</button></div>
          </div>
        ) : loading ? (
          <OpsListSkeleton />
        ) : (
          <>
            {/* Filters: month, (area), search, view */}
            <div className="space-y-2 md:flex md:flex-wrap md:items-center md:gap-2 md:space-y-0">
              <div className="flex gap-2">
                <MonthNav month={month} today={today} onChange={(m) => { setMonth(m); setPick(null); }} className="min-w-0 flex-1 justify-between md:flex-none" />
                <div role="tablist" aria-label="Tampilan" className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5 md:order-last">
                  {([['calendar', 'Kalender', CalendarDays], ['list', 'Daftar', List]] as const).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={view === key}
                      onClick={() => setView(key)}
                      className={cn('inline-flex h-full items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold transition', view === key ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50')}
                    >
                      <Icon className="h-3.5 w-3.5" />{label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 md:contents">
                <OpsSearchInput value={query} onChange={setQuery} placeholder="Cari toko / kota / Ops…" className="min-w-0 flex-1 md:max-w-sm md:flex-none" />
                {isHO && multiArea && (
                  <OpsFilterSelect label="Area" value={area} onChange={(v) => { setArea(v); setStoreId(null); }} className="min-w-0 shrink-0 [&>select]:max-w-[150px] md:[&>select]:max-w-[240px]">
                    <option value="all">Semua area</option>
                    {report?.areas.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                  </OpsFilterSelect>
                )}
              </div>
              <StoreCombobox stores={areaStores} value={storeId} onChange={setStoreId} allLabel="Semua toko" className="w-full md:w-60" />
            </div>

            {/* Three numbers for the month — no more */}
            <dl className="grid grid-cols-3 gap-2 sm:gap-3">
              <Stat label="Visit" more=" dilakukan" value={monthVisits.length} tone="done" />
              <Stat label="Toko" more=" dikunjungi" value={visitedStores} tone="done" />
              <Stat label="Terlewat" more="" value={monthMissed.length} tone="overdue" />
            </dl>

            {view === 'calendar' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <ReportCalendar
                    month={month}
                    weeks={weeks}
                    visits={visits}
                    missed={missed}
                    stores={stores}
                    today={today}
                    pick={activePick}
                    onPick={setPick}
                    loading={api.validating}
                  />
                  <div className="xl:sticky xl:top-4">
                    <ReportDayPanel day={activePick} visits={visits} missed={missed} stores={stores} today={today} showArea={showArea} onOpenVisit={setOpenVisit} />
                  </div>
                </div>
                <ReportLegend className="px-1" />
                {trackedLabel && <p className="px-1 text-xs text-slate-500">Riwayat dicatat sejak {trackedLabel}; periode sebelum itu tidak dinilai.</p>}
              </div>
            ) : (
              <VisitTable visits={monthVisits} storeById={storeById} showArea={showArea} onOpen={setOpenVisit} />
            )}
          </>
        )}
      </div>
      <VisitResultSheet visitId={openVisit} onClose={() => setOpenVisit(null)} />
    </div>
  );
}

function Stat({ label, more, value, tone }: { label: string; /** Said only from sm up. */ more: string; value: number; tone: 'done' | 'overdue' }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', TONE[tone].dot)} />
      <dt className="truncate pl-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}<span className="hidden sm:inline">{more}</span></dt>
      <dd className={cn('pl-1 text-2xl font-bold tabular-nums', value ? TONE[tone].text : 'text-slate-300')}>{value}</dd>
    </div>
  );
}

/** The visits that were made — newest first, the date shown once per day. */
function VisitTable({ visits, storeById, showArea, onOpen }: { visits: CalendarVisit[]; storeById: Map<number, ReportStore>; showArea: boolean; onOpen: (visitId: string) => void }) {
  const rows = useMemo(() => [...visits].sort((a, b) => b.at.localeCompare(a.at)), [visits]);
  if (rows.length === 0) {
    return <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Belum ada visit pada bulan ini.</p>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-3 py-2 sm:px-4">Tanggal</th>
            <th scope="col" className="px-3 py-2">Toko</th>
            {showArea && <th scope="col" className="hidden px-3 py-2 xl:table-cell">Area</th>}
            <th scope="col" className="hidden px-3 py-2 xl:table-cell">Kota</th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">Oleh</th>
            <th scope="col" className="w-8 py-2 pr-2"><span className="sr-only">Buka</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((v, i) => {
            const s = storeById.get(v.storeId);
            const first = i === 0 || rows[i - 1].day !== v.day;
            return (
              <tr key={v.id} onClick={() => onOpen(v.id)} className={cn('group cursor-pointer transition-colors hover:bg-indigo-50/40', first && i > 0 && 'border-t-2 border-t-slate-100')}>
                <td className="whitespace-nowrap px-3 py-2 sm:px-4">
                  {first ? <span className="font-semibold text-slate-900">{dayShort(v.day)}</span> : <span className="text-slate-300" aria-hidden>·</span>}
                  <span className="ml-2 text-xs tabular-nums text-slate-500">{jakartaTime(v.at)}</span>
                </td>
                <td className="px-3 py-2 sm:min-w-[11rem]">
                  {s ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(v.id); }} aria-label={`Lihat hasil visit ${s.name}`} className="flex min-w-0 max-w-[11rem] items-center gap-2 text-left focus-visible:outline-none sm:max-w-[22rem]">
                      <span aria-hidden className={cn('h-5 w-1 shrink-0 rounded-full', TONE.done.dot)} />
                      <span className="min-w-0"><span className="line-clamp-2 font-semibold leading-snug text-slate-900 sm:line-clamp-1">{s.name}</span><span className="block truncate text-xs text-slate-500">{s.storeNo}<span className="xl:hidden"> · {s.policy?.city || s.areaName}</span><span className="sm:hidden"> · {v.by ?? 'Ops'}</span></span></span>
                    </button>
                  ) : '—'}
                </td>
                {showArea && <td className="hidden max-w-[11rem] truncate px-3 py-2 text-slate-600 xl:table-cell">{s?.areaName}</td>}
                <td className="hidden px-3 py-2 text-slate-600 xl:table-cell">{s?.policy?.city || '—'}</td>
                <td className="hidden px-3 py-2 text-slate-600 sm:table-cell"><span className="block max-w-[11rem] truncate">{v.by ?? 'Ops'}</span></td>
                <td className="py-2 pr-2 text-slate-300 group-hover:text-indigo-500"><ChevronRight className="h-4 w-4" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

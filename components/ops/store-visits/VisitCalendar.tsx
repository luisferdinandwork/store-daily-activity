'use client';
// components/ops/store-visits/VisitCalendar.tsx
//
// The visit Report's calendar: a month of Monday–Sunday weeks (the same weeks a
// 7-day store's visit cycle uses), each day listing its visits, each week ending
// in a "x / y toko" coverage cell. Picking a day or a week fills the side panel
// (VisitCalendarPanel): who visited what that day, or which stores still owe a
// visit that week.

import Link from 'next/link';
import { ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';

import { cn } from '@/lib/utils';
import { jakartaDateKey, jakartaTime } from '@/lib/day-bucket';
import { cycleRangeLabel } from '@/lib/store-visit/cycles';
import { weekCoverage, type CalendarVisit, type ReportStore } from '@/lib/store-visit/report';
import { daysAgoLabel } from './shared';

export type CalendarPick = { kind: 'day'; day: string } | { kind: 'week'; week: string[] };

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default function VisitCalendar({
  month,
  weeks,
  visits,
  stores,
  today,
  trackedFrom,
  pick,
  onPick,
  onMonthChange,
  loading,
}: {
  month: string;
  weeks: string[][];
  visits: CalendarVisit[];
  stores: ReportStore[];
  today: string;
  trackedFrom: string | null;
  pick: CalendarPick | null;
  onPick: (pick: CalendarPick) => void;
  onMonthChange: (month: string) => void;
  loading?: boolean;
}) {
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const byDay = new Map<string, CalendarVisit[]>();
  for (const v of visits) byDay.set(v.day, [...(byDay.get(v.day) ?? []), v]);
  const thisMonth = today.slice(0, 7);

  return (
    <section aria-label={`Kalender visit ${monthLabel(month)}`} className={cn('overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-opacity', loading && 'opacity-60')}>
      {/* Month navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Bulan sebelumnya" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-[150px] text-center text-base font-semibold capitalize text-slate-900">{monthLabel(month)}</h2>
          <button type="button" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Bulan berikutnya" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {month !== thisMonth && (
          <button type="button" onClick={() => onMonthChange(thisMonth)} className="h-8 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-200">
            Bulan ini
          </button>
        )}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid-cols-[repeat(7,minmax(0,1fr))_168px]">
        {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
        <div className="hidden py-2 lg:block">Toko mingguan</div>
      </div>

      {weeks.map((week) => {
        const cov = weekCoverage(week, stores, visits, today, trackedFrom);
        const weekPicked = pick?.kind === 'week' && pick.week[0] === week[0];
        const rate = cov.total ? Math.round((cov.visited / cov.total) * 100) : 0;
        const missing = cov.total - cov.visited;
        return (
          <div key={week[0]} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0 lg:grid-cols-[repeat(7,minmax(0,1fr))_168px]">
            {week.map((day, i) => {
              const list = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === month;
              const isToday = day === today;
              const picked = pick?.kind === 'day' && pick.day === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPick({ kind: 'day', day })}
                  aria-pressed={picked}
                  aria-label={`${longDay(day)}: ${list.length} visit`}
                  className={cn(
                    'group relative flex min-h-[64px] flex-col items-stretch gap-1 border-slate-100 p-1.5 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50 lg:min-h-[112px] lg:p-2',
                    i < 6 && 'border-r',
                    !inMonth && 'bg-slate-50/60',
                    day > today && 'bg-slate-50/30',
                    picked && 'bg-indigo-50 ring-2 ring-inset ring-indigo-400',
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                      isToday ? 'bg-slate-900 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300',
                    )}>
                      {Number(day.slice(8))}
                    </span>
                    {list.length > 0 && (
                      <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold tabular-nums leading-4 text-white">{list.length}</span>
                    )}
                  </span>
                  {/* Phones: just dots; wider screens: who and where */}
                  <span className="flex flex-wrap gap-0.5 lg:hidden">
                    {list.slice(0, 4).map((v) => <span key={v.id} className="h-1.5 w-1.5 rounded-full bg-indigo-500" />)}
                  </span>
                  <span className="hidden min-w-0 flex-col gap-0.5 lg:flex">
                    {list.slice(0, 3).map((v) => {
                      const s = storeById.get(v.storeId);
                      return (
                        <span key={v.id} className="truncate rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] leading-tight text-indigo-900">
                          <span className="font-semibold">{s?.storeNo ?? '—'}</span>
                          {v.by && <span className="hidden text-indigo-700/80 2xl:inline"> · {v.by.split(' ')[0]}</span>}
                        </span>
                      );
                    })}
                    {list.length > 3 && <span className="px-1.5 text-[11px] font-semibold text-slate-500">+{list.length - 3} lagi</span>}
                  </span>
                </button>
              );
            })}

            {/* Week coverage — 7-day stores' cycle is exactly this week */}
            <button
              type="button"
              onClick={() => onPick({ kind: 'week', week })}
              aria-pressed={weekPicked}
              className={cn(
                'col-span-7 flex items-center gap-3 border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-left transition-colors hover:bg-indigo-50/50 focus:outline-none focus-visible:bg-indigo-50 lg:col-span-1 lg:flex-col lg:items-stretch lg:justify-center lg:gap-1.5 lg:border-l lg:border-t-0',
                weekPicked && 'bg-indigo-50 ring-2 ring-inset ring-indigo-400',
              )}
            >
              <span className="text-[11px] font-semibold text-slate-500">{cycleRangeLabel({ start: week[0], end: week[6] })}</span>
              {cov.untracked || cov.future || !cov.total ? (
                <span className="text-xs text-slate-400">{cov.future ? 'Belum berjalan' : cov.untracked ? 'Sebelum dicatat' : 'Tidak ada toko mingguan'}</span>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-2 lg:flex-col lg:items-stretch lg:gap-1">
                  <span className="text-sm tabular-nums text-slate-600">
                    <span className="font-semibold text-slate-900">{cov.visited}</span>/{cov.total} toko
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 lg:flex-none">
                    <span className={cn('block h-full rounded-full', rate >= 100 ? 'bg-emerald-500' : week[6] < today ? 'bg-rose-500' : 'bg-amber-400')} style={{ width: `${rate}%` }} />
                  </span>
                  {missing > 0 && (
                    <span className={cn('text-[11px] font-semibold', week[6] < today ? 'text-rose-600' : 'text-amber-700')}>
                      {missing} {week[6] < today ? 'terlewat' : 'belum'}
                    </span>
                  )}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </section>
  );
}

export type PanelSort = 'attention' | 'name' | 'last';

export function VisitCalendarPanel({
  pick,
  visits,
  stores,
  today,
  trackedFrom,
  sort,
}: {
  pick: CalendarPick | null;
  visits: CalendarVisit[];
  stores: ReportStore[];
  today: string;
  trackedFrom: string | null;
  sort: PanelSort;
}) {
  const storeById = new Map(stores.map((s) => [s.id, s]));
  if (!pick) {
    return (
      <aside className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        Pilih tanggal atau baris minggu di kalender.
      </aside>
    );
  }

  if (pick.kind === 'day') {
    const list = visits.filter((v) => v.day === pick.day);
    const sorted = [...list].sort((a, b) => {
      if (sort === 'name') return (storeById.get(a.storeId)?.name ?? '').localeCompare(storeById.get(b.storeId)?.name ?? '');
      return a.at.localeCompare(b.at);
    });
    return (
      <aside className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">{pick.day === today ? 'Visit hari ini' : 'Visit tanggal ini'}</p>
          <h3 className="mt-0.5 text-sm font-semibold capitalize text-slate-900">{longDay(pick.day)}</h3>
          <p className="text-xs text-slate-500">{list.length} visit · {new Set(list.map((v) => v.storeId)).size} toko</p>
        </div>
        {sorted.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">{pick.day > today ? 'Belum terjadi.' : 'Tidak ada visit pada hari ini.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sorted.map((v) => {
              const s = storeById.get(v.storeId);
              return (
                <li key={v.id}>
                  <Link href={`/ops/store-visits/${v.storeId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><MapPin className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{s?.name ?? `Toko ${v.storeId}`}</span>
                      <span className="block truncate text-xs text-slate-500">{s?.storeNo} · oleh {v.by ?? 'Ops'}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-slate-500"><Clock className="h-3 w-3" />{jakartaTime(v.at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    );
  }

  const cov = weekCoverage(pick.week, stores, visits, today, trackedFrom);
  const ended = pick.week[6] < today;
  const order = (a: (typeof cov.stores)[number], b: (typeof cov.stores)[number]) => {
    if (sort === 'last') return (b.store.lastVisit?.at ?? '').localeCompare(a.store.lastVisit?.at ?? '');
    return a.store.name.localeCompare(b.store.name);
  };
  const owing = cov.stores.filter((r) => !r.met).sort(order);
  const done = cov.stores.filter((r) => r.met).sort(order);

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">Minggu {cycleRangeLabel({ start: pick.week[0], end: pick.week[6] })}</p>
        <h3 className="mt-0.5 text-sm font-semibold text-slate-900">
          {cov.future ? 'Minggu ini belum dimulai' : cov.untracked ? 'Sebelum visit dicatat' : `${cov.visited} dari ${cov.total} toko mingguan dikunjungi`}
        </h3>
        <p className="text-xs text-slate-500">Toko dengan jadwal 60/90 hari dinilai per periodenya sendiri — lihat tab Per toko.</p>
      </div>
      {!cov.future && !cov.untracked && (
        <div className="max-h-[560px] overflow-y-auto">
          <PanelGroup title={ended ? 'Terlewat' : 'Belum dikunjungi'} tone={ended ? 'rose' : 'amber'} count={owing.length}>
            {owing.map(({ store }) => (
              <PanelStore key={store.id} store={store} line={`${store.opsNames.length ? `Ops: ${store.opsNames.join(', ')} · ` : ''}${store.lastVisit ? `terakhir ${daysAgoLabel(jakartaDateKey(store.lastVisit.at)).toLowerCase()}` : 'belum pernah dikunjungi'}`} />
            ))}
          </PanelGroup>
          <PanelGroup title="Sudah dikunjungi" tone="emerald" count={done.length}>
            {done.map(({ store, days }) => {
              const who = [...new Set(visits.filter((v) => v.storeId === store.id && days.includes(v.day)).map((v) => v.by ?? 'Ops'))];
              return (
                <PanelStore
                  key={store.id}
                  store={store}
                  line={`${days.map((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })).join(', ')} · ${who.join(', ')}`}
                />
              );
            })}
          </PanelGroup>
        </div>
      )}
    </aside>
  );
}

function PanelGroup({ title, tone, count, children }: { title: string; tone: 'rose' | 'amber' | 'emerald'; count: number; children: React.ReactNode }) {
  if (!count) return null;
  const dot = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div>
      <p className="flex items-center gap-2 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span className={cn('h-2 w-2 rounded-full', dot)} />{title}<span className="tabular-nums text-slate-400">{count}</span>
      </p>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </div>
  );
}

function PanelStore({ store, line }: { store: ReportStore; line: string }) {
  return (
    <li>
      <Link href={`/ops/store-visits/${store.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
        <span className="block truncate text-sm font-semibold text-slate-900">{store.name}</span>
        <span className="block truncate text-xs text-slate-500">{store.storeNo} · {line}</span>
      </Link>
    </li>
  );
}

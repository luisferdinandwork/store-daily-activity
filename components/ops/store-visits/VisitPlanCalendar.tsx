'use client';
// components/ops/store-visits/VisitPlanCalendar.tsx
//
// The Report's calendar: "which store do I visit next?". A month of Monday–Sunday
// weeks (the weeks a 7-day store's cycle uses). Each day shows what was visited
// (green, with a tick) and what the planner suggests (indigo / amber / rose by how
// urgent — see tones.ts); each week ends in a summary: visited / owed, planned,
// and the cycles ending in it. Picking a day or a week fills the side panel.

import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight, ChevronsRight, Clock, Plane } from 'lucide-react';

import { cn } from '@/lib/utils';
import { jakartaTime } from '@/lib/day-bucket';
import { cycleRangeLabel } from '@/lib/store-visit/cycles';
import { weekCoverage, type CalendarVisit, type ReportStore } from '@/lib/store-visit/report';
import {
  PLAN_HORIZON_DAYS,
  planReason,
  relativeDay,
  storeUrgency,
  toneRank,
  urgencyTone,
  weekPlanSummary,
  type PlanItem,
  type PlanTone,
} from '@/lib/store-visit/plan';
import { TONE, TONE_ORDER } from './tones';

export type CalendarPick = { kind: 'day'; day: string } | { kind: 'week'; week: string[] };

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "Daan Mogot" out of "Fisik Football - Daan Mogot" — the part that tells stores apart on a small chip. */
export function shortStoreName(name: string): string {
  const tail = name.split(/\s*-\s*/).pop()?.trim();
  return tail || name;
}

type DayEntry =
  | { kind: 'plan'; key: string; store: ReportStore | undefined; item: PlanItem }
  | { kind: 'done'; key: string; store: ReportStore | undefined; visit: CalendarVisit };

const entryTone = (e: DayEntry): PlanTone => (e.kind === 'plan' ? e.item.tone : 'done');

function dayEntries(day: string, today: string, visits: CalendarVisit[], plan: PlanItem[], storeById: Map<number, ReportStore>): DayEntry[] {
  const entries: DayEntry[] = [];
  for (const p of plan) if (p.day === day) entries.push({ kind: 'plan', key: p.key, store: storeById.get(p.storeId), item: p });
  if (day <= today) for (const v of visits) if (v.day === day) entries.push({ kind: 'done', key: v.id, store: storeById.get(v.storeId), visit: v });
  return entries.sort((a, b) => toneRank(entryTone(a)) - toneRank(entryTone(b)) || (a.store?.name ?? '').localeCompare(b.store?.name ?? ''));
}

export function VisitLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600', className)}>
      {TONE_ORDER.filter((t) => t !== 'idle').map((tone) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <i className={cn('h-3 w-3 rounded-[4px]', TONE[tone].dot)} />
          {TONE[tone].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><i className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">1</i>Hari ini</span>
      <span className="inline-flex items-center gap-1.5"><Plane className="h-3.5 w-3.5 text-slate-400" />Luar kota</span>
    </div>
  );
}

export default function VisitPlanCalendar({
  month,
  weeks,
  visits,
  stores,
  plan,
  today,
  trackedFrom,
  horizonEnd,
  pick,
  onPick,
  onMonthChange,
  loading,
}: {
  month: string;
  weeks: string[][];
  visits: CalendarVisit[];
  stores: ReportStore[];
  plan: PlanItem[];
  today: string;
  trackedFrom: string | null;
  horizonEnd: string;
  pick: CalendarPick | null;
  onPick: (pick: CalendarPick) => void;
  onMonthChange: (month: string) => void;
  loading?: boolean;
}) {
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const thisMonth = today.slice(0, 7);
  const lastShown = weeks[weeks.length - 1]?.[6] ?? today;
  const beyondPlan = lastShown > horizonEnd;

  return (
    <section aria-label={`Kalender visit ${monthLabel(month)}`} className={cn('@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-opacity', loading && 'opacity-60')}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Bulan sebelumnya" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:bg-slate-100 sm:h-9 sm:w-9 sm:rounded-lg">
            <ChevronLeft className="h-5 w-5 sm:h-4 sm:w-4" />
          </button>
          <h2 className="min-w-[130px] text-center text-base font-semibold capitalize text-slate-900 sm:min-w-[150px]">{monthLabel(month)}</h2>
          <button type="button" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Bulan berikutnya" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:bg-slate-100 sm:h-9 sm:w-9 sm:rounded-lg">
            <ChevronRight className="h-5 w-5 sm:h-4 sm:w-4" />
          </button>
        </div>
        {month !== thisMonth && (
          <button type="button" onClick={() => onMonthChange(thisMonth)} className="h-9 shrink-0 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-200 sm:h-8">
            Bulan ini
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 @4xl:grid-cols-[repeat(7,minmax(0,1fr))_172px]">
        {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
        <div className="hidden py-2 @4xl:block">Ringkasan minggu</div>
      </div>

      {weeks.map((week) => {
        const sum = weekPlanSummary(week, stores, visits, plan, today, trackedFrom);
        const weekPicked = pick?.kind === 'week' && pick.week[0] === week[0];
        const missing = sum.total - sum.visited;
        const segs = sum.total
          ? { done: (sum.visited / sum.total) * 100, planned: (Math.min(sum.planned, Math.max(0, missing)) / sum.total) * 100 }
          : null;
        return (
          <div key={week[0]} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0 @4xl:grid-cols-[repeat(7,minmax(0,1fr))_172px]">
            {week.map((day, i) => {
              const entries = dayEntries(day, today, visits, plan, storeById);
              const done = entries.filter((e) => e.kind === 'done').length;
              const planned = entries.filter((e) => e.kind === 'plan');
              const worst: PlanTone | null = planned.length ? entryTone(planned[0]) : null;
              const inMonth = day.slice(0, 7) === month;
              const isToday = day === today;
              const picked = pick?.kind === 'day' && pick.day === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPick({ kind: 'day', day })}
                  aria-pressed={picked}
                  aria-label={`${longDay(day)}: ${planned.length} dijadwalkan, ${done} visit`}
                  className={cn(
                    'group relative flex min-h-[54px] flex-col items-stretch gap-1 border-slate-100 p-1 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50 @2xl:min-h-[124px] @2xl:p-2',
                    i < 6 && 'border-r',
                    !inMonth && 'bg-slate-50/60',
                    day < today && 'bg-slate-50/40',
                    isToday && 'bg-indigo-50/30',
                    picked && 'bg-indigo-50 ring-2 ring-inset ring-indigo-400',
                  )}
                >
                  <span className="flex items-center justify-center gap-1 @2xl:justify-between">
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums @2xl:h-6 @2xl:w-6 @2xl:text-xs', isToday ? 'bg-slate-900 text-white' : picked ? 'bg-indigo-600 text-white @2xl:bg-transparent @2xl:text-slate-700' : inMonth ? 'text-slate-700' : 'text-slate-300')}>
                      {Number(day.slice(8))}
                    </span>
                    <span className="hidden items-center gap-1 @2xl:flex">
                      {worst && <span title={`${planned.length} dijadwalkan`} className={cn('rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4', TONE[worst].badge)}>{planned.length}</span>}
                      {done > 0 && <span title={`${done} visit`} className={cn('flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4', TONE.done.badge)}><Check className="h-2.5 w-2.5" strokeWidth={3} />{done}</span>}
                    </span>
                  </span>
                  {/* Phones: one coloured dot per entry (worst first); wider screens: the stores themselves */}
                  <span className="flex min-h-1.5 flex-wrap justify-center gap-[3px] @2xl:hidden">
                    {entries.slice(0, 6).map((e) => <span key={e.key} className={cn('h-1.5 w-1.5 rounded-full', inMonth ? TONE[entryTone(e)].dot : 'bg-slate-300')} />)}
                  </span>
                  <span className="hidden min-w-0 flex-col gap-0.5 @2xl:flex">
                    {entries.slice(0, 3).map((e) => (
                      <span key={e.key} className={cn('flex min-w-0 items-center gap-1 truncate rounded-[5px] border-l-[3px] py-0.5 pl-1.5 pr-1 text-[11px] leading-tight', TONE[entryTone(e)].chip)}>
                        {e.kind === 'done' && <Check className="hidden h-2.5 w-2.5 shrink-0 @3xl:block" strokeWidth={3} />}
                        <span className="truncate"><span className="font-bold">{e.store?.storeNo ?? '—'}</span>{e.store && <span className="hidden opacity-80 @6xl:inline"> {shortStoreName(e.store.name)}</span>}</span>
                      </span>
                    ))}
                    {entries.length > 3 && <span className="px-1 text-[11px] font-semibold text-slate-500">+{entries.length - 3} lagi</span>}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => onPick({ kind: 'week', week })}
              aria-pressed={weekPicked}
              className={cn(
                'col-span-7 hidden items-center gap-3 border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-left @2xl:flex transition-colors hover:bg-indigo-50/50 focus:outline-none focus-visible:bg-indigo-50 @4xl:col-span-1 @4xl:flex-col @4xl:items-stretch @4xl:justify-center @4xl:gap-1.5 @4xl:border-l @4xl:border-t-0',
                weekPicked && 'bg-indigo-50 ring-2 ring-inset ring-indigo-400',
              )}
            >
              <span className="text-[11px] font-semibold text-slate-500">{cycleRangeLabel({ start: week[0], end: week[6] })}</span>
              {sum.untracked ? (
                <span className="text-xs text-slate-400">Sebelum dicatat</span>
              ) : (
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  {sum.total > 0 && segs ? (
                    <>
                      <span className="text-sm tabular-nums text-slate-600"><span className="font-semibold text-slate-900">{sum.future ? sum.planned : sum.visited}</span>{sum.future ? ' dijadwalkan' : `/${sum.total} toko mingguan`}</span>
                      <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <span className={cn('h-full', TONE.done.dot)} style={{ width: `${segs.done}%` }} />
                        {!sum.past && !sum.future && <span className={cn('h-full', TONE.planned.dot)} style={{ width: `${segs.planned}%` }} />}
                        {sum.past && missing > 0 && <span className={cn('h-full', TONE.overdue.dot)} style={{ width: `${100 - segs.done}%` }} />}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">{sum.planned > 0 ? `${sum.planned} dijadwalkan` : sum.visits > 0 ? `${sum.visits} visit` : '—'}</span>
                  )}
                  <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-semibold">
                    {sum.past && missing > 0 && <span className={TONE.overdue.text}>{missing} terlewat</span>}
                    {!sum.past && !sum.future && sum.planned > 0 && <span className={TONE.planned.text}>{sum.planned} dijadwalkan</span>}
                    {sum.deadlines > 0 && !sum.past && <span className={TONE.soon.text}>{sum.deadlines} batas periode</span>}
                  </span>
                </span>
              )}
            </button>
          </div>
        );
      })}
      {beyondPlan && (
        <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
          Saran jadwal tersedia {PLAN_HORIZON_DAYS / 7} minggu ke depan (sampai {new Date(`${horizonEnd}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', timeZone: 'UTC' })}).
        </p>
      )}
    </section>
  );
}

// ─── Side panel ───────────────────────────────────────────────────────────────

export function VisitPlanPanel({
  pick,
  visits,
  stores,
  plan,
  today,
  trackedFrom,
  showArea,
  weeks,
  onPick,
}: {
  pick: CalendarPick | null;
  visits: CalendarVisit[];
  stores: ReportStore[];
  plan: PlanItem[];
  today: string;
  trackedFrom: string | null;
  /** HO: group by area and name the Ops responsible. */
  showArea: boolean;
  /** With `onPick`: phones get a Hari / Minggu switch here (the calendar has no week-summary row there). */
  weeks?: string[][];
  onPick?: (pick: CalendarPick) => void;
}) {
  const storeById = new Map(stores.map((s) => [s.id, s]));
  if (!pick) {
    return <aside className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Pilih tanggal atau ringkasan minggu di kalender.</aside>;
  }
  const switcher = weeks && onPick ? <PickSwitch pick={pick} weeks={weeks} today={today} onPick={onPick} /> : null;

  if (pick.kind === 'day') {
    const day = pick.day;
    const planned = plan.filter((p) => p.day === day);
    const made = day <= today ? visits.filter((v) => v.day === day).sort((a, b) => a.at.localeCompare(b.at)) : [];
    const heading = day === today ? 'Hari ini' : day < today ? 'Riwayat tanggal ini' : relativeDay(day, today);
    return (
      <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">{heading}</p>
            <h3 className="mt-0.5 text-sm font-semibold capitalize text-slate-900">{longDay(day)}</h3>
            <p className="text-xs text-slate-500">{planned.length} dijadwalkan · {made.length} sudah dikunjungi</p>
          </div>
          {switcher}
        </div>
        {planned.length === 0 && made.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">{day < today ? 'Tidak ada visit pada hari ini.' : 'Tidak ada jadwal visit.'}</p>
        ) : (
          <div className="xl:max-h-[620px] xl:overflow-y-auto">
            {planned.length > 0 && (
              <PanelGroup title="Perlu dikunjungi" count={planned.length}>
                {groupByArea(planned.map((p) => ({ store: storeById.get(p.storeId), p })), showArea).map(({ area, rows }) => (
                  <li key={area ?? 'all'}>
                    {area && <AreaHeader name={area} ops={rows[0].store?.opsNames ?? []} />}
                    <ul className="divide-y divide-slate-100">
                      {rows.map(({ store, p }) => store && (
                        <StoreLine
                          key={p.key}
                          store={store}
                          tone={p.tone}
                          meta={`${store.storeNo} · ${store.policy?.city || store.areaName} · ${planReason(store, p)}`}
                          trail={p.of > 1 ? `Visit ${p.visitNo}/${p.of}` : undefined}
                        />
                      ))}
                    </ul>
                  </li>
                ))}
              </PanelGroup>
            )}
            {made.length > 0 && (
              <PanelGroup title="Sudah dikunjungi" count={made.length} tone="done">
                {made.map((v) => {
                  const s = storeById.get(v.storeId);
                  return s && <StoreLine key={v.id} store={s} tone="done" meta={`${s.storeNo} · oleh ${v.by ?? 'Ops'}`} trail={jakartaTime(v.at)} trailIcon />;
                })}
              </PanelGroup>
            )}
          </div>
        )}
      </aside>
    );
  }

  const cov = weekCoverage(pick.week, stores, visits, today, trackedFrom);
  const [start, end] = [pick.week[0], pick.week[6]];
  const past = end < today;
  const planByStore = new Map<number, PlanItem[]>();
  for (const p of plan) if (p.day >= start && p.day <= end) planByStore.set(p.storeId, [...(planByStore.get(p.storeId) ?? []), p]);
  const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

  const weekly = cov.stores;
  const missed = weekly.filter((r) => !r.met && past);
  const scheduled = weekly.filter((r) => !r.met && !past && planByStore.has(r.store.id));
  const unscheduled = weekly.filter((r) => !r.met && !past && !planByStore.has(r.store.id));
  const done = weekly.filter((r) => r.met);
  const deadlines = stores.filter((s) => s.cycle && s.policy && s.policy.intervalDays > 7 && !s.cycle.met && s.cycle.end >= start && s.cycle.end <= end && s.cycle.end >= today);

  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">Minggu {cycleRangeLabel({ start, end })}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-slate-900">
            {cov.untracked ? 'Sebelum visit dicatat' : cov.future ? `${[...planByStore.values()].flat().length} visit dijadwalkan` : `${cov.visited} dari ${cov.total} toko mingguan dikunjungi`}
          </h3>
          <p className="text-xs text-slate-500">Toko 60/90 hari dinilai per periodenya sendiri; yang batasnya jatuh minggu ini ada di bawah.</p>
        </div>
        {switcher}
      </div>
      {!cov.untracked && (
        <div className="xl:max-h-[620px] xl:overflow-y-auto">
          <PanelGroup title="Terlewat" count={missed.length} tone="overdue">
            {missed.map(({ store }) => <StoreLine key={store.id} store={store} tone="overdue" meta={`${store.storeNo} · ${store.policy?.city || store.areaName} · ${store.lastVisit ? 'terakhir ' + dayName(store.lastVisit.at.slice(0, 10)) : 'belum pernah dikunjungi'}`} />)}
          </PanelGroup>
          <PanelGroup title="Dijadwalkan" count={scheduled.length} tone="planned">
            {scheduled.map(({ store }) => {
              const items = planByStore.get(store.id)!;
              return <StoreLine key={store.id} store={store} tone={items[0].tone} meta={`${store.storeNo} · ${planReason(store, items[0])}`} trail={items.map((i) => dayName(i.day)).join(' · ')} />;
            })}
          </PanelGroup>
          <PanelGroup title="Belum ada slot" count={unscheduled.length} tone="soon">
            {unscheduled.map(({ store }) => <StoreLine key={store.id} store={store} tone="soon" meta={`${store.storeNo} · ${store.policy?.city || store.areaName}`} />)}
          </PanelGroup>
          <PanelGroup title="Batas periode 60/90 hari" count={deadlines.length} tone="soon">
            {deadlines.map((store) => <StoreLine key={store.id} store={store} tone={urgencyTone(storeUrgency(store))} meta={`${store.storeNo} · ${store.policy?.city || store.areaName} · ${planReason(store)}`} />)}
          </PanelGroup>
          <PanelGroup title="Sudah dikunjungi" count={done.length} tone="done">
            {done.map(({ store, days }) => <StoreLine key={store.id} store={store} tone="done" meta={`${store.storeNo} · ${days.map(dayName).join(', ')}`} />)}
          </PanelGroup>
        </div>
      )}
    </aside>
  );
}

/** Hari / Minggu — phones only; from md up the calendar's own week column does this job. */
function PickSwitch({ pick, weeks, today, onPick }: { pick: CalendarPick; weeks: string[][]; today: string; onPick: (pick: CalendarPick) => void }) {
  const week = pick.kind === 'week' ? pick.week : weeks.find((w) => w.includes(pick.day));
  if (!week) return null;
  const items = [
    { kind: 'day' as const, label: 'Hari', go: () => onPick({ kind: 'day', day: week.includes(today) ? today : week[0] }) },
    { kind: 'week' as const, label: 'Minggu', go: () => onPick({ kind: 'week', week }) },
  ];
  return (
    <div role="tablist" aria-label="Rentang" className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 md:hidden">
      {items.map((i) => (
        <button
          key={i.kind}
          type="button"
          role="tab"
          aria-selected={pick.kind === i.kind}
          onClick={i.go}
          className={cn('h-8 rounded-md px-3 text-xs font-bold transition', pick.kind === i.kind ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

function groupByArea<T extends { store: ReportStore | undefined }>(rows: T[], by: boolean): { area: string | null; rows: T[] }[] {
  if (!by) return [{ area: null, rows }];
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.store?.areaName ?? '—', [...(map.get(r.store?.areaName ?? '—') ?? []), r]);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([area, list]) => ({ area, rows: list }));
}

function AreaHeader({ name, ops }: { name: string; ops: string[] }) {
  return (
    <p className="flex items-baseline justify-between gap-2 border-y border-slate-100 bg-white px-4 py-1.5 text-[11px] font-bold text-slate-700">
      <span className="truncate">{name}</span>
      {ops.length > 0 && <span className="shrink-0 truncate font-medium text-slate-500">Ops: {ops.join(', ')}</span>}
    </p>
  );
}

function PanelGroup({ title, count, tone, children }: { title: string; count: number; tone?: PlanTone; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <div>
      <p className={cn('flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider', tone ? `${TONE[tone].soft} ${TONE[tone].text}` : 'bg-slate-50 text-slate-500')}>
        <span className={cn('h-2 w-2 rounded-full', TONE[tone ?? 'planned'].dot)} />{title}<span className="tabular-nums opacity-70">{count}</span>
      </p>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </div>
  );
}

function StoreLine({ store, tone, meta, trail, trailIcon }: { store: ReportStore; tone: PlanTone; meta: string; trail?: string; trailIcon?: boolean }) {
  return (
    <li>
      <Link href={`/ops/store-visits/${store.id}`} className={cn('flex items-center gap-3 border-l-4 px-3.5 py-2.5 transition-colors hover:bg-slate-50', TONE[tone].edge)}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
            <span className="truncate">{store.name}</span>
            {store.policy?.category === 'out_city' && <Plane aria-label="Luar kota" className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          </span>
          <span className="block truncate text-xs text-slate-500">{meta}</span>
        </span>
        {trail && <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-slate-500">{trailIcon && <Clock className="h-3 w-3" />}{trail}</span>}
        <ChevronsRight className="h-4 w-4 shrink-0 text-slate-300" />
      </Link>
    </li>
  );
}

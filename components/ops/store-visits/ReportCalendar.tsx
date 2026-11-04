'use client';
// components/ops/store-visits/ReportCalendar.tsx
//
// The Report's calendar: what already happened, nothing upcoming. A month of Monday–Sunday
// weeks; each day shows the stores that were visited (green, with a tick) and the stores
// whose period ENDED that day without enough visits (rose, "terlewat"). Picking a day fills
// the side panel. Colours come from tones.ts.

import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight, ChevronsRight, Clock, Plane, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { jakartaTime } from '@/lib/day-bucket';
import { cycleRangeLabel } from '@/lib/store-visit/cycles';
import type { CalendarVisit, MissedCycle, ReportStore } from '@/lib/store-visit/report';
import type { VisitTone } from '@/lib/store-visit/upcoming';
import { TONE } from './tones';

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

export function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "Daan Mogot" out of "Fisik Football - Daan Mogot" — the part that tells stores apart on a small chip. */
function shortStoreName(name: string): string {
  const tail = name.split(/\s*-\s*/).pop()?.trim();
  return tail || name;
}

type DayEntry =
  | { kind: 'done'; key: string; tone: VisitTone; store: ReportStore | undefined }
  | { kind: 'missed'; key: string; tone: VisitTone; store: ReportStore | undefined };

/** What a day holds: one chip per store visited (however many visits), then the periods that ended short. */
function dayEntries(day: string, visits: CalendarVisit[], missed: MissedCycle[], storeById: Map<number, ReportStore>): DayEntry[] {
  const entries: DayEntry[] = [];
  const seen = new Set<number>();
  for (const v of visits) {
    if (v.day !== day || seen.has(v.storeId)) continue;
    seen.add(v.storeId);
    entries.push({ kind: 'done', key: `v${v.id}`, tone: 'done', store: storeById.get(v.storeId) });
  }
  for (const m of missed) if (m.day === day) entries.push({ kind: 'missed', key: `m${m.storeId}:${m.start}`, tone: 'overdue', store: storeById.get(m.storeId) });
  return entries;
}

export function MonthNav({ month, today, onChange, className }: { month: string; today: string; onChange: (month: string) => void; className?: string }) {
  const thisMonth = today.slice(0, 7);
  return (
    <div className={cn('inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-0.5', className)}>
      <button type="button" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Bulan sebelumnya" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[8.5rem] text-center text-sm font-semibold capitalize text-slate-900">{monthLabel(month)}</span>
      <button type="button" onClick={() => onChange(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Bulan berikutnya" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ReportLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600', className)}>
      <span className="inline-flex items-center gap-1.5"><i className={cn('h-3 w-3 rounded-[4px]', TONE.done.dot)} />Sudah dikunjungi</span>
      <span className="inline-flex items-center gap-1.5"><i className={cn('h-3 w-3 rounded-[4px]', TONE.overdue.dot)} />Terlewat — periode berakhir tanpa cukup visit</span>
      <span className="inline-flex items-center gap-1.5"><i className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">1</i>Hari ini</span>
      <span className="inline-flex items-center gap-1.5"><Plane className="h-3.5 w-3.5 text-slate-400" />Luar kota</span>
    </div>
  );
}

export default function ReportCalendar({
  month,
  weeks,
  visits,
  missed,
  stores,
  today,
  pick,
  onPick,
  loading,
}: {
  month: string;
  weeks: string[][];
  visits: CalendarVisit[];
  missed: MissedCycle[];
  stores: ReportStore[];
  today: string;
  pick: string | null;
  onPick: (day: string) => void;
  loading?: boolean;
}) {
  const storeById = new Map(stores.map((s) => [s.id, s]));

  return (
    <section aria-label={`Kalender visit ${monthLabel(month)}`} className={cn('@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-opacity', loading && 'opacity-60')}>
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>

      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
          {week.map((day, i) => {
            const entries = dayEntries(day, visits, missed, storeById);
            const doneN = entries.filter((e) => e.kind === 'done').length;
            const missedN = entries.length - doneN;
            const inMonth = day.slice(0, 7) === month;
            const isToday = day === today;
            const picked = pick === day;
            return (
              <button
                key={day}
                type="button"
                onClick={() => onPick(day)}
                aria-pressed={picked}
                aria-label={`${longDay(day)}: ${doneN} toko dikunjungi, ${missedN} terlewat`}
                className={cn(
                  'relative flex min-h-[54px] flex-col items-stretch gap-1 border-slate-100 p-1 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50 @2xl:min-h-[112px] @2xl:p-2',
                  i < 6 && 'border-r',
                  !inMonth && 'bg-slate-50/60',
                  day > today && 'bg-slate-50/40',
                  picked && 'bg-indigo-50 ring-2 ring-inset ring-indigo-400',
                )}
              >
                <span className="flex items-center justify-center gap-1 @2xl:justify-between">
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums @2xl:h-6 @2xl:w-6 @2xl:text-xs', isToday ? 'bg-slate-900 text-white' : picked ? 'bg-indigo-600 text-white @2xl:bg-transparent @2xl:text-slate-700' : inMonth ? 'text-slate-700' : 'text-slate-300')}>
                    {Number(day.slice(8))}
                  </span>
                  <span className="hidden items-center gap-1 @2xl:flex">
                    {missedN > 0 && <span title={`${missedN} terlewat`} className={cn('flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4', TONE.overdue.badge)}><X className="h-2.5 w-2.5" strokeWidth={3} />{missedN}</span>}
                    {doneN > 0 && <span title={`${doneN} toko dikunjungi`} className={cn('flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4', TONE.done.badge)}><Check className="h-2.5 w-2.5" strokeWidth={3} />{doneN}</span>}
                  </span>
                </span>
                {/* Phones: one coloured dot per entry; wider screens: the stores themselves */}
                <span className="flex min-h-1.5 flex-wrap justify-center gap-[3px] @2xl:hidden">
                  {entries.slice(0, 6).map((e) => <span key={e.key} className={cn('h-1.5 w-1.5 rounded-full', inMonth ? TONE[e.tone].dot : 'bg-slate-300')} />)}
                </span>
                <span className="hidden min-w-0 flex-col gap-0.5 @2xl:flex">
                  {entries.slice(0, 3).map((e) => (
                    <span key={e.key} className={cn('flex min-w-0 items-center gap-1 truncate rounded-[5px] border-l-[3px] py-0.5 pl-1.5 pr-1 text-[11px] leading-tight', TONE[e.tone].chip)}>
                      {e.kind === 'done' ? <Check className="hidden h-2.5 w-2.5 shrink-0 @3xl:block" strokeWidth={3} /> : <X className="hidden h-2.5 w-2.5 shrink-0 @3xl:block" strokeWidth={3} />}
                      <span className="truncate"><span className="font-bold">{e.store?.storeNo ?? '—'}</span>{e.store && <span className="hidden opacity-80 @6xl:inline"> {shortStoreName(e.store.name)}</span>}</span>
                    </span>
                  ))}
                  {entries.length > 3 && <span className="px-1 text-[11px] font-semibold text-slate-500">+{entries.length - 3} lagi</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// ─── Side panel ───────────────────────────────────────────────────────────────

export function ReportDayPanel({
  day,
  visits,
  missed,
  stores,
  today,
  showArea,
  onOpenVisit,
}: {
  day: string | null;
  visits: CalendarVisit[];
  missed: MissedCycle[];
  stores: ReportStore[];
  today: string;
  /** HO looking at every area: name the area beside each store. */
  showArea: boolean;
  /** A visit line opens its result (the Report's preview sheet). */
  onOpenVisit?: (visitId: string) => void;
}) {
  if (!day) {
    return <aside className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Pilih tanggal di kalender.</aside>;
  }
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const made = visits.filter((v) => v.day === day).sort((a, b) => a.at.localeCompare(b.at));
  const short = missed.filter((m) => m.day === day);
  const heading = day === today ? 'Hari ini' : day > today ? 'Belum terjadi' : 'Riwayat tanggal ini';

  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">{heading}</p>
        <h3 className="mt-0.5 text-sm font-semibold capitalize text-slate-900">{longDay(day)}</h3>
        <p className="text-xs text-slate-500">{made.length} visit · {short.length} terlewat</p>
      </div>
      {made.length === 0 && short.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400">{day > today ? 'Tanggal ini belum tiba.' : 'Tidak ada visit pada hari ini.'}</p>
      ) : (
        <div className="xl:max-h-[560px] xl:overflow-y-auto">
          {made.length > 0 && (
            <PanelGroup title="Sudah dikunjungi" count={made.length} tone="done">
              {made.map((v) => {
                const s = storeById.get(v.storeId);
                return s && (
                  <StoreLine key={v.id} store={s} tone="done" meta={`${s.storeNo} · ${showArea ? s.areaName : s.policy?.city || s.areaName} · oleh ${v.by ?? 'Ops'}`} trail={jakartaTime(v.at)} trailIcon onOpen={onOpenVisit ? () => onOpenVisit(v.id) : undefined} />
                );
              })}
            </PanelGroup>
          )}
          {short.length > 0 && (
            <PanelGroup title="Terlewat" count={short.length} tone="overdue">
              {short.map((m) => {
                const s = storeById.get(m.storeId);
                return s && (
                  <StoreLine key={`${m.storeId}:${m.start}`} store={s} tone="overdue" meta={`${s.storeNo} · periode ${cycleRangeLabel({ start: m.start, end: m.day })}`} trail={`${m.count}/${m.needed} visit`} />
                );
              })}
            </PanelGroup>
          )}
        </div>
      )}
    </aside>
  );
}

function PanelGroup({ title, count, tone, children }: { title: string; count: number; tone: VisitTone; children: React.ReactNode }) {
  return (
    <div>
      <p className={cn('flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider', TONE[tone].soft, TONE[tone].text)}>
        <span className={cn('h-2 w-2 rounded-full', TONE[tone].dot)} />{title}<span className="tabular-nums opacity-70">{count}</span>
      </p>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </div>
  );
}

function StoreLine({ store, tone, meta, trail, trailIcon, onOpen }: { store: ReportStore; tone: VisitTone; meta: string; trail?: string; trailIcon?: boolean; onOpen?: () => void }) {
  const className = cn('flex w-full items-center gap-3 border-l-4 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50', TONE[tone].edge);
  const body = <>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
            <span className="truncate">{store.name}</span>
            {store.policy?.category === 'out_city' && <Plane aria-label="Luar kota" className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          </span>
          <span className="block truncate text-xs text-slate-500">{meta}</span>
        </span>
        {trail && <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-slate-500">{trailIcon && <Clock className="h-3 w-3" />}{trail}</span>}
        <ChevronsRight className="h-4 w-4 shrink-0 text-slate-300" />
  </>;
  return (
    <li>
      {onOpen
        ? <button type="button" onClick={onOpen} aria-label={`Lihat hasil visit ${store.name}`} className={className}>{body}</button>
        : <Link href={`/ops/store-visits/${store.id}`} className={className}>{body}</Link>}
    </li>
  );
}

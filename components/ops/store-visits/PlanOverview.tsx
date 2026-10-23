'use client';
// components/ops/store-visits/PlanOverview.tsx
//
// What sits above the Report's calendar:
//   • SummaryTiles — Terlewat / Segera berakhir / Dijadwalkan 7 hari / Terpenuhi
//   • NextUp       — Ops Area: "Kunjungi berikutnya", the stores to go to first
//   • AreaMonitor  — Ops HO: every area's backlog, worst first; a row picks the area

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarCheck, CheckCircle2, ChevronDown, Plane } from 'lucide-react';

import { cn } from '@/lib/utils';
import { jakartaDateKey } from '@/lib/day-bucket';
import { planReason, relativeDay, type AreaRollup, type PlanItem, type PlanTone } from '@/lib/store-visit/plan';
import type { ReportStore } from '@/lib/store-visit/report';
import { daysAgoLabel } from './shared';
import { TonePill } from './VisitQueue';
import { TONE } from './tones';

export function SummaryTiles({
  tiles,
  loading,
  onSelect,
}: {
  /** `short` is the one-word label a phone shows (four tiles share one row there); `hint` is for wider screens. */
  tiles: { tone: PlanTone; label: string; short?: string; value: number; hint: string; key: string }[];
  loading?: boolean;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <>
            <span className={cn('absolute inset-x-0 top-0 h-1 sm:inset-y-0 sm:left-0 sm:right-auto sm:h-auto sm:w-1.5', TONE[t.tone].dot)} />
            <p className="truncate text-[11px] font-bold tracking-tight text-slate-500 sm:uppercase sm:tracking-wide">
              <span className="sm:hidden">{t.short ?? t.label}</span><span className="hidden sm:inline">{t.label}</span>
            </p>
            <p className={cn('mt-0.5 text-2xl font-bold tabular-nums sm:mt-1 sm:text-3xl', t.value ? TONE[t.tone].text : 'text-slate-300')}>{loading ? '–' : t.value}</p>
            <p className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block">{t.hint}</p>
          </>
        );
        const cls = 'relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-2 pb-2 pt-3 text-center shadow-sm sm:p-4 sm:pl-5 sm:text-left';
        return onSelect ? (
          <button key={t.key} type="button" onClick={() => onSelect(t.key)} className={cn(cls, 'transition hover:border-indigo-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500')}>{body}</button>
        ) : (
          <div key={t.key} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}

export function NextUp({
  items,
  stores,
  today,
  allDone,
}: {
  items: PlanItem[];
  stores: ReportStore[];
  today: string;
  allDone: boolean;
}) {
  const byId = new Map(stores.map((s) => [s.id, s]));
  return (
    <section aria-label="Kunjungi berikutnya" className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-3.5 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Kunjungi berikutnya</p>
          <h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-lg">
            {items.length ? `${relativeDay(items[0].day, today)} — ${items.filter((i) => i.day === items[0].day).length} toko` : allDone ? 'Semua toko sudah terpenuhi' : 'Belum ada jadwal saran'}
          </h2>
        </div>
        <p className="hidden text-xs text-slate-500 sm:block">Saran jadwal menyebar kunjungan merata sampai batas periode tiap toko.</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />{allDone ? 'Tidak ada kunjungan yang tertunda periode ini.' : 'Tidak ada toko yang perlu dijadwalkan sekarang.'}
        </p>
      ) : (
        <ul className="mt-2.5 grid gap-2 sm:mt-3 sm:grid-cols-2 sm:gap-2.5 xl:grid-cols-3">
          {items.map((item) => {
            const store = byId.get(item.storeId);
            if (!store) return null;
            // The heading already names the first day; only a store on another day says its own.
            const otherDay = item.day !== items[0].day;
            return (
              <li key={item.key}>
                <Link
                  href={`/ops/store-visits/${store.id}`}
                  className={cn('group flex h-full items-center gap-2.5 rounded-xl border border-slate-200 border-l-4 bg-white py-2.5 pl-3 pr-2.5 shadow-sm transition active:scale-[0.99] hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500 sm:gap-3 sm:p-3', TONE[item.tone].edge)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-slate-900">{store.name}</span>
                      {store.policy?.category === 'out_city' && <Plane aria-label="Luar kota" className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{store.storeNo} · {store.policy?.city || store.areaName}</span>
                    <span className={cn('mt-0.5 block truncate text-xs font-semibold', TONE[item.tone].text)}>
                      {otherDay && `${relativeDay(item.day, today)} · `}{planReason(store, item)}{item.of > 1 ? ` · visit ${item.visitNo}/${item.of}` : ''}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const STATUS_TEXT: Record<PlanTone, string> = { overdue: 'Ada yang terlewat', soon: 'Segera berakhir', planned: 'Berjalan', done: 'Semua terpenuhi', idle: 'Belum diatur' };

export function AreaMonitor({
  rows,
  selected,
  onSelect,
  activityDays,
}: {
  rows: AreaRollup[];
  selected: string;
  onSelect: (areaId: string) => void;
  activityDays: number;
}) {
  // A phone shows the three worst areas first (plus the picked one); the rest unfold on demand.
  const [expanded, setExpanded] = useState(false);
  const PHONE_ROWS = 3;
  return (
    <section aria-label="Pemantauan area" className="space-y-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 className="text-sm font-bold text-slate-900">Siapa yang harus visit apa</h2>
        <span className="text-xs text-slate-500">Area dengan tunggakan paling banyak di atas. <span className="hidden sm:inline">Klik</span><span className="sm:hidden">Ketuk</span> area untuk melihat kalendernya.</span>
      </div>
      <ul className="@container space-y-2">
        {rows.map((r, i) => {
          const active = selected === String(r.areaId);
          const seg = (n: number) => (r.total ? `${(n / r.total) * 100}%` : '0%');
          return (
            <li key={r.areaId} className={cn(i >= PHONE_ROWS && !expanded && !active && 'hidden md:block')}>
              <button
                type="button"
                onClick={() => onSelect(active ? 'all' : String(r.areaId))}
                aria-pressed={active}
                className={cn(
                  'relative grid w-full gap-x-6 gap-y-2.5 overflow-hidden rounded-2xl border bg-white p-3.5 pl-5 text-left shadow-sm transition active:scale-[0.99] @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] @3xl:items-center sm:p-4 sm:pl-5',
                  active ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-indigo-200 hover:shadow-md',
                )}
              >
                <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1.5', TONE[r.tone].dot)} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{r.areaName}</span>
                    <TonePill tone={r.tone} className="shrink-0 px-2 py-0.5 text-[11px]">{STATUS_TEXT[r.tone]}</TonePill>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {r.opsNames.length ? `Ops Area: ${r.opsNames.join(', ')}` : 'Belum ada Ops Area'} · {r.total} toko
                  </span>
                </span>

                <span className="min-w-0 space-y-1.5">
                  <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${r.met} terpenuhi, ${r.overdue} terlewat, ${r.soon} segera berakhir, ${r.open} berjalan dari ${r.total} toko`}>
                    <span className={cn('h-full', TONE.done.dot)} style={{ width: seg(r.met) }} />
                    <span className={cn('h-full', TONE.planned.dot)} style={{ width: seg(r.open) }} />
                    <span className={cn('h-full', TONE.soon.dot)} style={{ width: seg(r.soon) }} />
                    <span className={cn('h-full', TONE.overdue.dot)} style={{ width: seg(r.overdue) }} />
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-semibold tabular-nums">
                    <span className={r.overdue ? TONE.overdue.text : 'text-slate-400'}>{r.overdue} terlewat</span>
                    <span className={r.soon ? TONE.soon.text : 'text-slate-400'}>{r.soon} segera</span>
                    <span className={r.open ? TONE.planned.text : 'text-slate-400'}>{r.open} berjalan</span>
                    <span className={r.met ? TONE.done.text : 'text-slate-400'}>{r.met} selesai</span>
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-slate-500 @3xl:flex-col @3xl:items-start @3xl:gap-y-0.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><CalendarCheck className="h-3.5 w-3.5 text-indigo-500" />{r.next7} dijadwalkan 7 hari</span>
                  <span className={cn(r.visits === 0 && r.total > 0 && 'font-semibold text-rose-600')}>
                    {r.visits} visit / {activityDays} hari · {r.lastVisitAt ? `terakhir ${daysAgoLabel(jakartaDateKey(r.lastVisitAt)).toLowerCase()}` : 'belum ada visit'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > PHONE_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-indigo-700 md:hidden"
        >
          {expanded ? 'Tampilkan lebih sedikit' : `Lihat semua ${rows.length} area`}
          <ChevronDown className={cn('h-4 w-4 transition', expanded && 'rotate-180')} />
        </button>
      )}
    </section>
  );
}

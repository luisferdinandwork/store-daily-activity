'use client';
// components/ops/store-visits/PlanOverview.tsx
//
// What sits above the Report's calendar:
//   • SummaryTiles — Terlewat / Segera berakhir / Dijadwalkan 7 hari / Terpenuhi
//   • NextUp       — Ops Area: "Kunjungi berikutnya", the stores to go to first
//   • AreaMonitor  — Ops HO: every area's backlog, worst first; a row picks the area

import Link from 'next/link';
import { ArrowRight, CalendarCheck, CheckCircle2, Plane } from 'lucide-react';

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
  tiles: { tone: PlanTone; label: string; value: number; hint: string; key: string }[];
  loading?: boolean;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <>
            <span className={cn('absolute inset-y-0 left-0 w-1.5', TONE[t.tone].dot)} />
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t.label}</p>
            <p className={cn('mt-1 text-3xl font-bold tabular-nums', t.value ? TONE[t.tone].text : 'text-slate-300')}>{loading ? '–' : t.value}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{t.hint}</p>
          </>
        );
        const cls = 'relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 pl-5 text-left shadow-sm sm:p-4 sm:pl-5';
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
    <section aria-label="Kunjungi berikutnya" className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Kunjungi berikutnya</p>
          <h2 className="mt-0.5 text-lg font-bold text-slate-900">
            {items.length ? `${relativeDay(items[0].day, today)} — ${items.filter((i) => i.day === items[0].day).length} toko` : allDone ? 'Semua toko sudah terpenuhi' : 'Belum ada jadwal saran'}
          </h2>
        </div>
        <p className="text-xs text-slate-500">Saran jadwal menyebar kunjungan merata sampai batas periode tiap toko.</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />{allDone ? 'Tidak ada kunjungan yang tertunda periode ini.' : 'Tidak ada toko yang perlu dijadwalkan sekarang.'}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const store = byId.get(item.storeId);
            if (!store) return null;
            return (
              <li key={item.key}>
                <Link
                  href={`/ops/store-visits/${store.id}`}
                  className={cn('group flex h-full items-center gap-3 rounded-xl border border-slate-200 border-l-4 bg-white p-3 shadow-sm transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500', TONE[item.tone].edge)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <TonePill tone={item.tone} className="px-2 py-0.5 text-[11px]">{relativeDay(item.day, today)}</TonePill>
                      {store.policy?.category === 'out_city' && <Plane aria-label="Luar kota" className="h-3.5 w-3.5 text-slate-400" />}
                    </span>
                    <span className="mt-1.5 block truncate text-sm font-bold text-slate-900">{store.name}</span>
                    <span className="block truncate text-xs text-slate-500">{store.storeNo} · {store.policy?.city || store.areaName}</span>
                    <span className={cn('mt-0.5 block truncate text-xs font-semibold', TONE[item.tone].text)}>{planReason(store, item)}{item.of > 1 ? ` · visit ${item.visitNo}/${item.of}` : ''}</span>
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
  return (
    <section aria-label="Pemantauan area" className="space-y-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 className="text-sm font-bold text-slate-900">Siapa yang harus visit apa</h2>
        <span className="text-xs text-slate-500">Area dengan tunggakan paling banyak di atas. Klik area untuk melihat kalendernya.</span>
      </div>
      <ul className="@container space-y-2">
        {rows.map((r) => {
          const active = selected === String(r.areaId);
          const seg = (n: number) => (r.total ? `${(n / r.total) * 100}%` : '0%');
          return (
            <li key={r.areaId}>
              <button
                type="button"
                onClick={() => onSelect(active ? 'all' : String(r.areaId))}
                aria-pressed={active}
                className={cn(
                  'relative grid w-full gap-x-6 gap-y-2.5 overflow-hidden rounded-2xl border bg-white p-3.5 pl-5 text-left shadow-sm transition @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] @3xl:items-center sm:p-4 sm:pl-5',
                  active ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-indigo-200 hover:shadow-md',
                )}
              >
                <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1.5', TONE[r.tone].dot)} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold text-slate-900">{r.areaName}</span>
                    <TonePill tone={r.tone} className="px-2 py-0.5 text-[11px]">{STATUS_TEXT[r.tone]}</TonePill>
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
    </section>
  );
}

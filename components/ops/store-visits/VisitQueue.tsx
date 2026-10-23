'use client';
// components/ops/store-visits/VisitQueue.tsx
//
// The "Antrean" view of the Report: every store as a row, worst first, grouped by
// urgency (Terlewat → Segera berakhir → Dijadwalkan → Belum waktunya → Terpenuhi →
// Belum diatur) or — for Ops HO — by area, so HO sees which Ops Area has what left.

import Link from 'next/link';
import { CalendarClock, CalendarPlus, ChevronRight, Plane, UserRound } from 'lucide-react';

import { cn } from '@/lib/utils';
import { jakartaDateKey } from '@/lib/day-bucket';
import { cycleName, cycleRangeLabel } from '@/lib/store-visit/cycles';
import { missedStreak, type ReportStore } from '@/lib/store-visit/report';
import { SOON_DAYS, planReason, relativeDay, storeUrgency, toneRank, urgencyTone, type PlanItem, type PlanTone, type Urgency } from '@/lib/store-visit/plan';
import { daysAgoLabel } from './shared';
import { TONE } from './tones';

export type QueueGroupBy = 'urgency' | 'area';

const URGENCY_LABEL: Record<Urgency, string> = { overdue: 'Terlewat', soon: 'Segera berakhir', open: 'Dijadwalkan', met: 'Terpenuhi', unset: 'Belum diatur' };

const GROUPS: { key: string; title: string; hint: string; tone: PlanTone }[] = [
  { key: 'overdue', title: 'Terlewat', hint: 'periode lalu tidak terpenuhi', tone: 'overdue' },
  { key: 'soon', title: 'Segera berakhir', hint: `periode berakhir dalam ${SOON_DAYS} hari atau kurang`, tone: 'soon' },
  { key: 'planned', title: 'Dijadwalkan', hint: 'sudah punya slot saran', tone: 'planned' },
  { key: 'later', title: 'Belum waktunya', hint: 'periode panjang — dijadwalkan 4 minggu sebelum batas', tone: 'idle' },
  { key: 'met', title: 'Sudah terpenuhi', hint: 'periode berjalan', tone: 'done' },
  { key: 'unset', title: 'Belum diatur', hint: 'IT belum mengatur kategori & jumlah wajib', tone: 'idle' },
];

export function TonePill({ tone, children, className }: { tone: PlanTone; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset', TONE[tone].pill, className)}>{children}</span>;
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });

function groupKey(store: ReportStore, nextSlot: PlanItem | undefined): string {
  const u = storeUrgency(store);
  if (u === 'open') return nextSlot ? 'planned' : 'later';
  return u === 'soon' ? 'soon' : u;
}

function sortRows(key: string, rows: Row[]): Row[] {
  const byName = (a: Row, b: Row) => a.store.name.localeCompare(b.store.name);
  switch (key) {
    case 'overdue': return rows.sort((a, b) => missedStreak(b.store) - missedStreak(a.store) || (a.store.cycle?.daysLeft ?? 0) - (b.store.cycle?.daysLeft ?? 0) || byName(a, b));
    case 'soon': return rows.sort((a, b) => (a.store.cycle?.daysLeft ?? 0) - (b.store.cycle?.daysLeft ?? 0) || byName(a, b));
    case 'planned': return rows.sort((a, b) => (a.slot?.day ?? '').localeCompare(b.slot?.day ?? '') || byName(a, b));
    case 'later': return rows.sort((a, b) => (a.store.cycle?.end ?? '').localeCompare(b.store.cycle?.end ?? '') || byName(a, b));
    default: return rows.sort(byName);
  }
}

interface Row { store: ReportStore; slot: PlanItem | undefined }

export default function VisitQueue({
  stores,
  plan,
  today,
  showArea,
  groupBy,
}: {
  stores: ReportStore[];
  plan: PlanItem[];
  today: string;
  showArea: boolean;
  groupBy: QueueGroupBy;
}) {
  const nextSlot = new Map<number, PlanItem>();
  for (const p of plan) if (!nextSlot.has(p.storeId) && p.day >= today) nextSlot.set(p.storeId, p);
  const rows: Row[] = stores.map((store) => ({ store, slot: nextSlot.get(store.id) }));

  if (rows.length === 0) {
    return <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>;
  }

  const byUrgency = (list: Row[]) => GROUPS
    .map((g) => ({ ...g, rows: sortRows(g.key, list.filter((r) => groupKey(r.store, r.slot) === g.key)) }))
    .filter((g) => g.rows.length > 0);

  if (groupBy === 'area') {
    const areas = new Map<number, Row[]>();
    for (const r of rows) areas.set(r.store.areaId, [...(areas.get(r.store.areaId) ?? []), r]);
    const ordered = [...areas.values()]
      .map((list) => ({ list, worst: Math.min(...list.map((r) => toneRank(urgencyTone(storeUrgency(r.store))))), late: list.filter((r) => storeUrgency(r.store) === 'overdue').length }))
      .sort((a, b) => a.worst - b.worst || b.late - a.late || a.list[0].store.areaName.localeCompare(b.list[0].store.areaName));
    return (
      <div className="space-y-6">
        {ordered.map(({ list }) => {
          const first = list[0].store;
          const counts = (['overdue', 'soon', 'open', 'met'] as Urgency[]).map((u) => ({ u, n: list.filter((r) => storeUrgency(r.store) === u).length })).filter((c) => c.n > 0);
          return (
            <section key={first.areaId} aria-label={first.areaName} className="space-y-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                <h2 className="text-sm font-bold text-slate-900">{first.areaName}</h2>
                {first.opsNames.length > 0 && <span className="text-xs text-slate-500">Ops: {first.opsNames.join(', ')}</span>}
                <span className="flex flex-wrap gap-1.5">
                  {counts.map((c) => <TonePill key={c.u} tone={urgencyTone(c.u)} className="px-2 py-0.5">{c.n} {URGENCY_LABEL[c.u].toLowerCase()}</TonePill>)}
                </span>
              </div>
              <ul className="grid gap-2.5 2xl:grid-cols-2">
                {byUrgency(list).flatMap((g) => g.rows).map(({ store, slot }) => <QueueRow key={store.id} store={store} slot={slot} today={today} showArea={false} />)}
              </ul>
            </section>
          );
        })}
        <QueueLegend />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {byUrgency(rows).map((group) => (
        <section key={group.key} aria-label={group.title} className="space-y-2.5">
          <div className="flex items-baseline gap-2 px-1">
            <h2 className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-900">{group.title}</h2>
            <TonePill tone={group.tone} className="px-2 py-0.5">{group.rows.length}</TonePill>
            <span className="truncate text-xs text-slate-500">{group.hint}</span>
          </div>
          <ul className="grid gap-2.5 2xl:grid-cols-2">
            {group.rows.map(({ store, slot }) => <QueueRow key={store.id} store={store} slot={slot} today={today} showArea={showArea} />)}
          </ul>
        </section>
      ))}
      <QueueLegend />
    </div>
  );
}

function QueueLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-slate-500">
      <span className="font-semibold text-slate-600">Riwayat periode:</span>
      <span className="inline-flex items-center gap-1.5"><i className={cn('h-3 w-3 rounded-[4px]', TONE.done.dot)} />terpenuhi</span>
      <span className="inline-flex items-center gap-1.5"><i className={cn('h-3 w-3 rounded-[4px]', TONE.overdue.dot)} />terlewat</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] bg-white ring-2 ring-inset ring-amber-400" />periode berjalan</span>
    </p>
  );
}

function QueueRow({ store, slot, today, showArea }: { store: ReportStore; slot: PlanItem | undefined; today: string; showArea: boolean }) {
  const urgency = storeUrgency(store);
  const tone = urgencyTone(urgency);
  const cycle = store.cycle;
  const policy = store.policy;
  const latest = store.visits[0] ?? null;
  const visitLine = latest
    ? `Dikunjungi ${dayLabel(latest.at)}${latest.by ? ` oleh ${latest.by}` : ''}${store.visits.length > 1 ? ` · +${store.visits.length - 1} visit lain` : ''}`
    : store.lastVisit
      ? `Terakhir ${daysAgoLabel(jakartaDateKey(store.lastVisit.at)).toLowerCase()}${store.lastVisit.by ? ` · ${store.lastVisit.by}` : ''}`
      : 'Belum pernah dikunjungi';

  return (
    <li>
      <Link
        href={`/ops/store-visits/${store.id}`}
        aria-label={`Buka visit ${store.name}`}
        className="relative flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-[0.99]"
      >
        <span aria-hidden className={cn('w-1.5 shrink-0', TONE[tone].dot)} />
        <div className="min-w-0 flex-1 space-y-2.5 p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold leading-snug text-slate-900">
                <span className="truncate">{store.name}</span>
                {policy?.category === 'out_city' && <Plane aria-label="Luar kota" className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
              </p>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {store.storeNo} · {policy?.city || store.areaName}
                {showArea && policy?.city && ` · ${store.areaName}`}
                {showArea && store.opsNames.length > 0 && ` · Ops: ${store.opsNames.join(', ')}`}
              </p>
            </div>
            <TonePill tone={tone}>{urgency === 'open' && !slot ? 'Belum waktunya' : URGENCY_LABEL[urgency]}</TonePill>
          </div>

          {cycle && policy ? (
            <>
              <div className="space-y-1.5">
                <div role="progressbar" aria-valuemin={0} aria-valuemax={policy.minimumVisits} aria-valuenow={cycle.count} className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={cn('h-full rounded-full transition-all', cycle.met ? TONE.done.dot : TONE[tone].dot)} style={{ width: `${Math.min(100, Math.round((cycle.count / policy.minimumVisits) * 100))}%` }} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span>{cycleName(policy.intervalDays)} · {cycleRangeLabel(cycle)} · {Math.min(cycle.count, policy.minimumVisits)}/{policy.minimumVisits} visit</span>
                  {!cycle.met && (
                    <span className={cn('inline-flex items-center gap-1 font-semibold', cycle.daysLeft <= 1 ? 'text-rose-600' : 'text-slate-600')}>
                      <CalendarClock className="h-3.5 w-3.5" />{cycle.daysLeft === 0 ? 'Hari terakhir' : `Sisa ${cycle.daysLeft} hari`}
                    </span>
                  )}
                </div>
              </div>
              {(slot || urgency === 'overdue' || urgency === 'soon') && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {slot && (
                    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold ring-1 ring-inset', TONE[slot.tone].pill)}>
                      <CalendarPlus className="h-3.5 w-3.5" />Saran: {relativeDay(slot.day, today)}{slot.of > 1 ? ` · visit ${slot.visitNo}/${slot.of}` : ''}
                    </span>
                  )}
                  {(urgency === 'overdue' || urgency === 'soon') && <span className={cn('font-semibold', TONE[tone].text)}>{planReason(store, slot)}</span>}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className={cn('flex min-w-0 items-center gap-1.5 text-xs', latest ? 'font-semibold text-slate-700' : 'text-slate-500')}>
                  <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{visitLine}</span>
                </p>
                <HistoryStrip store={store} />
              </div>
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

function HistoryStrip({ store }: { store: ReportStore }) {
  const cycle = store.cycle;
  if (!cycle) return null;
  const label = (start: string, end: string, count: number) => `${cycleRangeLabel({ start, end })}: ${count} visit`;
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`Riwayat ${store.history.length + 1} periode terakhir; paling kanan periode berjalan`}>
      {store.history.length === 0 && <span className="mr-1 text-[11px] text-slate-400">Riwayat mulai periode ini</span>}
      {store.history.map((c) => (
        <span key={c.start} title={label(c.start, c.end, c.count)} className={cn('h-3.5 w-3.5 rounded-[4px]', c.met ? TONE.done.dot : TONE.overdue.dot)} />
      ))}
      <span
        title={`${label(cycle.start, cycle.end, cycle.count)} (berjalan)`}
        className={cn('h-3.5 w-3.5 rounded-[4px] ring-2 ring-inset', cycle.met ? 'bg-emerald-500 ring-emerald-500' : 'bg-white ring-amber-400')}
      />
    </div>
  );
}

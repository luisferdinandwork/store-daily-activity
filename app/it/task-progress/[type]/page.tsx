'use client';
// app/it/task-progress/[type]/page.tsx
//
// One task, every store.
//   • Harian: KPI tiles (also filters), a per-area breakdown, and the store table
//     grouped needs-attention first (who did it, shift, time).
//   • Mingguan / Bulanan: stores × days (components/tasks/HeatGrid) — a status
//     square per store per day, so a store that keeps missing the task stands out.
// Serah Terima is a rolling board: today only. ?period=&date= pick the view.

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CalendarClock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useApi } from '@/lib/client/use-api';
import { isDayKey, jakartaTodayKey } from '@/lib/day-bucket';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';
import { OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import TaskProgressTable, { type TableGroup } from '@/components/it/task-progress/TaskProgressTable';
import TaskDetailSheet, { type DetailTarget } from '@/components/it/task-progress/TaskDetailSheet';
import HeatGrid, { type HeatRow } from '@/components/tasks/HeatGrid';
import { CELL_META, CellLegend, cellStateOf } from '@/components/tasks/TaskCell';
import { AreaBreakdown, MetricTile, RateBar } from '@/components/tasks/MetricTile';
import {
  BOARD_TASK,
  GROUP_ORDER,
  byAttention,
  isFutureDay,
  isPastDay,
  periodDays,
  progressTaskOf,
  summariseStore,
  type StoreGroup,
  type TaskProgressResponse,
  type TaskProgressStore,
  type TaskRangeResponse,
} from '@/lib/task-progress';

type DaySort = 'attention' | 'name' | 'area' | 'latest';
type RangeSort = 'attention' | 'progress' | 'name' | 'area';

const pctOf = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

function useHeld<T extends { success: boolean }>(data: T | undefined): T | null {
  const [held, setHeld] = useState<T | null>(null);
  if (data?.success && data !== held) setHeld(data);
  return data?.success ? data : held;
}

function dayShort(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function latestDone(store: TaskProgressStore): string {
  return store.slots.map((s) => s.completedAt ?? '').sort().pop() ?? '';
}

export default function ItTaskProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const { type } = use(params);
  const query = use(searchParams);
  const task = progressTaskOf(type);
  const board = type === BOARD_TASK;

  const [date, setDate] = useState(query.date && isDayKey(query.date) ? query.date : jakartaTodayKey());
  const [period, setPeriod] = useState<Period>(!board && (query.period === 'weekly' || query.period === 'monthly') ? query.period : 'daily');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('all');
  const [group, setGroup] = useState<StoreGroup | null>(null);
  const [daySort, setDaySort] = useState<DaySort>('attention');
  const [rangeSort, setRangeSort] = useState<RangeSort>('attention');
  const [onlyBehind, setOnlyBehind] = useState(false);
  const [target, setTarget] = useState<{ detail: DetailTarget; date: string } | null>(null);

  const today = jakartaTodayKey();
  const days = useMemo(() => periodDays(period, date), [period, date]);
  const isPast = isPastDay(date);
  const future = !board && period === 'daily' && isFutureDay(date);

  const dayApi = useApi<TaskProgressResponse>(task && period === 'daily' ? `/api/it/task-progress?type=${type}&date=${date}` : null);
  const rangeApi = useApi<TaskRangeResponse>(task && period !== 'daily' ? `/api/it/task-progress?type=${type}&from=${days[0]}&to=${days[days.length - 1]}` : null);
  const dayData = useHeld(dayApi.data);
  const rangeData = useHeld(rangeApi.data);
  const api = period === 'daily' ? dayApi : rangeApi;
  const error = api.data && !api.data.success ? (api.data.error ?? 'Gagal memuat data.') : api.error?.message ?? null;
  const firstLoad = period === 'daily' ? !dayData : !rangeData;

  const areaOptions = useMemo(() => {
    const list = period === 'daily' ? (dayData?.stores ?? []) : (rangeData?.stores ?? []);
    return [...new Set(list.map((s) => s.areaName).filter((a): a is string => !!a))].sort();
  }, [period, dayData, rangeData]);
  const activeArea = area !== 'all' && areaOptions.includes(area) ? area : 'all';
  const q = search.trim().toLowerCase();

  // ── Daily ──────────────────────────────────────────────────────────────────
  const dayRows = useMemo(
    () => (dayData?.stores ?? []).map((store) => ({ store, progress: summariseStore(store.slots, isPast, board) })),
    [dayData, isPast, board],
  );
  const dayScoped = useMemo(() => dayRows.filter((r) => activeArea === 'all' || r.store.areaName === activeArea), [dayRows, activeArea]);
  const counts = useMemo(() => {
    const c: Record<StoreGroup, number> = { attention: 0, running: 0, done: 0, none: 0 };
    for (const r of dayScoped) c[r.progress.group]++;
    return c;
  }, [dayScoped]);
  const scheduled = counts.attention + counts.running + counts.done;
  const dayAreas = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const r of dayRows) {
      if (r.progress.group === 'none') continue;
      const a = m.get(r.store.areaName ?? 'Tanpa area') ?? { done: 0, total: 0 };
      a.total++;
      if (r.progress.group === 'done') a.done++;
      m.set(r.store.areaName ?? 'Tanpa area', a);
    }
    return [...m.entries()].map(([name, c]) => ({ name, ...c }));
  }, [dayRows]);

  const groups = useMemo<TableGroup[]>(() => {
    const matches = dayScoped.filter((r) => {
      if (group && r.progress.group !== group) return false;
      if (!q) return true;
      return `${r.store.name} ${r.store.storeNo} ${r.store.areaName ?? ''} ${r.store.slots.map((s) => s.doneBy ?? '').join(' ')}`.toLowerCase().includes(q);
    });
    const order = (a: (typeof matches)[number], b: (typeof matches)[number]) => {
      if (daySort === 'name') return a.store.name.localeCompare(b.store.name);
      if (daySort === 'area') return (a.store.areaName ?? '').localeCompare(b.store.areaName ?? '') || a.store.name.localeCompare(b.store.name);
      if (daySort === 'latest') return latestDone(b.store).localeCompare(latestDone(a.store)) || a.store.name.localeCompare(b.store.name);
      return byAttention(a, b);
    };
    return GROUP_ORDER
      .map((g) => ({ group: g, rows: matches.filter((r) => r.progress.group === g).sort(order) }))
      .filter((g) => g.rows.length > 0);
  }, [dayScoped, group, q, daySort]);

  // ── Week / month ───────────────────────────────────────────────────────────
  const rangeRows = useMemo(() => (rangeData?.stores ?? [])
    .filter((s) => activeArea === 'all' || s.areaName === activeArea)
    .map((s) => {
      const cells = Object.entries(s.days).filter(([d]) => d <= today);
      const done = cells.filter(([, c]) => c.key === 'completed').length;
      const missed = cells.filter(([d, c]) => c.key === 'not_started' && d < today).length;
      return { store: s, done, total: cells.length, missed };
    }), [rangeData, activeArea, today]);

  const rangeStats = useMemo(() => {
    let done = 0;
    let total = 0;
    let missed = 0;
    let perfect = 0;
    let low = 0;
    for (const r of rangeRows) {
      done += r.done; total += r.total; missed += r.missed;
      if (r.total && r.done === r.total) perfect++;
      if (r.total && pctOf(r.done, r.total) < 50) low++;
    }
    return { done, total, missed, perfect, low, rate: pctOf(done, total) };
  }, [rangeRows]);

  const rangeAreas = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const s of rangeData?.stores ?? []) {
      const cells = Object.entries(s.days).filter(([d]) => d <= today);
      const a = m.get(s.areaName ?? 'Tanpa area') ?? { done: 0, total: 0 };
      a.total += cells.length;
      a.done += cells.filter(([, c]) => c.key === 'completed').length;
      m.set(s.areaName ?? 'Tanpa area', a);
    }
    return [...m.entries()].map(([name, c]) => ({ name, ...c }));
  }, [rangeData, today]);

  const heatRows = useMemo<HeatRow[]>(() => {
    const list = rangeRows
      .filter((r) => !q || `${r.store.name} ${r.store.storeNo} ${r.store.areaName ?? ''}`.toLowerCase().includes(q))
      .filter((r) => !onlyBehind || (r.total > 0 && r.done < r.total))
      .sort((a, b) => {
        if (rangeSort === 'name') return a.store.name.localeCompare(b.store.name);
        if (rangeSort === 'area') return (a.store.areaName ?? '').localeCompare(b.store.areaName ?? '') || a.store.name.localeCompare(b.store.name);
        const ra = a.total ? a.done / a.total : null;
        const rb = b.total ? b.done / b.total : null;
        if (ra === null || rb === null) return (ra === null ? 1 : 0) - (rb === null ? 1 : 0) || a.store.name.localeCompare(b.store.name);
        return (rangeSort === 'progress' ? rb - ra : ra - rb || b.missed - a.missed) || a.store.name.localeCompare(b.store.name);
      });
    return list.map((r) => ({
      key: String(r.store.storeId),
      label: r.store.name,
      sublabel: `${r.store.storeNo}${r.store.areaName ? ` · ${r.store.areaName}` : ''}`,
      summary: r.total ? { done: r.done, total: r.total } : null,
    }));
  }, [rangeRows, q, onlyBehind, rangeSort]);

  const rangeByStore = useMemo(() => new Map((rangeData?.stores ?? []).map((s) => [String(s.storeId), s])), [rangeData]);

  if (!task) {
    return (
      <div className="min-h-full bg-slate-50 p-6">
        <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold text-slate-800">Task tidak ditemukan</p>
          <Link href="/it/task-progress" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700"><ArrowLeft className="h-4 w-4" />Semua task</Link>
        </div>
      </div>
    );
  }

  const dayDone = counts.done;
  const dayRate = pctOf(dayDone, scheduled);
  const toggleGroup = (g: StoreGroup) => setGroup((cur) => (cur === g ? null : g));

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Task Progress"
        title={task.label}
        subtitle={board ? 'Papan serah terima per toko — kondisi saat ini' : task.description}
        periodProps={board ? undefined : { period, onPeriodChange: setPeriod, date, onDateChange: setDate }}
        onRefresh={() => void api.refresh()}
        refreshing={api.validating}
        contentClassName="w-full"
      />

      <div className="space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/it/task-progress" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" />Semua task
        </Link>

        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-sm font-bold">Gagal memuat data</p><p className="mt-0.5 text-xs">{error}</p></div>
          </div>
        )}
        {future && (
          <div role="status" className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" />Tanggal ini belum terjadi — belum ada progress yang bisa dilihat.
          </div>
        )}

        {/* KPIs + per area */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
          {period === 'daily' ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile
                label={board ? 'Toko tanpa antrean' : 'Toko selesai'}
                value={firstLoad ? '–' : `${dayRate}%`}
                tone={dayRate >= 80 ? 'emerald' : dayRate >= 50 ? 'amber' : 'rose'}
                hint={`${dayDone}/${scheduled} toko${counts.none ? ` · ${counts.none} tidak terjadwal` : ''}`}
                footer={<RateBar rate={dayRate} />}
                active={group === 'done'}
                onClick={() => toggleGroup('done')}
              />
              <MetricTile
                label="Perlu perhatian"
                value={firstLoad ? '–' : counts.attention}
                tone={counts.attention ? (isPast ? 'rose' : 'amber') : 'emerald'}
                hint={board ? 'item tertahan / > 1 hari' : isPast ? 'tidak dikerjakan / pending' : 'belum mulai / pending'}
                active={group === 'attention'}
                onClick={() => toggleGroup('attention')}
              />
              <MetricTile
                label={board ? 'Menunggu diterima' : 'Sedang berjalan'}
                value={firstLoad ? '–' : counts.running}
                tone="indigo"
                hint={board ? 'item baru' : 'dimulai, belum selesai'}
                active={group === 'running'}
                onClick={() => toggleGroup('running')}
              />
              <MetricTile
                label="Tidak terjadwal"
                value={firstLoad ? '–' : counts.none}
                hint="tidak ada shift untuk task ini"
                active={group === 'none'}
                onClick={() => toggleGroup('none')}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile
                label="Progress periode"
                value={firstLoad ? '–' : `${rangeStats.rate}%`}
                tone={rangeStats.rate >= 80 ? 'emerald' : rangeStats.rate >= 50 ? 'amber' : 'rose'}
                hint={`${rangeStats.done}/${rangeStats.total} hari-toko selesai`}
                footer={<RateBar rate={rangeStats.rate} />}
              />
              <MetricTile label="Hari terlewat" value={firstLoad ? '–' : rangeStats.missed} tone={rangeStats.missed ? 'rose' : 'emerald'} hint="hari-toko tidak dikerjakan" />
              <MetricTile label="Toko 100%" value={firstLoad ? '–' : rangeStats.perfect} tone="emerald" hint="selesai setiap hari terjadwal" />
              <MetricTile
                label="Toko di bawah 50%"
                value={firstLoad ? '–' : rangeStats.low}
                tone={rangeStats.low ? 'rose' : 'emerald'}
                hint={onlyBehind ? 'Klik untuk tampilkan semua' : 'Klik: belum selesai saja'}
                active={onlyBehind}
                onClick={() => setOnlyBehind((v) => !v)}
              />
            </div>
          )}
          <AreaBreakdown
            items={period === 'daily' ? dayAreas : rangeAreas}
            unit={period === 'daily' ? 'toko' : 'hari'}
            active={activeArea === 'all' ? undefined : activeArea}
            onPick={(name) => setArea((cur) => (cur === name ? 'all' : name))}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <OpsSearchInput value={search} onChange={setSearch} placeholder={period === 'daily' ? 'Cari toko, kode, atau nama karyawan…' : 'Cari toko atau kode…'} className="max-w-sm" />
          {areaOptions.length > 1 && (
            <OpsFilterSelect label="Area" value={activeArea} onChange={setArea}>
              <option value="all">Semua area</option>
              {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </OpsFilterSelect>
          )}
          {period === 'daily' ? (
            <OpsFilterSelect label="Urutkan" value={daySort} onChange={(v) => setDaySort(v as DaySort)} highlight={false}>
              <option value="attention">Urut: Perlu perhatian</option>
              <option value="latest">Urut: Selesai terbaru</option>
              <option value="area">Urut: Area</option>
              <option value="name">Urut: Nama toko</option>
            </OpsFilterSelect>
          ) : (
            <>
              <OpsFilterSelect label="Urutkan" value={rangeSort} onChange={(v) => setRangeSort(v as RangeSort)} highlight={false}>
                <option value="attention">Urut: Paling tertinggal</option>
                <option value="progress">Urut: Progress tertinggi</option>
                <option value="area">Urut: Area</option>
                <option value="name">Urut: Nama toko</option>
              </OpsFilterSelect>
              <button
                type="button"
                onClick={() => setOnlyBehind((v) => !v)}
                aria-pressed={onlyBehind}
                className={cn(
                  'h-10 rounded-xl border px-3.5 text-sm font-semibold transition',
                  onlyBehind ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                Belum selesai saja
              </button>
            </>
          )}
          {group && (
            <button type="button" onClick={() => setGroup(null)} className="h-10 rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">
              Filter aktif ✕
            </button>
          )}
          {period !== 'daily' && <CellLegend className="ml-auto" states={['done', 'partial', 'active', 'flagged', 'missed', 'todo']} />}
        </div>

        {firstLoad && !error ? (
          <div className="h-[420px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ) : period === 'daily' ? (
          groups.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>
          ) : (
            <div className={cn('transition-opacity', api.validating && 'opacity-60')}>
              <TaskProgressTable
                groups={groups}
                isPast={isPast}
                board={board}
                onOpen={(store, slot) => setTarget({ detail: { store, slot, type }, date })}
              />
            </div>
          )
        ) : heatRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>
        ) : (
          <div className={cn('transition-opacity', api.validating && 'opacity-60')}>
            <HeatGrid
              rows={heatRows}
              days={days}
              today={today}
              rowHeader="Toko"
              cell={(row, day) => {
                const c = rangeByStore.get(row.key)?.days[day];
                if (!c) return null;
                const state = cellStateOf(c.key, day < today);
                return {
                  kind: 'state',
                  state,
                  progress: { done: c.done, total: c.total },
                  title: `${row.label} · ${dayShort(day)}`,
                  lines: c.total > 1 ? [`${c.done}/${c.total} slot selesai`] : [],
                };
              }}
              onCellClick={(row, day) => {
                const s = rangeByStore.get(row.key);
                if (!s) return;
                setTarget({ detail: { store: { ...s, slots: [] }, slot: null, type }, date: day });
              }}
            />
            <p className="mt-2 text-xs text-slate-400">
              Satu kotak = {task.label} di toko itu pada hari itu ({CELL_META.done.label.toLowerCase()}, sebagian, pending, atau tidak dikerjakan). Klik kotak untuk melihat detailnya.
            </p>
          </div>
        )}
      </div>

      <TaskDetailSheet target={target?.detail ?? null} date={target?.date ?? date} onClose={() => setTarget(null)} />
    </div>
  );
}

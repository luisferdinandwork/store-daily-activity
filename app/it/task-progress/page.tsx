'use client';
// app/it/task-progress/page.tsx
//
// IT Task Progress — every task, every store.
//
//   • Harian: KPI tiles, a per-area breakdown, and the task board (stores × tasks,
//     components/tasks/TaskBoard). A column header opens that task's page, a
//     store opens its day, a square opens the task.
//   • Mingguan / Bulanan: tasks × days (components/tasks/HeatGrid), each square
//     the share of that task's slots done that day across every store. A row
//     opens the task for the same period, a square opens that task on that day.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useApi } from '@/lib/client/use-api';
import { jakartaTodayKey } from '@/lib/day-bucket';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';
import { OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import TaskBoard, { boardRowSummary } from '@/components/tasks/TaskBoard';
import HeatGrid, { PctLegend, type HeatRow } from '@/components/tasks/HeatGrid';
import { CellLegend } from '@/components/tasks/TaskCell';
import { AreaBreakdown, MetricTile, RateBar } from '@/components/tasks/MetricTile';
import StoreDaySheet, { type StoreDayTarget } from '@/app/ops/tasks/progress/store-day';
import {
  BOARD_TASK,
  PROGRESS_TASKS,
  isFutureDay,
  isPastDay,
  periodDays,
  progressTaskHref,
  summariseStore,
  type BoardResponse,
  type OverviewRangeResponse,
} from '@/lib/task-progress';

type SortKey = 'attention' | 'progress' | 'name';

const DAILY_TASKS = PROGRESS_TASKS.filter((t) => t.code !== BOARD_TASK);
const pctOf = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

function useHeld<T extends { success: boolean }>(data: T | undefined): T | null {
  const [held, setHeld] = useState<T | null>(null);
  if (data?.success && data !== held) setHeld(data);
  return data?.success ? data : held;
}

function dayLong(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayShort(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export default function ItTaskProgressOverviewPage() {
  const router = useRouter();
  const [date, setDate] = useState(jakartaTodayKey());
  const [period, setPeriod] = useState<Period>('daily');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('all');
  const [sort, setSort] = useState<SortKey>('attention');
  const [onlyBehind, setOnlyBehind] = useState(false);
  const [sheet, setSheet] = useState<StoreDayTarget | null>(null);

  const today = jakartaTodayKey();
  const days = useMemo(() => periodDays(period, date), [period, date]);
  const isPast = isPastDay(date);

  const boardApi = useApi<BoardResponse>(period === 'daily' ? `/api/it/task-progress?date=${date}` : null);
  const rangeApi = useApi<OverviewRangeResponse>(period === 'daily' ? null : `/api/it/task-progress?from=${days[0]}&to=${days[days.length - 1]}`);
  const board = useHeld(boardApi.data);
  const range = useHeld(rangeApi.data);
  const api = period === 'daily' ? boardApi : rangeApi;
  const error = api.data && !api.data.success ? (api.data.error ?? 'Gagal memuat data.') : api.error?.message ?? null;
  const firstLoad = period === 'daily' ? !board : !range;

  // ── Daily ──────────────────────────────────────────────────────────────────
  const areaOptions = useMemo(
    () => [...new Set((board?.stores ?? []).map((s) => s.areaName).filter((a): a is string => !!a))].sort(),
    [board],
  );
  const activeArea = area !== 'all' && areaOptions.includes(area) ? area : 'all';

  const scoped = useMemo(
    () => (board?.stores ?? []).filter((s) => activeArea === 'all' || s.areaName === activeArea),
    [board, activeArea],
  );

  const boardRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = scoped
      .filter((s) => !q || `${s.name} ${s.storeNo} ${s.areaName ?? ''}`.toLowerCase().includes(q))
      .map((store) => ({ store, summary: boardRowSummary(store, isPast) }))
      .filter((r) => !onlyBehind || (r.summary.total > 0 && r.summary.done < r.summary.total));
    return rows.sort((a, b) => {
      if (sort === 'name') return a.store.name.localeCompare(b.store.name);
      const noA = a.summary.total === 0 ? 1 : 0;
      const noB = b.summary.total === 0 ? 1 : 0;
      if (noA !== noB) return noA - noB;
      return (sort === 'progress' ? b.summary.rate - a.summary.rate : a.summary.rate - b.summary.rate) || a.store.name.localeCompare(b.store.name);
    }).map((r) => r.store);
  }, [scoped, search, onlyBehind, sort, isPast]);

  const daily = useMemo(() => {
    let done = 0;
    let total = 0;
    let behind = 0;
    let handover = 0;
    const perArea = new Map<string, { done: number; total: number }>();
    const perTask = new Map<string, { done: number; total: number }>();
    for (const store of board?.stores ?? []) {
      const r = boardRowSummary(store, isPast);
      const a = perArea.get(store.areaName ?? 'Tanpa area') ?? { done: 0, total: 0 };
      a.done += r.done; a.total += r.total;
      perArea.set(store.areaName ?? 'Tanpa area', a);
      if (activeArea !== 'all' && store.areaName !== activeArea) continue;
      done += r.done; total += r.total;
      if (r.total > 0 && r.done < r.total) behind++;
      if ((store.tasks[BOARD_TASK] ?? []).length) handover++;
      for (const t of DAILY_TASKS) {
        const p = summariseStore(store.tasks[t.code] ?? [], isPast);
        if (p.key === 'none') continue;
        const c = perTask.get(t.code) ?? { done: 0, total: 0 };
        c.total++;
        if (p.key === 'completed') c.done++;
        perTask.set(t.code, c);
      }
    }
    const worst = [...perTask.entries()]
      .map(([code, c]) => ({ code, rate: pctOf(c.done, c.total), ...c }))
      .sort((a, b) => a.rate - b.rate)[0] ?? null;
    return {
      done, total, rate: pctOf(done, total), behind, handover, worst,
      areas: [...perArea.entries()].map(([name, c]) => ({ name, ...c })),
    };
  }, [board, isPast, activeArea]);

  // ── Week / month ───────────────────────────────────────────────────────────
  const rangeIndex = useMemo(() => new Map((range?.tasks ?? []).map((t) => [t.type, t.days])), [range]);

  const heatRows = useMemo<HeatRow[]>(() => {
    const rows = DAILY_TASKS.map((t) => {
      const cells = rangeIndex.get(t.code) ?? {};
      let done = 0;
      let total = 0;
      for (const d of days) { const c = cells[d]; if (c) { done += c.done; total += c.total; } }
      return { key: t.code, label: t.label, sublabel: t.description, summary: total ? { done, total } : null };
    });
    const list = onlyBehind ? rows.filter((r) => r.summary && r.summary.done < r.summary.total) : rows;
    if (sort === 'name') return list;
    return [...list].sort((a, b) => {
      const ra = a.summary ? a.summary.done / a.summary.total : null;
      const rb = b.summary ? b.summary.done / b.summary.total : null;
      if (ra === null || rb === null) return (ra === null ? 1 : 0) - (rb === null ? 1 : 0);
      return sort === 'progress' ? rb - ra : ra - rb;
    });
  }, [rangeIndex, days, onlyBehind, sort]);

  const rangeStats = useMemo(() => {
    let done = 0;
    let total = 0;
    const perDay = new Map<string, { done: number; total: number }>();
    for (const t of range?.tasks ?? []) {
      for (const [d, c] of Object.entries(t.days)) {
        done += c.done; total += c.total;
        const x = perDay.get(d) ?? { done: 0, total: 0 };
        x.done += c.done; x.total += c.total;
        perDay.set(d, x);
      }
    }
    const worstDay = [...perDay.entries()].map(([d, c]) => ({ d, rate: pctOf(c.done, c.total) })).sort((a, b) => a.rate - b.rate)[0] ?? null;
    const worstTask = heatRows.filter((r) => r.summary).map((r) => ({ label: r.label, rate: pctOf(r.summary!.done, r.summary!.total) })).sort((a, b) => a.rate - b.rate)[0] ?? null;
    return { done, total, rate: pctOf(done, total), worstDay, worstTask, daysWithData: perDay.size };
  }, [range, heatRows]);

  const changePeriod = (next: Period) => setPeriod(next);
  const subtitle = period === 'daily'
    ? dayLong(date)
    : `${dayShort(days[0])} – ${dayShort(days[days.length - 1])}`;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Monitoring"
        title="Task Progress"
        subtitle={`Semua task, semua toko · ${subtitle}`}
        periodProps={{ period, onPeriodChange: changePeriod, date, onDateChange: setDate }}
        onRefresh={() => void api.refresh()}
        refreshing={api.validating}
        contentClassName="w-full"
      />

      <div className="space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-sm font-bold">Gagal memuat data</p><p className="mt-0.5 text-xs">{error}</p></div>
          </div>
        )}
        {period === 'daily' && isFutureDay(date) && (
          <p role="status" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Tanggal ini belum terjadi — belum ada progress yang bisa dilihat.</p>
        )}

        {/* KPIs */}
        {period === 'daily' ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile
                label="Progress"
                value={firstLoad ? '–' : `${daily.rate}%`}
                tone={daily.rate >= 80 ? 'success' : daily.rate >= 50 ? 'warning' : 'danger'}
                hint={`${daily.done}/${daily.total} task selesai`}
                footer={<RateBar rate={daily.rate} />}
              />
              <MetricTile
                label="Toko belum selesai"
                value={firstLoad ? '–' : daily.behind}
                tone={daily.behind ? 'warning' : 'success'}
                hint={onlyBehind ? 'Klik untuk tampilkan semua' : 'Klik untuk tampilkan saja'}
                active={onlyBehind}
                onClick={() => setOnlyBehind((v) => !v)}
              />
              <MetricTile
                label="Task paling tertinggal"
                value={firstLoad ? '–' : daily.worst ? `${daily.worst.rate}%` : '—'}
                tone={daily.worst && daily.worst.rate < 50 ? 'danger' : 'default'}
                hint={daily.worst ? `${PROGRESS_TASKS.find((t) => t.code === daily.worst!.code)?.label} · ${daily.worst.done}/${daily.worst.total} toko` : 'Tidak ada task'}
                onClick={daily.worst ? () => router.push(`${progressTaskHref(daily.worst!.code)}?date=${date}`) : undefined}
              />
              <MetricTile
                label="Serah terima menunggu"
                value={firstLoad ? '–' : daily.handover}
                tone={daily.handover ? 'warning' : 'success'}
                hint="toko dengan item belum diterima"
                onClick={() => router.push(progressTaskHref(BOARD_TASK))}
              />
            </div>
            <AreaBreakdown
              items={daily.areas}
              unit="task"
              active={activeArea === 'all' ? undefined : activeArea}
              onPick={(name) => setArea((cur) => (cur === name ? 'all' : name))}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile
              label="Progress periode"
              value={firstLoad ? '–' : `${rangeStats.rate}%`}
              tone={rangeStats.rate >= 80 ? 'success' : rangeStats.rate >= 50 ? 'warning' : 'danger'}
              hint={`${rangeStats.done}/${rangeStats.total} task selesai`}
              footer={<RateBar rate={rangeStats.rate} />}
            />
            <MetricTile
              label="Task paling tertinggal"
              value={firstLoad ? '–' : rangeStats.worstTask ? `${rangeStats.worstTask.rate}%` : '—'}
              tone={rangeStats.worstTask && rangeStats.worstTask.rate < 50 ? 'danger' : 'default'}
              hint={rangeStats.worstTask?.label ?? 'Tidak ada task'}
            />
            <MetricTile
              label="Hari terendah"
              value={firstLoad ? '–' : rangeStats.worstDay ? `${rangeStats.worstDay.rate}%` : '—'}
              tone={rangeStats.worstDay && rangeStats.worstDay.rate < 50 ? 'danger' : 'default'}
              hint={rangeStats.worstDay ? dayShort(rangeStats.worstDay.d) : 'Belum ada data'}
            />
            <MetricTile label="Hari tercatat" value={firstLoad ? '–' : rangeStats.daysWithData} hint={`dari ${days.length} hari`} />
          </div>
        )}

        {/* Filters scope the board below */}
        <div className="flex flex-wrap items-center gap-2">
          {period === 'daily' && (
            <>
              <OpsSearchInput value={search} onChange={setSearch} placeholder="Cari nama / kode toko…" className="max-w-sm" />
              {areaOptions.length > 1 && (
                <OpsFilterSelect label="Area" value={activeArea} onChange={setArea}>
                  <option value="all">Semua area</option>
                  {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                </OpsFilterSelect>
              )}
            </>
          )}
          <OpsFilterSelect label="Urutkan" value={sort} onChange={(v) => setSort(v as SortKey)} highlight={false}>
            <option value="attention">Urut: Paling tertinggal</option>
            <option value="progress">Urut: Progress tertinggi</option>
            <option value="name">{period === 'daily' ? 'Urut: Nama toko' : 'Urut: Urutan task'}</option>
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
          <div className="ml-auto">{period === 'daily' ? <CellLegend /> : <PctLegend />}</div>
        </div>

        {firstLoad ? (
          <div className="h-[420px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ) : period === 'daily' ? (
          boardRows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>
          ) : (
            <div className={cn('transition-opacity', api.validating && 'opacity-60')}>
              <TaskBoard
                stores={boardRows}
                columns={PROGRESS_TASKS}
                isPast={isPast}
                columnHref={(code) => `${progressTaskHref(code)}?date=${date}`}
                onOpenStore={(s) => setSheet({ storeId: s.storeId, name: s.name, storeNo: s.storeNo, date })}
                onOpenCell={(s, type, slots) => setSheet({
                  storeId: s.storeId,
                  name: s.name,
                  storeNo: s.storeNo,
                  date,
                  ...(slots.length === 1 && type !== BOARD_TASK ? { focusType: type, focusId: slots[0].id, focusShift: slots[0].shift } : {}),
                })}
              />
              <p className="mt-2 text-xs text-slate-400">Klik judul kolom untuk membuka halaman task itu. Arahkan kursor ke kotak untuk melihat siapa yang mengerjakan.</p>
            </div>
          )
        ) : (
          <div className={cn('transition-opacity', api.validating && 'opacity-60')}>
            <HeatGrid
              rows={heatRows}
              days={days}
              today={today}
              rowHeader="Task"
              cell={(row, day) => {
                const c = rangeIndex.get(row.key)?.[day];
                if (!c || !c.total) return null;
                return { kind: 'pct', done: c.done, total: c.total, title: `${row.label} · ${dayShort(day)}`, lines: ['slot task selesai di semua toko'] };
              }}
              onRowClick={(row) => router.push(`${progressTaskHref(row.key)}?period=${period}&date=${date}`)}
              onCellClick={(row, day) => router.push(`${progressTaskHref(row.key)}?date=${day}`)}
            />
            <p className="mt-2 text-xs text-slate-400">Angka = % slot task yang selesai hari itu di semua toko. Klik task untuk melihat per toko.</p>
          </div>
        )}
      </div>

      <StoreDaySheet target={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

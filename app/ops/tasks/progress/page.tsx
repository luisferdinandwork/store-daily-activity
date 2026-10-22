'use client';
// app/ops/tasks/progress/page.tsx
//
// Task Progress — the Ops task board.
//
//   • Harian: one row per store, one column per task, a status square per cell
//     (components/tasks/TaskBoard). The whole day on one screen: who is behind,
//     on which task, and — on hover — who did what and when. A square opens the
//     task; a store opens its day (store-day.tsx: tasks by shift, who did each).
//   • Mingguan / Bulanan: one row per store, one column per day, the day's
//     completion % per square (components/tasks/HeatGrid). A square opens that day.
//
// Stores furthest behind come first. Data: GET /api/ops/tasks/board (day) and
// /api/ops/tasks/progress/range (week / month).

import { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useApi } from '@/lib/client/use-api';
import { jakartaTodayKey } from '@/lib/day-bucket';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';
import { OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import TaskBoard, { boardRowSummary } from '@/components/tasks/TaskBoard';
import HeatGrid, { PctLegend, type HeatRow } from '@/components/tasks/HeatGrid';
import { CellLegend } from '@/components/tasks/TaskCell';
import {
  PROGRESS_TASKS,
  isPastDay,
  periodDays,
  summariseStore,
  type BoardResponse,
  type BoardStore,
} from '@/lib/task-progress';
import StoreDaySheet, { type StoreDayTarget } from './store-day';

type SortKey = 'attention' | 'name' | 'progress';

type RangeResponse = {
  success: boolean;
  error?: string;
  stores: { id: string; name: string; storeNo: string; address: string; areaId: string | null; areaName: string | null }[];
  summaries: { storeId: string; date: string; completed: number; total: number; pending: number }[];
};

// Severity of a task cell when the board is sorted by that task.
const COLUMN_RANK: Record<string, number> = { pending: 0, not_started: 1, partial: 2, in_progress: 3, completed: 4, none: 5 };

function fmtDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function rangeLabel(days: string[]): string {
  const f = (k: string, withYear = false) =>
    new Date(`${k}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return `${f(days[0])} – ${f(days[days.length - 1], true)}`;
}

function storeMatches(s: { name: string; storeNo: string; areaName: string | null }, area: string, query: string): boolean {
  if (area !== 'all' && s.areaName !== area) return false;
  const q = query.trim().toLowerCase();
  return !q || `${s.name} ${s.storeNo} ${s.areaName ?? ''}`.toLowerCase().includes(q);
}

/** Hold the last good response while a new day / period loads (no flash, no jump). */
function useHeld<T extends { success: boolean }>(data: T | undefined): T | null {
  const [held, setHeld] = useState<T | null>(null);
  if (data?.success && data !== held) setHeld(data);
  return data?.success ? data : held;
}

export default function OpsTaskProgressPage() {
  const [date, setDate] = useState(jakartaTodayKey());
  const [period, setPeriod] = useState<Period>('daily');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('all');
  const [sort, setSort] = useState<SortKey>('attention');
  const [taskSort, setTaskSort] = useState<string | null>(null);
  const [onlyBehind, setOnlyBehind] = useState(false);
  const [sheet, setSheet] = useState<StoreDayTarget | null>(null);

  const today = jakartaTodayKey();
  const days = useMemo(() => periodDays(period, date), [period, date]);
  const isPast = isPastDay(date);

  const boardApi = useApi<BoardResponse>(period === 'daily' ? `/api/ops/tasks/board?date=${date}` : null);
  const rangeApi = useApi<RangeResponse>(
    period === 'daily' ? null : `/api/ops/tasks/progress/range?startDate=${days[0]}&endDate=${days[days.length - 1]}`,
  );
  const board = useHeld(boardApi.data);
  const range = useHeld(rangeApi.data);
  const api = period === 'daily' ? boardApi : rangeApi;
  const error = api.data && !api.data.success ? (api.data.error ?? 'Gagal memuat data.') : api.error?.message ?? null;
  const reloading = api.validating;
  const firstLoad = period === 'daily' ? !board : !range;

  // ── Stores, one list for both views ────────────────────────────────────────
  const storeList = useMemo(() => {
    if (period === 'daily') {
      return (board?.stores ?? []).map((s) => ({ id: s.storeId, name: s.name, storeNo: s.storeNo, areaName: s.areaName }));
    }
    return (range?.stores ?? []).map((s) => ({ id: Number(s.id), name: s.name, storeNo: s.storeNo, areaName: s.areaName }));
  }, [period, board, range]);

  const areaOptions = useMemo(
    () => [...new Set(storeList.map((s) => s.areaName).filter((a): a is string => !!a))].sort(),
    [storeList],
  );
  const activeArea = area !== 'all' && areaOptions.includes(area) ? area : 'all';
  const scopeLabel = board?.scope === 'area' ? (board.areaName ?? 'Area') : activeArea !== 'all' ? activeArea : 'Semua area';

  // ── Daily board rows ───────────────────────────────────────────────────────
  const boardRows = useMemo(() => {
    const rows = (board?.stores ?? []).filter((s) => storeMatches(s, activeArea, search)).map((store) => ({ store, summary: boardRowSummary(store, isPast) }));
    const behind = (r: (typeof rows)[number]) => r.summary.total > 0 && r.summary.done < r.summary.total;
    const list = onlyBehind ? rows.filter(behind) : rows;
    const columnRank = (s: BoardStore) => COLUMN_RANK[summariseStore(s.tasks[taskSort!] ?? [], isPast).key] ?? 5;
    return [...list].sort((a, b) => {
      if (taskSort) {
        const d = columnRank(a.store) - columnRank(b.store);
        if (d) return d;
      }
      if (sort === 'name') return a.store.name.localeCompare(b.store.name);
      const noA = a.summary.total === 0 ? 1 : 0;
      const noB = b.summary.total === 0 ? 1 : 0;
      if (noA !== noB) return noA - noB;
      if (sort === 'progress') return b.summary.rate - a.summary.rate || a.store.name.localeCompare(b.store.name);
      return a.summary.rate - b.summary.rate || a.store.name.localeCompare(b.store.name);
    }).map((r) => r.store);
  }, [board, search, activeArea, sort, taskSort, onlyBehind, isPast]);

  const dayTotals = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const s of boardRows) { const r = boardRowSummary(s, isPast); done += r.done; total += r.total; }
    return { done, total, rate: total ? Math.round((done / total) * 100) : 0 };
  }, [boardRows, isPast]);

  // ── Week / month grid rows ─────────────────────────────────────────────────
  const rangeCells = useMemo(() => {
    const map = new Map<string, { completed: number; total: number; pending: number }>();
    for (const s of range?.summaries ?? []) map.set(`${s.storeId}|${s.date}`, s);
    return map;
  }, [range]);

  const heatRows = useMemo<HeatRow[]>(() => {
    const rows = (range?.stores ?? []).filter((s) => storeMatches(s, activeArea, search)).map((s) => {
      let done = 0;
      let total = 0;
      for (const d of days) { const c = rangeCells.get(`${s.id}|${d}`); if (c) { done += c.completed; total += c.total; } }
      return { key: s.id, label: s.name, sublabel: `${s.storeNo}${s.areaName ? ` · ${s.areaName}` : ''}`, summary: total ? { done, total } : null };
    });
    const rate = (r: HeatRow) => (r.summary ? r.summary.done / r.summary.total : null);
    const list = onlyBehind ? rows.filter((r) => r.summary && r.summary.done < r.summary.total) : rows;
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.label.localeCompare(b.label);
      const ra = rate(a);
      const rb = rate(b);
      if (ra === null || rb === null) return (ra === null ? 1 : 0) - (rb === null ? 1 : 0) || a.label.localeCompare(b.label);
      return (sort === 'progress' ? rb - ra : ra - rb) || a.label.localeCompare(b.label);
    });
  }, [range, rangeCells, days, search, activeArea, sort, onlyBehind]);

  const rangeTotals = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const r of heatRows) if (r.summary) { done += r.summary.done; total += r.summary.total; }
    return { done, total, rate: total ? Math.round((done / total) * 100) : 0 };
  }, [heatRows]);

  const totals = period === 'daily' ? dayTotals : rangeTotals;
  const storeCount = period === 'daily' ? boardRows.length : heatRows.length;

  const changePeriod = (next: Period) => { setPeriod(next); setTaskSort(null); };
  const openDay = (storeId: number, day: string) => {
    const s = storeList.find((x) => x.id === storeId);
    if (!s) return;
    setPeriod('daily');
    setDate(day);
    setSheet({ storeId, name: s.name, storeNo: s.storeNo, date: day });
  };

  const subtitle = period === 'daily' ? fmtDateLabel(date) : rangeLabel(days);

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Task Monitor"
        title="Task Progress"
        subtitle={`${scopeLabel} · ${subtitle}`}
        periodProps={{ period, onPeriodChange: changePeriod, date, onDateChange: setDate }}
        onRefresh={() => void api.refresh()}
        refreshing={reloading}
        contentClassName="w-full"
      />

      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {/* Filters scope everything below them */}
        <div className="flex flex-wrap items-center gap-2">
          <OpsSearchInput value={search} onChange={setSearch} placeholder="Cari nama / kode toko…" className="max-w-sm" />
          {board?.scope !== 'area' && areaOptions.length > 1 && (
            <OpsFilterSelect label="Area" value={activeArea} onChange={setArea}>
              <option value="all">Semua area</option>
              {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </OpsFilterSelect>
          )}
          <OpsFilterSelect label="Urutkan" value={sort} onChange={(v) => { setSort(v as SortKey); setTaskSort(null); }} highlight={false}>
            <option value="attention">Urut: Paling tertinggal</option>
            <option value="progress">Urut: Progress tertinggi</option>
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
          {taskSort && (
            <button type="button" onClick={() => setTaskSort(null)} className="h-10 rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">
              Urut per task: {PROGRESS_TASKS.find((t) => t.code === taskSort)?.label} ✕
            </button>
          )}
        </div>

        {/* One line: how far the visible stores are */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="min-w-[220px] flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-slate-800">
                {period === 'daily' ? 'Progress harian' : period === 'weekly' ? 'Progress mingguan' : 'Progress bulanan'}
                <span className="ml-2 font-normal text-slate-400">{storeCount} toko</span>
              </p>
              <p className="text-sm tabular-nums text-slate-500">
                <span className="text-lg font-semibold text-slate-900">{firstLoad ? '–' : `${totals.rate}%`}</span>
                <span className="ml-2">{totals.done}/{totals.total} task</span>
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn('h-full rounded-full transition-all duration-500', totals.rate >= 80 ? 'bg-emerald-500' : totals.rate >= 50 ? 'bg-amber-400' : 'bg-rose-500')}
                style={{ width: `${totals.rate}%` }}
              />
            </div>
          </div>
          {period === 'daily' ? <CellLegend className="max-w-[640px]" /> : <PctLegend />}
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-sm font-bold">Gagal memuat data</p><p className="mt-0.5 text-xs">{error}</p></div>
          </div>
        )}

        {firstLoad ? (
          <div className="h-[420px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ) : storeCount === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm font-semibold text-slate-700">Tidak ada toko</p>
            <p className="mt-1 text-xs text-slate-400">Coba ubah tanggal, area, atau kata kunci pencarian.</p>
          </div>
        ) : period === 'daily' ? (
          <div className={cn('transition-opacity', reloading && 'opacity-60')}>
            <TaskBoard
              stores={boardRows}
              columns={PROGRESS_TASKS}
              isPast={isPast}
              activeColumn={taskSort}
              onColumnClick={(code) => setTaskSort((cur) => (cur === code ? null : code))}
              onOpenStore={(s) => setSheet({ storeId: s.storeId, name: s.name, storeNo: s.storeNo, date })}
              onOpenCell={(s, type, slots) => setSheet({
                storeId: s.storeId,
                name: s.name,
                storeNo: s.storeNo,
                date,
                // One slot → straight to that task; several (briefing per shift, grooming per person) → the day.
                ...(slots.length === 1 && type !== 'serah_terima'
                  ? { focusType: type, focusId: slots[0].id, focusShift: slots[0].shift }
                  : {}),
              })}
            />
            <p className="mt-2 text-xs text-slate-400">Klik judul kolom untuk mengurutkan toko berdasarkan task itu. Arahkan kursor ke kotak untuk melihat siapa yang mengerjakan.</p>
          </div>
        ) : (
          <div className={cn('transition-opacity', reloading && 'opacity-60')}>
            <HeatGrid
              rows={heatRows}
              days={days}
              today={today}
              rowHeader="Toko"
              cell={(row, day) => {
                const c = rangeCells.get(`${row.key}|${day}`);
                if (!c || !c.total) return null;
                return {
                  kind: 'pct',
                  done: c.completed,
                  total: c.total,
                  title: `${row.label} · ${new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}`,
                  lines: c.pending ? [`${c.pending} task pending`] : [],
                };
              }}
              onCellClick={(row, day) => openDay(Number(row.key), day)}
            />
            <p className="mt-2 text-xs text-slate-400">Angka = % task selesai hari itu. Klik kotak untuk membuka task toko pada hari tersebut.</p>
          </div>
        )}
      </div>

      <StoreDaySheet target={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

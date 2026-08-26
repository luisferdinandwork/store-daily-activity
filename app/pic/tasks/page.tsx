'use client';
// app/pic/tasks/page.tsx
//
// PIC task review — single store (the PIC's own home store). Daily mode
// reuses the same TaskDetailView/labels/icons the OPS task progress page
// uses, fed from the PIC-scoped /api/pic/tasks/progress endpoint. Weekly/
// monthly mode shows a day-by-day breakdown for the store, fed from
// /api/pic/tasks/progress/range — matching what OPS already sees per store.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, ClipboardList, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';
import {
  type FlatTask,
  TASK_LABELS,
  TASK_ICONS,
  fmtTime,
  statusBadgeClass,
  statusLabel,
  TaskDetailView,
} from '@/app/ops/tasks/progress/task-detail';

// ─── Types ────────────────────────────────────────────────────────────────────

type StoreSummary = {
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  verified: number;
  rejected: number;
  total: number;
  completionRate: number;
};

type ProgressResponse = {
  success: boolean;
  error?: string;
  date: string;
  store: { id: string; name: string; address: string };
  summary: StoreSummary;
  tasks: FlatTask[];
};

type RangeSummaryRow = {
  date: string;
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  total: number;
};

type RangeResponse = {
  success: boolean;
  error?: string;
  startDate: string;
  endDate: string;
  store: { id: string; name: string; address: string };
  summaries: RangeSummaryRow[];
};

type DayMatrixRow = {
  date: string;
  weekdayLabel: string;
  dayLabel: string;
  isToday: boolean;
  completed: number;
  total: number;
  pending: number;
  inProgress: number;
  rate: number;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

const ID_WEEKDAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function todayKey(): string {
  return toKey(new Date());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfISOWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day));
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function taskKey(t: Pick<FlatTask, 'type' | 'id'>): string {
  return `${t.type}:${t.id}`;
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function TaskRow({ task, onSelect }: { task: FlatTask; onSelect: () => void }) {
  const label = TASK_LABELS[task.type] ?? task.type.replaceAll('_', ' ');
  const Icon = TASK_ICONS[task.type] ?? ClipboardList;
  const status = task.status ?? 'not_started';

  const iconBg =
    status === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    status === 'verified'    ? 'bg-teal-50 text-teal-600' :
    status === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    status === 'pending'     ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left transition hover:bg-slate-50"
    >
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconBg)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-900">{label}</p>
        {task.userName && (
          <p className="truncate text-[11px] text-slate-400">
            {task.userName}
            {task.completedAt && ` · Selesai ${fmtTime(task.completedAt)}`}
          </p>
        )}
      </div>
      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(status))}>
        {statusLabel(status)}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
    </button>
  );
}

function SummaryPill({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-2xl font-black', cls)}>{value}</p>
    </div>
  );
}

function progressBarClass(rate: number): string {
  if (rate === 0) return 'bg-amber-300';
  if (rate >= 100) return 'bg-emerald-500';
  return 'bg-indigo-500';
}

function progressTextClass(rate: number): string {
  if (rate === 0) return 'text-amber-500';
  if (rate >= 100) return 'text-emerald-600';
  return 'text-indigo-600';
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div className={cn('h-full rounded-full transition-all duration-500', progressBarClass(pct))} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── RangeMatrixPanel (weekly/monthly, day-by-day breakdown) ────────────────

function RangeMatrixPanel({ rows, loading, periodLabel }: {
  rows: DayMatrixRow[];
  loading: boolean;
  periodLabel: string;
}) {
  const aggregate = useMemo(() => {
    const sum = rows.reduce((acc, r) => ({ completed: acc.completed + r.completed, total: acc.total + r.total }), { completed: 0, total: 0 });
    return { ...sum, rate: sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0 };
  }, [rows]);

  const visibleRows = rows.filter((r) => r.total > 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">{periodLabel}</p>
        <p className="mt-1 text-sm font-semibold text-slate-600">
          <span className="text-emerald-600">{aggregate.completed} task selesai</span>
          <span className="text-slate-300"> dari </span>
          <span className="text-slate-700">{aggregate.total} task</span>
          <span className="text-slate-300"> · </span>
          <span className={cn('font-black', progressTextClass(aggregate.rate))}>{aggregate.rate}%</span>
        </p>
      </div>
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center p-8">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat data periode…
          </div>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">Tidak ada task pada periode yang dipilih.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {visibleRows.map((row) => (
            <div key={row.date} className={cn('flex items-center gap-3 px-4 py-3 transition', row.isToday && 'bg-indigo-50/40')}>
              <div className={cn(
                'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl',
                row.isToday ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600',
              )}>
                <span className="text-[9px] font-bold uppercase leading-none">{row.weekdayLabel}</span>
                <span className="mt-0.5 text-base font-black leading-none">{row.dayLabel}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-500">
                    {row.completed}/{row.total} task selesai
                    {row.pending > 0 && <span className="text-amber-600"> · {row.pending} pending</span>}
                  </p>
                  <span className={cn('shrink-0 text-sm font-black tabular-nums', progressTextClass(row.rate))}>{row.rate}%</span>
                </div>
                <div className="mt-1.5"><ProgressBar pct={row.rate} /></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PicTasksPage() {
  const [date, setDate] = useState(todayKey());
  const [period, setPeriod] = useState<Period>('daily');
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [rangeData, setRangeData] = useState<RangeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRange, setLoadingRange] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rangeDays = useMemo((): Date[] => {
    if (period === 'daily') return [];
    const cur = fromKey(date);
    if (period === 'weekly') {
      const start = startOfISOWeek(cur);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const start = startOfMonth(cur);
    const end = endOfMonth(cur);
    const out: Date[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [period, date]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pic/tasks/progress?date=${date}`, { cache: 'no-store' });
      const json = (await res.json()) as ProgressResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load tasks.');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadRange = useCallback(async (start: Date, end: Date) => {
    setLoadingRange(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate: toKey(start), endDate: toKey(end) });
      const res = await fetch(`/api/pic/tasks/progress/range?${params}`, { cache: 'no-store' });
      const json = (await res.json()) as RangeResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load range data.');
      setRangeData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load range data.');
      setRangeData(null);
    } finally {
      setLoadingRange(false);
    }
  }, []);

  useEffect(() => {
    if (period === 'daily') void load();
  }, [load, period]);

  useEffect(() => {
    if (period === 'daily' || !rangeDays.length) { setRangeData(null); return; }
    void loadRange(rangeDays[0], rangeDays[rangeDays.length - 1]);
  }, [period, rangeDays, loadRange]);

  useEffect(() => { setSelectedKey(null); }, [date, period]);

  const groupedTasks = useMemo(() => {
    const groups: Record<string, FlatTask[]> = { morning: [], evening: [], full_day: [], other: [] };
    for (const task of data?.tasks ?? []) {
      const shift = task.shift === 'morning' || task.shift === 'evening' || task.shift === 'full_day' ? task.shift : 'other';
      groups[shift].push(task);
    }
    return groups;
  }, [data?.tasks]);

  const selectedTask = selectedKey ? (data?.tasks.find((t) => taskKey(t) === selectedKey) ?? null) : null;

  const shiftSections = [
    { key: 'morning', label: 'Morning Shift' },
    { key: 'full_day', label: 'Full Day Shift' },
    { key: 'evening', label: 'Evening Shift' },
    { key: 'other', label: 'Other' },
  ] as const;

  const rangeMatrixRows = useMemo((): DayMatrixRow[] => {
    if (period === 'daily' || !rangeData || !rangeDays.length) return [];
    const today = new Date();
    return rangeDays.map((d) => {
      const dateKey = toKey(d);
      const row = rangeData.summaries.find((s) => s.date === dateKey);
      const completed = row?.completed ?? 0;
      const total = row?.total ?? 0;
      return {
        date: dateKey,
        weekdayLabel: ID_WEEKDAY_SHORT[d.getDay()],
        dayLabel: String(d.getDate()),
        isToday: isSameDay(d, today),
        completed,
        total,
        pending: row?.pending ?? 0,
        inProgress: row?.inProgress ?? 0,
        rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });
  }, [rangeData, rangeDays, period]);

  const rangePeriodLabel = period === 'weekly' ? 'Tinjauan Mingguan' : 'Tinjauan Bulanan';
  const storeInfo = data?.store ?? rangeData?.store ?? null;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="PIC · Task Review"
        title="Tasks"
        subtitle={storeInfo ? `${storeInfo.name} · ${storeInfo.address}` : undefined}
        periodProps={{ period, onPeriodChange: setPeriod, date, onDateChange: setDate }}
        onRefresh={() => {
          if (period === 'daily') void load();
          else if (rangeDays.length) void loadRange(rangeDays[0], rangeDays[rangeDays.length - 1]);
        }}
        refreshing={loading || loadingRange}
      />

      <div className="mx-auto max-w-5xl space-y-5 p-6 lg:p-8">
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-10 text-center">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-400" />
            <p className="font-semibold text-rose-700">{error}</p>
            <button onClick={() => (period === 'daily' ? load() : loadRange(rangeDays[0], rangeDays[rangeDays.length - 1]))} className="mt-3 rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-700">
              Retry
            </button>
          </div>
        ) : period !== 'daily' ? (
          <RangeMatrixPanel rows={rangeMatrixRows} loading={loadingRange} periodLabel={rangePeriodLabel} />
        ) : selectedTask ? (
          <TaskDetailView task={selectedTask} onBack={() => setSelectedKey(null)} />
        ) : loading ? (
          <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat task…
            </div>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryPill label="Completed" value={data.summary.completed} cls="text-emerald-600" />
              <SummaryPill label="In Progress" value={data.summary.inProgress} cls="text-indigo-600" />
              <SummaryPill label="Not Started" value={data.summary.notStarted} cls="text-amber-500" />
              <SummaryPill label="Pending" value={data.summary.pending} cls="text-amber-600" />
            </div>

            {data.tasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
                <ClipboardList className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">No tasks for this date.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {shiftSections.map((section) => {
                  const tasks = groupedTasks[section.key];
                  if (tasks.length === 0) return null;
                  return (
                    <div key={section.key}>
                      <div className="mb-2.5 flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">{section.label}</h3>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{tasks.length} task</span>
                      </div>
                      <div className="space-y-2">
                        {tasks.map((task) => (
                          <TaskRow key={taskKey(task)} task={task} onSelect={() => setSelectedKey(taskKey(task))} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

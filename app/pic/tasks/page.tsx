'use client';
// app/pic/tasks/page.tsx
//
// PIC task review — single store (the PIC's own home store), one day at a
// time. Reuses the same TaskDetailView/labels/icons the OPS task progress
// page uses, fed from the PIC-scoped /api/pic/tasks/progress endpoint.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, ClipboardList, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
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

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PicTasksPage() {
  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelectedKey(null); }, [date]);

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

  return (
    <div className="min-h-full bg-slate-50">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">PIC · Task Review</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Tasks</h1>
            {data && <p className="mt-1 text-sm text-slate-500">{data.store.name} · {data.store.address}</p>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-5 p-6 lg:p-8">
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-10 text-center">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-400" />
            <p className="font-semibold text-rose-700">{error}</p>
            <button onClick={load} className="mt-3 rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-700">
              Retry
            </button>
          </div>
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

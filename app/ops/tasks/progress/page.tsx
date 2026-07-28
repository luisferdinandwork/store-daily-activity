'use client';
// app/ops/tasks/progress/page.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  History,
  Loader2,
  MapPin,
  Search,
  Store,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader, { type Period } from '@/components/ops/layout/OpsPageHeader';
import {
  type FlatTask,
  type TaskStatus,
  TASK_LABELS,
  TASK_ICONS,
  fmtTime,
  statusBadgeClass,
  statusLabel,
  TaskDetailView,
} from './task-detail';

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

type StoreRow = {
  id: string;
  name: string;
  address: string;
  areaId?: string | null;
  areaName?: string | null;
  summary: StoreSummary;
};

type OverviewResponse = {
  success: boolean;
  error?: string;
  mode?: 'overview';
  scope?: 'area' | 'all_areas';
  date: string;
  area: { id: string; name: string } | null;
  summary: StoreSummary;
  stores: StoreRow[];
};

type DetailResponse = {
  success: boolean;
  error?: string;
  mode?: 'detail';
  scope?: 'area' | 'all_areas';
  date: string;
  store: { id: string; name: string; address: string; areaId?: string | null };
  summary: StoreSummary;
  tasks: FlatTask[];
};

type RangeSummaryRow = {
  storeId: string;
  date: string;
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  verified?: number;
  rejected?: number;
  total: number;
};

type RangeResponse = {
  success: boolean;
  error?: string;
  startDate: string;
  endDate: string;
  stores: { id: string; name: string; address: string; areaId: string | null; areaName: string | null }[];
  summaries: RangeSummaryRow[];
};

type DayMatrixRow = {
  date: string;
  weekdayLabel: string;
  dayLabel: string;
  isToday: boolean;
  aggregate: StoreSummary;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ID_WEEKDAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function taskKey(t: Pick<FlatTask, 'type' | 'id'>): string {
  return `${t.type}-${t.id}`;
}

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

function fmtDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function fmtMonthLabel(date: Date): string {
  return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
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

function progressRingColor(rate: number): string {
  if (rate === 0) return '#fbbf24';
  if (rate >= 100) return '#10b981';
  return '#6366f1';
}

function emptySummary(): StoreSummary {
  return { notStarted: 0, inProgress: 0, completed: 0, pending: 0, verified: 0, rejected: 0, total: 0, completionRate: 0 };
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 52, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r    = (size - stroke) / 2;
  const c    = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color = progressRingColor(pct);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" className="transition-all duration-300" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-black tabular-nums" style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}

function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', progressBarClass(pct))} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

function TaskRow({ task, onSelect }: { task: FlatTask; onSelect: () => void }) {
  const label    = TASK_LABELS[task.type] ?? task.type.replaceAll('_', ' ');
  const status   = task.status ?? 'not_started';
  const TaskIcon = TASK_ICONS[task.type] ?? ClipboardList;

  const accentClass =
    status === 'completed'   ? 'bg-emerald-500' :
    status === 'in_progress' ? 'bg-indigo-500' :
    status === 'pending'     ? 'bg-amber-400 animate-pulse' :
    'bg-amber-300';

  const iconBg =
    status === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    status === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    status === 'pending'     ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  return (
    <button type="button" onClick={onSelect}
      className="relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-slate-100 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
    >
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-xl', accentClass)} />
      <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg pl-1', iconBg)}>
        <TaskIcon className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-900">{label}</p>
              {task.parentTaskId != null && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600">
                  <History className="h-2.5 w-2.5" /> Lanjutan
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">PIC: {task.userName ?? task.userId}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(status))}>
              {statusLabel(status)}
            </span>
            {task.completedAt && (
              <span className="text-[10px] text-slate-400">{fmtTime(task.completedAt)}</span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

// ─── GroomingGroupCard ────────────────────────────────────────────────────────

function GroomingGroupCard({ tasks, onSelectEmployee }: {
  tasks: FlatTask[];
  onSelectEmployee?: (taskKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const totalEmployees = tasks.length;
  const doneEmployees  = tasks.filter(t => t.status === 'completed').length;
  const activeCount    = tasks.filter(t => t.status === 'in_progress').length;
  const issueCount     = tasks.filter(t => t.status === 'pending').length;

  const aggregateStatus: TaskStatus =
    doneEmployees === totalEmployees ? 'completed' :
    activeCount > 0 ? 'in_progress' :
    issueCount > 0  ? 'pending' : 'not_started';

  const accentClass =
    aggregateStatus === 'completed'   ? 'bg-emerald-500' :
    aggregateStatus === 'in_progress' ? 'bg-indigo-500' :
    aggregateStatus === 'pending'     ? 'bg-amber-400 animate-pulse' :
    'bg-amber-300';

  const iconBg =
    aggregateStatus === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    aggregateStatus === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    aggregateStatus === 'pending'     ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="relative flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-xl', accentClass)} />
        <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg pl-1', iconBg)}>
          <User className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">Grooming Karyawan</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {doneEmployees}/{totalEmployees} karyawan selesai
                <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-600">Personal</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(aggregateStatus))}>
                {statusLabel(aggregateStatus)}
              </span>
              <span className="text-[10px] text-slate-400">
                {activeCount > 0 && <span className="text-indigo-500">{activeCount} aktif</span>}
                {activeCount > 0 && issueCount > 0 && ' · '}
                {issueCount > 0 && <span className="text-amber-600">{issueCount} pending</span>}
              </span>
            </div>
          </div>
          <ProgressBar pct={totalEmployees > 0 ? Math.round((doneEmployees / totalEmployees) * 100) : 0} className="mt-2" />
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-3">
          <div className="space-y-2">
            {tasks.map(task => {
              const empStatus = task.status ?? 'not_started';
              return (
                <button key={task.id} type="button" onClick={() => onSelectEmployee?.(taskKey(task))}
                  className="flex w-full items-center gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:bg-slate-50"
                >
                  <div className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                    empStatus === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
                    empStatus === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
                    empStatus === 'pending'     ? 'bg-amber-50 text-amber-600' :
                    'bg-amber-50 text-amber-500',
                  )}>
                    <User className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-900">{task.userName ?? task.userId}</p>
                    {task.completedAt && (
                      <p className="text-[10px] text-slate-400">Selesai {fmtTime(task.completedAt)}</p>
                    )}
                  </div>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(empStatus))}>
                    {statusLabel(empStatus)}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SummaryBreakdown ─────────────────────────────────────────────────────────

function SummaryBreakdown({ summary }: { summary: StoreSummary }) {
  const rows = [
    { label: 'Completed',   value: summary.completed,   cls: 'text-emerald-600' },
    { label: 'In Progress', value: summary.inProgress,  cls: 'text-indigo-600'  },
    { label: 'Not Started', value: summary.notStarted,  cls: 'text-amber-500'   },
    { label: 'Pending',     value: summary.pending,     cls: 'text-amber-600'   },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map(row => (
        <div key={row.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{row.label}</p>
          <p className={cn('mt-0.5 text-2xl font-black', row.cls)}>{row.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── StoreProgressCard ────────────────────────────────────────────────────────

function StoreProgressCard({ store, active, onOpen, rangeSummary, loadingRange }: {
  store: StoreRow;
  active: boolean;
  onOpen: () => void;
  rangeSummary?: StoreSummary;
  loadingRange?: boolean;
}) {
  const summary = rangeSummary ?? store.summary;
  const rate    = summary.completionRate;

  return (
    <button type="button" onClick={onOpen}
      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50', active && 'bg-indigo-50')}
    >
      <div className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500',
      )}>
        <Store className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>
            {store.name}
          </p>
          {loadingRange ? (
            <div className="h-3 w-8 animate-pulse rounded bg-slate-100" />
          ) : (
            <span className={cn('shrink-0 text-xs font-black tabular-nums', progressTextClass(rate))}>{rate}%</span>
          )}
        </div>

        {loadingRange ? (
          <div className="mt-1.5 h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
        ) : rangeSummary ? (
          <>
            <ProgressBar pct={rate} className="mt-1.5" />
            <p className="mt-1 text-[10px] text-slate-400">
              {rangeSummary.completed}/{rangeSummary.total} task selesai
              {rangeSummary.inProgress > 0 && <span className="ml-1.5 text-indigo-500">{rangeSummary.inProgress} aktif</span>}
              {rangeSummary.pending > 0 && <span className="ml-1.5 text-amber-500">{rangeSummary.pending} pending</span>}
            </p>
          </>
        ) : null}
      </div>

      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
    </button>
  );
}

// ─── AreaStoreGroup ───────────────────────────────────────────────────────────

function AreaStoreGroup({
  areaName, areaId, stores, selectedStoreId, selectedAreaId,
  isHo, initiallyOpen, onToggleStore, onSelectArea,
  rangeOverviewMap, loadingRange,
}: {
  areaName: string;
  areaId: string;
  stores: StoreRow[];
  selectedStoreId: string | null;
  selectedAreaId: string | null;
  isHo: boolean;
  initiallyOpen: boolean;
  onToggleStore: (storeId: string) => void;
  onSelectArea?: (areaId: string) => void;
  rangeOverviewMap?: Record<string, StoreSummary>;
  loadingRange?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  const areaAggregate = useMemo(() => {
    const sum = stores.reduce(
      (acc, s) => {
        const src = rangeOverviewMap?.[s.id] ?? s.summary;
        acc.completed   += src.completed;
        acc.total       += src.total;
        acc.notStarted  += src.notStarted;
        acc.inProgress  += src.inProgress;
        acc.pending     += src.pending;
        return acc;
      },
      { completed: 0, total: 0, notStarted: 0, inProgress: 0, pending: 0 },
    );
    const rate = sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0;
    return { ...sum, rate };
  }, [stores, rangeOverviewMap]);

  const isAreaActive = selectedAreaId === areaId;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className={cn('flex w-full items-center gap-2 bg-slate-50 px-4 py-2 transition', isAreaActive && isHo && 'bg-indigo-50')}>
        <button type="button" onClick={() => setOpen(v => !v)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-slate-200"
          aria-label={open ? 'Collapse area' : 'Expand area'}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', !open && '-rotate-90')} />
        </button>

        {isHo && onSelectArea ? (
          <button type="button" onClick={() => onSelectArea(areaId)}
            className={cn('flex flex-1 items-center gap-2 text-left transition', isAreaActive ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-700')}
          >
            <MapPin className={cn('h-3 w-3', isAreaActive ? 'text-indigo-500' : 'text-slate-400')} />
            <p className="text-[11px] font-bold uppercase tracking-widest">{areaName}</p>
            {loadingRange ? (
              <span className="h-4 w-8 animate-pulse rounded-full bg-slate-200" />
            ) : (
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                isAreaActive ? 'bg-indigo-200 text-indigo-700' : progressTextClass(areaAggregate.rate),
              )}>
                {areaAggregate.rate}%
              </span>
            )}
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{areaName}</p>
            {loadingRange ? (
              <span className="h-4 w-8 animate-pulse rounded-full bg-slate-200" />
            ) : rangeOverviewMap ? (
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums', progressTextClass(areaAggregate.rate))}>
                {areaAggregate.rate}%
              </span>
            ) : null}
          </div>
        )}

        <span className="ml-auto rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
          {stores.length}
        </span>
      </div>

      {open && (
        <div className="divide-y divide-slate-100 bg-white">
          {stores.map(store => (
            <StoreProgressCard
              key={store.id}
              store={store}
              active={selectedStoreId === store.id}
              onOpen={() => onToggleStore(store.id)}
              rangeSummary={rangeOverviewMap?.[store.id]}
              loadingRange={loadingRange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AreaGridPanel (daily HO right panel) ────────────────────────────────────

function AreaGridPanel({ areaName, stores, onSelectStore }: {
  areaName: string;
  stores: StoreRow[];
  onSelectStore: (storeId: string) => void;
}) {
  const aggregate = useMemo(() => {
    const sum = stores.reduce(
      (acc, s) => {
        acc.completed   += s.summary.completed;
        acc.total       += s.summary.total;
        acc.inProgress  += s.summary.inProgress;
        acc.pending     += s.summary.pending;
        acc.notStarted  += s.summary.notStarted;
        return acc;
      },
      { completed: 0, total: 0, inProgress: 0, pending: 0, notStarted: 0 },
    );
    return { ...sum, rate: sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0 };
  }, [stores]);

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <ProgressRing pct={aggregate.rate} size={64} stroke={6} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Area Overview</p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-slate-900">{areaName}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{stores.length} toko di area ini</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-600">
              <span className="text-emerald-600">{aggregate.completed} task selesai</span>
              <span className="text-slate-300"> · </span>
              <span className={aggregate.inProgress > 0 ? 'text-indigo-600' : 'text-slate-400'}>{aggregate.inProgress} aktif</span>
              {aggregate.pending > 0 && <><span className="text-slate-300"> · </span><span className="text-amber-600">{aggregate.pending} pending</span></>}
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {stores.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Tidak ada toko di area ini.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stores.map(store => {
              const rate     = store.summary.completionRate;
              const hasIssue = store.summary.pending > 0;
              return (
                <button key={store.id} type="button" onClick={() => onSelectStore(store.id)}
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-indigo-300 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600">
                        <Store className="h-4 w-4" />
                      </div>
                      <p className="truncate text-sm font-bold text-slate-900">{store.name}</p>
                    </div>
                    <ProgressRing pct={rate} size={36} stroke={3} />
                  </div>
                  <p className="truncate text-[11px] text-slate-400">{store.address}</p>
                  <ProgressBar pct={rate} />
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-slate-500">{store.summary.completed}/{store.summary.total} task</span>
                    <div className="flex items-center gap-2">
                      {store.summary.inProgress > 0 && <span className="text-indigo-500">{store.summary.inProgress} aktif</span>}
                      {hasIssue && (
                        <span className="flex items-center gap-0.5 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />{store.summary.pending}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── RangeOverviewPanel (weekly/monthly right panel, no store selected) ────────

function RangeOverviewPanel({ stores, rangeOverviewMap, loading, periodLabel, areaName, onSelectStore }: {
  stores: StoreRow[];
  rangeOverviewMap: Record<string, StoreSummary>;
  loading: boolean;
  periodLabel: string;
  areaName?: string;
  onSelectStore: (storeId: string) => void;
}) {
  const aggregate = useMemo(() => {
    const sum = stores.reduce(
      (acc, s) => {
        const src = rangeOverviewMap[s.id];
        if (!src) return acc;
        acc.completed   += src.completed;
        acc.total       += src.total;
        acc.inProgress  += src.inProgress;
        acc.pending     += src.pending;
        acc.notStarted  += src.notStarted;
        return acc;
      },
      { completed: 0, total: 0, inProgress: 0, pending: 0, notStarted: 0 },
    );
    return { ...sum, rate: sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0 };
  }, [stores, rangeOverviewMap]);

  const sorted = useMemo(
    () => [...stores].sort((a, b) => (rangeOverviewMap[b.id]?.completionRate ?? 0) - (rangeOverviewMap[a.id]?.completionRate ?? 0)),
    [stores, rangeOverviewMap],
  );

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          {loading ? (
            <div className="h-16 w-16 animate-pulse rounded-full bg-slate-100" />
          ) : (
            <ProgressRing pct={aggregate.rate} size={64} stroke={6} />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">{periodLabel}</p>
            <h2 className="mt-0.5 text-lg font-bold text-slate-900">{areaName ?? 'Semua Toko'}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{stores.length} toko</p>
            {!loading && (
              <p className="mt-1.5 text-xs font-semibold text-slate-600">
                <span className="text-emerald-600">{aggregate.completed} task selesai</span>
                <span className="text-slate-300"> · </span>
                <span className={aggregate.inProgress > 0 ? 'text-indigo-600' : 'text-slate-400'}>{aggregate.inProgress} aktif</span>
                {aggregate.pending > 0 && <><span className="text-slate-300"> · </span><span className="text-amber-600">{aggregate.pending} pending</span></>}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
        ) : stores.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Tidak ada toko.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map(store => {
              const summary  = rangeOverviewMap[store.id];
              const rate     = summary?.completionRate ?? 0;
              const hasIssue = (summary?.pending ?? 0) > 0;
              return (
                <button key={store.id} type="button" onClick={() => onSelectStore(store.id)}
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-indigo-300 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600">
                        <Store className="h-4 w-4" />
                      </div>
                      <p className="truncate text-sm font-bold text-slate-900">{store.name}</p>
                    </div>
                    <ProgressRing pct={rate} size={36} stroke={3} />
                  </div>
                  <p className="truncate text-[11px] text-slate-400">{store.address}</p>
                  <ProgressBar pct={rate} />
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    {summary ? (
                      <span className="text-slate-500">{summary.completed}/{summary.total} task</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                    <div className="flex items-center gap-2">
                      {(summary?.inProgress ?? 0) > 0 && <span className="text-indigo-500">{summary!.inProgress} aktif</span>}
                      {hasIssue && (
                        <span className="flex items-center gap-0.5 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />{summary!.pending}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── StoreRangeMatrixPanel ────────────────────────────────────────────────────

function StoreRangeMatrixPanel({ storeName, storeAddress, rows, loading, periodLabel }: {
  storeName: string;
  storeAddress: string;
  rows: DayMatrixRow[];
  loading: boolean;
  periodLabel: string;
}) {
  const aggregate = useMemo(() => {
    const sum = rows.reduce((acc, r) => ({ completed: acc.completed + r.aggregate.completed, total: acc.total + r.aggregate.total }), { completed: 0, total: 0 });
    return { ...sum, rate: sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0 };
  }, [rows]);

  const visibleRows = rows.filter(r => r.aggregate.total > 0);

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <ProgressRing pct={aggregate.rate} size={64} stroke={6} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">{periodLabel}</p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-slate-900">{storeName}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{storeAddress}</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-600">
              <span className="text-emerald-600">{aggregate.completed} task selesai</span>
              <span className="text-slate-300"> dari </span>
              <span className="text-slate-700">{aggregate.total} task</span>
              <span className="text-slate-300"> · </span>
              <span className="text-slate-500">{visibleRows.length} hari ada data</span>
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat data periode…
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Tidak ada task pada periode yang dipilih.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleRows.map(row => {
              const rate = row.aggregate.completionRate;
              return (
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
                        {row.aggregate.completed}/{row.aggregate.total} task selesai
                        {row.aggregate.pending > 0 && <span className="text-amber-600"> · {row.aggregate.pending} pending</span>}
                      </p>
                      <span className={cn('shrink-0 text-sm font-black tabular-nums', progressTextClass(rate))}>{rate}%</span>
                    </div>
                    <ProgressBar pct={rate} className="mt-1.5 h-2" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── StoreDetailPanel (daily) ─────────────────────────────────────────────────

function StoreDetailPanel({ detail, loading, emptyMessage, onSelectTask }: {
  detail: DetailResponse | null;
  loading: boolean;
  emptyMessage?: string;
  onSelectTask?: (taskKey: string) => void;
}) {
  const groupedTasks = useMemo(() => {
    const groups: Record<string, { regular: FlatTask[]; grooming: FlatTask[] }> = {
      morning: { regular: [], grooming: [] }, full_day: { regular: [], grooming: [] },
      evening: { regular: [], grooming: [] }, other: { regular: [], grooming: [] },
    };
    for (const task of detail?.tasks ?? []) {
      const k = task.shift === 'morning' ? 'morning' : task.shift === 'full_day' ? 'full_day' : task.shift === 'evening' ? 'evening' : 'other';
      if (task.type === 'grooming') groups[k].grooming.push(task);
      else groups[k].regular.push(task);
    }
    return groups;
  }, [detail?.tasks]);

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat detail task…
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <ArrowRight className="h-5 w-5" />
          </div>
          <p className="font-semibold text-slate-700">{emptyMessage ?? 'Pilih toko untuk lihat detail'}</p>
          <p className="mt-1 text-xs text-slate-400">Klik salah satu toko di kiri untuk melihat semua task progress-nya.</p>
        </div>
      </div>
    );
  }

  const shiftSections = [
    { key: 'morning',  label: 'Morning Shift' },
    { key: 'full_day', label: 'Full Day Shift' },
    { key: 'evening',  label: 'Evening Shift' },
    { key: 'other',    label: 'Other' },
  ] as const;

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <ProgressRing pct={detail.summary.completionRate} size={64} stroke={6} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{detail.store.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{detail.store.address}</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-600">
              <span className="text-emerald-600">{detail.summary.completed} selesai</span>
              <span className="text-slate-300"> · </span>
              <span className={detail.summary.inProgress > 0 ? 'text-indigo-600' : 'text-slate-400'}>{detail.summary.inProgress} aktif</span>
              {detail.summary.pending > 0 && <><span className="text-slate-300"> · </span><span className="text-amber-600">{detail.summary.pending} pending</span></>}
            </p>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-b border-slate-100 p-4">
        <SummaryBreakdown summary={detail.summary} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {detail.tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Tidak ada task untuk toko ini pada tanggal yang dipilih.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {shiftSections.map(section => {
              const { regular, grooming } = groupedTasks[section.key];
              const totalCount = regular.length + (grooming.length > 0 ? 1 : 0);
              if (totalCount === 0) return null;
              return (
                <div key={section.key} className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">{section.label}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{totalCount} task</span>
                  </div>
                  <div className="space-y-2">
                    {grooming.length > 0 && <GroomingGroupCard tasks={grooming} onSelectEmployee={onSelectTask} />}
                    {regular.map(task => (
                      <TaskRow key={taskKey(task)} task={task} onSelect={() => onSelectTask?.(taskKey(task))} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsTaskProgressPage() {
  const [date, setDate]                       = useState(todayKey());
  const [period, setPeriod]                   = useState<Period>('daily');
  const [search, setSearch]                   = useState('');
  const [overview, setOverview]               = useState<OverviewResponse | null>(null);
  const [detail, setDetail]                   = useState<DetailResponse | null>(null);
  const [rangeData, setRangeData]             = useState<RangeResponse | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId]   = useState<string | null>(null);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail]     = useState(false);
  const [loadingRange, setLoadingRange]       = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  const rangeDays = useMemo((): Date[] => {
    if (period === 'daily') return [];
    const cur = fromKey(date);
    if (period === 'weekly') {
      const start = startOfISOWeek(cur);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const start = startOfMonth(cur);
    const end   = endOfMonth(cur);
    const out: Date[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [period, date]);

  const overviewDate = useMemo(() => {
    if (period === 'daily') return date;
    const today = new Date();
    if (period === 'weekly') {
      const start = startOfISOWeek(fromKey(date));
      const end   = addDays(start, 6);
      return (today >= start && today <= end) ? todayKey() : toKey(start);
    }
    const start = startOfMonth(fromKey(date));
    const end   = endOfMonth(fromKey(date));
    return (today >= start && today <= end) ? todayKey() : toKey(start);
  }, [date, period]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setError(null);
    try {
      const res  = await fetch(`/api/ops/tasks/progress?date=${overviewDate}`, { cache: 'no-store' });
      const json = (await res.json()) as OverviewResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load task progress.');
      setOverview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task progress.');
      setOverview(null);
    } finally {
      setLoadingOverview(false);
    }
  }, [overviewDate]);

  const loadDetail = useCallback(async (storeId: string, forDate: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: forDate, storeId });
      const res    = await fetch(`/api/ops/tasks/progress?${params}`, { cache: 'no-store' });
      const json   = (await res.json()) as DetailResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load store detail.');
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load store detail.');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const loadRangeData = useCallback(async (start: Date, end: Date) => {
    setLoadingRange(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate: toKey(start), endDate: toKey(end) });
      const res    = await fetch(`/api/ops/tasks/progress/range?${params}`, { cache: 'no-store' });
      const json   = (await res.json()) as RangeResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load range data.');
      setRangeData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load range data.');
      setRangeData(null);
    } finally {
      setLoadingRange(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (period === 'daily' || !rangeDays.length) { setRangeData(null); return; }
    void loadRangeData(rangeDays[0], rangeDays[rangeDays.length - 1]);
  }, [period, rangeDays, loadRangeData]);

  useEffect(() => {
    if (period === 'daily') {
      if (selectedStoreId) void loadDetail(selectedStoreId, date);
      else setDetail(null);
    }
  }, [selectedStoreId, date, period, loadDetail]);

  useEffect(() => { setSelectedTaskKey(null); }, [selectedStoreId, date, period]);

  // Derive per-store aggregated StoreSummary from the single range response
  const rangeOverviewMap = useMemo((): Record<string, StoreSummary> => {
    if (!rangeData) return {};
    const map = new Map<string, StoreSummary>();
    for (const row of rangeData.summaries) {
      const existing = map.get(row.storeId) ?? emptySummary();
      existing.notStarted  += row.notStarted;
      existing.inProgress  += row.inProgress;
      existing.completed   += row.completed;
      existing.pending     += row.pending;
      existing.verified    += row.verified ?? 0;
      existing.rejected    += row.rejected ?? 0;
      existing.total       += row.total;
      map.set(row.storeId, existing);
    }
    map.forEach(s => { s.completionRate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0; });
    return Object.fromEntries(map);
  }, [rangeData]);

  // Derive per-day matrix rows for the selected store
  const rangeMatrixRows = useMemo((): DayMatrixRow[] => {
    if (!selectedStoreId || !rangeData || !rangeDays.length) return [];
    const today = new Date();
    return rangeDays.map(d => {
      const dateKey = toKey(d);
      const row     = rangeData.summaries.find(s => s.storeId === selectedStoreId && s.date === dateKey);
      const completed   = row?.completed   ?? 0;
      const total       = row?.total       ?? 0;
      const inProgress  = row?.inProgress  ?? 0;
      const notStarted  = row?.notStarted  ?? 0;
      const pending     = row?.pending     ?? 0;
      const verified    = row?.verified    ?? 0;
      const rejected    = row?.rejected    ?? 0;
      return {
        date: dateKey,
        weekdayLabel: ID_WEEKDAY_SHORT[d.getDay()],
        dayLabel: String(d.getDate()),
        isToday: isSameDay(d, today),
        aggregate: {
          completed, total, inProgress, notStarted, pending,
          verified, rejected,
          completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        },
      };
    });
  }, [rangeData, selectedStoreId, rangeDays]);

  const isHo = overview?.scope === 'all_areas';

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overview?.stores ?? [];
    return (overview?.stores ?? []).filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
  }, [overview?.stores, search]);

  const groupedStores = useMemo(() => {
    const groups = new Map<string, { areaId: string; stores: StoreRow[] }>();
    for (const store of filteredStores) {
      const areaName = store.areaName?.trim() || overview?.area?.name || 'Tanpa Area';
      const areaId   = (store.areaId ?? overview?.area?.id ?? 'no-area') + '';
      const cur      = groups.get(areaName);
      if (cur) cur.stores.push(store);
      else groups.set(areaName, { areaId, stores: [store] });
    }
    return Array.from(groups.entries())
      .map(([areaName, g]) => ({ areaName, areaId: g.areaId, stores: g.stores.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.areaName.localeCompare(b.areaName));
  }, [filteredStores, overview?.area?.id, overview?.area?.name]);

  const handleSelectArea  = (areaId: string) => { setSelectedAreaId(cur => cur === areaId ? null : areaId); setSelectedStoreId(null); };
  const handleSelectStore = (storeId: string) => { setSelectedStoreId(cur => cur === storeId ? null : storeId); };

  const selectedAreaGroup = useMemo(() => groupedStores.find(g => g.areaId === selectedAreaId) ?? null, [groupedStores, selectedAreaId]);

  const headingScope = isHo ? 'All Areas' : (overview?.area?.name ?? 'Area');

  const headingRangeLabel = useMemo(() => {
    if (period === 'daily') return fmtDateLabel(date);
    if (period === 'weekly') {
      const start = startOfISOWeek(fromKey(date));
      const end   = addDays(start, 6);
      return `${start.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
    return fmtMonthLabel(fromKey(date));
  }, [period, date]);

  const rangePeriodLabel = period === 'weekly' ? 'Tinjauan Mingguan' : 'Tinjauan Bulanan';

  const renderRightPanel = () => {
    if (selectedStoreId) {
      if (period === 'daily') {
        const selectedTask = selectedTaskKey ? (detail?.tasks.find(t => taskKey(t) === selectedTaskKey) ?? null) : null;
        if (selectedTask) return <TaskDetailView task={selectedTask} onBack={() => setSelectedTaskKey(null)} />;
        return <StoreDetailPanel detail={detail} loading={loadingDetail} onSelectTask={setSelectedTaskKey} />;
      }
      const selectedStore = overview?.stores.find(s => s.id === selectedStoreId);
      return (
        <StoreRangeMatrixPanel
          storeName={selectedStore?.name ?? '—'}
          storeAddress={selectedStore?.address ?? ''}
          rows={rangeMatrixRows}
          loading={loadingRange}
          periodLabel={rangePeriodLabel}
        />
      );
    }

    if (period !== 'daily') {
      const panelStores = isHo && selectedAreaGroup ? selectedAreaGroup.stores : filteredStores;
      return (
        <RangeOverviewPanel
          stores={panelStores}
          rangeOverviewMap={rangeOverviewMap}
          loading={loadingRange}
          periodLabel={rangePeriodLabel}
          areaName={isHo && selectedAreaGroup ? selectedAreaGroup.areaName : undefined}
          onSelectStore={handleSelectStore}
        />
      );
    }

    if (isHo && selectedAreaGroup) {
      return <AreaGridPanel areaName={selectedAreaGroup.areaName} stores={selectedAreaGroup.stores} onSelectStore={handleSelectStore} />;
    }

    return (
      <StoreDetailPanel
        detail={null}
        loading={false}
        emptyMessage={isHo ? 'Pilih area atau toko untuk lihat detail' : 'Pilih toko untuk lihat detail'}
      />
    );
  };

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Task Monitor"
        title="Task Progress"
        subtitle={`${headingScope} · ${headingRangeLabel}`}
        periodProps={{ period, onPeriodChange: setPeriod, date, onDateChange: setDate }}
        onRefresh={() => {
          void loadOverview();
          if (period === 'daily' && selectedStoreId) void loadDetail(selectedStoreId, date);
          if (period !== 'daily' && rangeDays.length) void loadRangeData(rangeDays[0], rangeDays[rangeDays.length - 1]);
        }}
        refreshing={loadingOverview || loadingDetail || loadingRange}
      />

      <div className="mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-bold">Gagal memuat data</p>
              <p className="mt-0.5 text-xs">{error}</p>
            </div>
          </div>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
          <aside className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-[6.5rem]">
            <div className="shrink-0 border-b border-slate-100 p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari toko…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            </div>

            <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{filteredStores.length} toko</p>
              <div className="ml-auto flex items-center gap-2.5 text-[10px] font-semibold text-slate-400">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-300" />Belum mulai</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />Aktif</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />Selesai</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingOverview
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="border-b border-slate-100 px-4 py-3">
                      <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                    </div>
                  ))
                : filteredStores.length === 0
                  ? (
                    <div className="p-8 text-center">
                      <p className="text-sm font-semibold text-slate-700">Tidak ada toko</p>
                      <p className="mt-1 text-xs text-slate-400">Coba ubah tanggal atau kata kunci pencarian.</p>
                    </div>
                  )
                  : groupedStores.map(group => (
                      <AreaStoreGroup
                        key={group.areaId}
                        areaName={group.areaName}
                        areaId={group.areaId}
                        stores={group.stores}
                        selectedStoreId={selectedStoreId}
                        selectedAreaId={selectedAreaId}
                        isHo={isHo}
                        initiallyOpen={!isHo}
                        onToggleStore={handleSelectStore}
                        onSelectArea={isHo ? handleSelectArea : undefined}
                        rangeOverviewMap={period !== 'daily' ? rangeOverviewMap : undefined}
                        loadingRange={period !== 'daily' ? loadingRange : undefined}
                      />
                    ))
              }
            </div>
          </aside>

          <div className="lg:sticky lg:top-[6.5rem]">
            {renderRightPanel()}
          </div>
        </div>
      </div>
    </div>
  );
}
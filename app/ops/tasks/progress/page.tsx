'use client';
// app/ops/tasks/progress/page.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  History,
  LayoutGrid,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Store,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
  pending: number;
  inProgress: number;
  completed: number;
  discrepancy: number;
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
  store: {
    id: string;
    name: string;
    address: string;
    areaId?: string | null;
  };
  summary: StoreSummary;
  tasks: FlatTask[];
};

type Period = 'daily' | 'weekly' | 'monthly';

// One day's roll-up used by the weekly/monthly view.
type DayMatrixRow = {
  date: string;            // YYYY-MM-DD
  weekdayLabel: string;    // Sen, Sel, …
  dayLabel: string;        // 25
  isToday: boolean;
  aggregate: StoreSummary;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ID_WEEKDAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

// ─── Task identity ────────────────────────────────────────────────────────────
//
// IMPORTANT: every task type is a separate DB table with its own auto-increment
// id, so `task.id` is NOT unique across types (a cek_bin row and a store_front
// row can both be id "3"). Always identify a task by `type-id`, otherwise a
// lookup by id alone returns the wrong row (usually whichever sorts first).

function taskKey(t: Pick<FlatTask, 'type' | 'id'>): string {
  return `${t.type}-${t.id}`;
}

// ─── Date helpers (local-time, ISO-style YYYY-MM-DD keys) ────────────────────

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function todayKey() {
  return toKey(new Date());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// Mon-Sun ISO week. Monday = start.
function startOfISOWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();                 // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // back to Monday
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function fmtDateLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function fmtMonthLabel(date: Date) {
  return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

/** 0% = amber, in-progress = indigo, 100% = green */
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

// ─── Shared mini-atoms ────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 52, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
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
      <div className={cn('h-full rounded-full transition-all duration-500', progressBarClass(pct))}
        style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Selectable TaskRow (opens detail in the right panel) ─────────────────────

function TaskRow({ task, onSelect }: { task: FlatTask; onSelect: () => void }) {
  const label    = TASK_LABELS[task.type] ?? task.type.replaceAll('_', ' ');
  const status   = task.status ?? 'pending';
  const TaskIcon = TASK_ICONS[task.type] ?? ClipboardList;

  const accentClass =
    status === 'completed'   ? 'bg-emerald-500' :
    status === 'in_progress' ? 'bg-indigo-500' :
    status === 'discrepancy' ? 'bg-amber-400 animate-pulse' :
    'bg-amber-300';

  const iconBg =
    status === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    status === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    status === 'discrepancy' ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  return (
    <button
      type="button"
      onClick={onSelect}
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
                  <History className="h-2.5 w-2.5" />
                  Lanjutan
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

// ─── Grooming group card (employees open in the right panel) ──────────────────

function GroomingGroupCard({
  tasks,
  onSelectEmployee,
}: {
  tasks: FlatTask[];
  onSelectEmployee?: (taskKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const totalEmployees = tasks.length;
  const doneEmployees  = tasks.filter(t => t.status === 'completed').length;
  const activeCount    = tasks.filter(t => t.status === 'in_progress').length;
  const issueCount     = tasks.filter(t => t.status === 'discrepancy').length;

  const aggregateStatus: TaskStatus =
    doneEmployees === totalEmployees ? 'completed'
    : activeCount > 0 ? 'in_progress'
    : issueCount > 0 ? 'discrepancy'
    : 'pending';

  const accentClass =
    aggregateStatus === 'completed'   ? 'bg-emerald-500' :
    aggregateStatus === 'in_progress' ? 'bg-indigo-500' :
    aggregateStatus === 'discrepancy' ? 'bg-amber-400 animate-pulse' :
    'bg-amber-300';

  const iconBg =
    aggregateStatus === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    aggregateStatus === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    aggregateStatus === 'discrepancy' ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
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
                {issueCount > 0 && <span className="text-amber-600">{issueCount} discrepancy</span>}
              </span>
            </div>
          </div>
          <ProgressBar
            pct={totalEmployees > 0 ? Math.round((doneEmployees / totalEmployees) * 100) : 0}
            className="mt-2"
          />
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-3">
          <div className="space-y-2">
            {tasks.map(task => {
              const empStatus = task.status ?? 'pending';
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onSelectEmployee?.(taskKey(task))}
                  className="flex w-full items-center gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:bg-slate-50"
                >
                  <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                    empStatus === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
                    empStatus === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
                    empStatus === 'discrepancy' ? 'bg-amber-50 text-amber-600' :
                    'bg-amber-50 text-amber-500'
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
    { label: 'Pending',     value: summary.pending,     cls: 'text-amber-500'   },
    { label: 'Discrepancy', value: summary.discrepancy, cls: 'text-amber-600'   },
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

// ─── Store list card ──────────────────────────────────────────────────────────

function StoreProgressCard({ store, active, onOpen }: {
  store: StoreRow; active: boolean; onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50',
        active ? 'bg-indigo-50' : '')}
    >
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>
        <Store className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{store.name}</p>
        </div>
      </div>
      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
    </button>
  );
}

// ─── Area group with store list ───────────────────────────────────────────────

function AreaStoreGroup({
  areaName,
  areaId,
  stores,
  selectedStoreId,
  selectedAreaId,
  isHo,
  initiallyOpen,
  onToggleStore,
  onSelectArea,
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
}) {
  const [open, setOpen] = useState(initiallyOpen);

  const areaAggregate = useMemo(() => {
    const sum = stores.reduce(
      (acc, s) => {
        acc.completed += s.summary.completed;
        acc.total     += s.summary.total;
        acc.pending   += s.summary.pending;
        acc.inProgress += s.summary.inProgress;
        acc.discrepancy += s.summary.discrepancy;
        return acc;
      },
      { completed: 0, total: 0, pending: 0, inProgress: 0, discrepancy: 0 },
    );
    const rate = sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0;
    return { ...sum, rate };
  }, [stores]);

  const isAreaActive = selectedAreaId === areaId;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      {/* Area header */}
      <div
        className={cn(
          'flex w-full items-center gap-2 bg-slate-50 px-4 py-2 transition',
          isAreaActive && isHo && 'bg-indigo-50',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-slate-200"
          aria-label={open ? 'Collapse area' : 'Expand area'}
        >
          <ChevronDown className={cn(
            'h-3.5 w-3.5 text-slate-400 transition-transform',
            !open && '-rotate-90',
          )} />
        </button>

        {isHo && onSelectArea ? (
          <button
            type="button"
            onClick={() => onSelectArea(areaId)}
            className={cn(
              'flex flex-1 items-center gap-2 text-left transition',
              isAreaActive ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <MapPin className={cn('h-3 w-3', isAreaActive ? 'text-indigo-500' : 'text-slate-400')} />
            <p className="text-[11px] font-bold uppercase tracking-widest">
              {areaName}
            </p>
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
              isAreaActive
                ? 'bg-indigo-200 text-indigo-700'
                : progressTextClass(areaAggregate.rate),
            )}>
              {areaAggregate.rate}%
            </span>
          </button>
        ) : (
          <p className="flex-1 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            {areaName}
          </p>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Area grid panel (OPS HO, right side) ─────────────────────────────────────

function AreaGridPanel({
  areaName,
  stores,
  onSelectStore,
}: {
  areaName: string;
  stores: StoreRow[];
  onSelectStore: (storeId: string) => void;
}) {
  const aggregate = useMemo(() => {
    const sum = stores.reduce(
      (acc, s) => {
        acc.completed += s.summary.completed;
        acc.total     += s.summary.total;
        acc.inProgress += s.summary.inProgress;
        acc.discrepancy += s.summary.discrepancy;
        acc.pending   += s.summary.pending;
        return acc;
      },
      { completed: 0, total: 0, inProgress: 0, discrepancy: 0, pending: 0 },
    );
    const rate = sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0;
    return { ...sum, rate };
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
              <span className={aggregate.inProgress > 0 ? 'text-indigo-600' : 'text-slate-400'}>
                {aggregate.inProgress} aktif
              </span>
              {aggregate.discrepancy > 0 && (
                <><span className="text-slate-300"> · </span><span className="text-amber-600">{aggregate.discrepancy} discrepancy</span></>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {stores.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Tidak ada toko di area ini.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stores.map(store => {
              const rate = store.summary.completionRate;
              const hasIssue = store.summary.discrepancy > 0;
              return (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => onSelectStore(store.id)}
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-indigo-300 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
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
                    <span className="text-slate-500">
                      {store.summary.completed}/{store.summary.total} task
                    </span>
                    <div className="flex items-center gap-2">
                      {store.summary.inProgress > 0 && (
                        <span className="text-indigo-500">{store.summary.inProgress} aktif</span>
                      )}
                      {hasIssue && (
                        <span className="flex items-center gap-0.5 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />
                          {store.summary.discrepancy}
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

// ─── Range matrix panel (weekly/monthly) ──────────────────────────────────────

function StoreRangeMatrixPanel({
  storeName,
  storeAddress,
  rows,
  loading,
  periodLabel,
}: {
  storeName: string;
  storeAddress: string;
  rows: DayMatrixRow[];
  loading: boolean;
  periodLabel: string;
}) {
  const aggregate = useMemo(() => {
    const sum = rows.reduce(
      (acc, r) => {
        acc.completed += r.aggregate.completed;
        acc.total += r.aggregate.total;
        return acc;
      },
      { completed: 0, total: 0 },
    );
    const rate = sum.total > 0 ? Math.round((sum.completed / sum.total) * 100) : 0;
    return { ...sum, rate };
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
          <div className="p-8 text-center text-sm text-slate-400">
            Tidak ada task pada periode yang dipilih.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleRows.map(row => {
              const rate = row.aggregate.completionRate;
              return (
                <div
                  key={row.date}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 transition',
                    row.isToday && 'bg-indigo-50/40',
                  )}
                >
                  <div className={cn(
                    'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl',
                    row.isToday ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600',
                  )}>
                    <span className="text-[9px] font-bold uppercase leading-none">
                      {row.weekdayLabel}
                    </span>
                    <span className="mt-0.5 text-base font-black leading-none">
                      {row.dayLabel}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-500">
                        {row.aggregate.completed}/{row.aggregate.total} task selesai
                        {row.aggregate.discrepancy > 0 && (
                          <span className="text-amber-600"> · {row.aggregate.discrepancy} discrepancy</span>
                        )}
                      </p>
                      <span className={cn(
                        'shrink-0 text-sm font-black tabular-nums',
                        progressTextClass(rate),
                      )}>
                        {rate}%
                      </span>
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

// ─── Store detail panel (daily mode) ──────────────────────────────────────────

function StoreDetailPanel({ detail, loading, emptyMessage, onSelectTask }: {
  detail: DetailResponse | null;
  loading: boolean;
  emptyMessage?: string;
  onSelectTask?: (taskKey: string) => void;
}) {
  const groupedTasks = useMemo(() => {
    const groups: Record<string, { regular: FlatTask[]; grooming: FlatTask[] }> = {
      morning:  { regular: [], grooming: [] },
      full_day: { regular: [], grooming: [] },
      evening:  { regular: [], grooming: [] },
      other:    { regular: [], grooming: [] },
    };
    for (const task of detail?.tasks ?? []) {
      const shiftKey: 'morning' | 'full_day' | 'evening' | 'other' =
        task.shift === 'morning'  ? 'morning'  :
        task.shift === 'full_day' ? 'full_day' :
        task.shift === 'evening'  ? 'evening'  :
        'other';
      if (task.type === 'grooming') {
        groups[shiftKey].grooming.push(task);
      } else {
        groups[shiftKey].regular.push(task);
      }
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

  const rate = detail.summary.completionRate;
  const shiftSections = [
    { key: 'morning',  label: 'Morning Shift' },
    { key: 'full_day', label: 'Full Day Shift' },
    { key: 'evening',  label: 'Evening Shift' },
    { key: 'other',    label: 'Other' },
  ] as const;

  const hasAnyTasks = detail.tasks.length > 0;

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <ProgressRing pct={rate} size={64} stroke={6} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{detail.store.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{detail.store.address}</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-600">
              <span className="text-emerald-600">{detail.summary.completed} selesai</span>
              <span className="text-slate-300"> · </span>
              <span className={detail.summary.inProgress > 0 ? 'text-indigo-600' : 'text-slate-400'}>
                {detail.summary.inProgress} aktif
              </span>
              {detail.summary.discrepancy > 0 && (
                <><span className="text-slate-300"> · </span><span className="text-amber-600">{detail.summary.discrepancy} discrepancy</span></>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-100 p-4">
        <SummaryBreakdown summary={detail.summary} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {!hasAnyTasks ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Tidak ada task untuk toko ini pada tanggal yang dipilih.
          </div>
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
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {totalCount} task
                    </span>
                  </div>
                  <div className="space-y-2">
                    {grooming.length > 0 && (
                      <GroomingGroupCard tasks={grooming} onSelectEmployee={onSelectTask} />
                    )}
                    {regular.map(task => (
                      <TaskRow
                        key={taskKey(task)}
                        task={task}
                        onSelect={() => onSelectTask?.(taskKey(task))}
                      />
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

// ─── Period selector & navigator (header chips) ───────────────────────────────

function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const tabs: { id: Period; label: string; icon: React.ElementType }[] = [
    { id: 'daily',   label: 'Harian',    icon: CalendarDays },
    { id: 'weekly',  label: 'Mingguan',  icon: CalendarRange },
    { id: 'monthly', label: 'Bulanan',   icon: LayoutGrid },
  ];

  return (
    <div className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5">
      {tabs.map(tab => {
        const active = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition',
              active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function RangeNavigator({
  period,
  date,
  setDate,
}: {
  period: Period;
  date: string;
  setDate: (k: string) => void;
}) {
  const cur = fromKey(date);

  const label = useMemo(() => {
    if (period === 'daily') {
      return cur.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    }
    if (period === 'weekly') {
      const start = startOfISOWeek(cur);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const s = start.toLocaleDateString('id-ID', { day: '2-digit', month: sameMonth ? undefined : 'short' });
      const e = end.toLocaleDateString('id-ID',   { day: '2-digit', month: 'short', year: 'numeric' });
      return `${s} – ${e}`;
    }
    return fmtMonthLabel(cur);
  }, [period, cur]);

  const goPrev = () => {
    if (period === 'daily')   setDate(toKey(addDays(cur, -1)));
    if (period === 'weekly')  setDate(toKey(addDays(cur, -7)));
    if (period === 'monthly') setDate(toKey(new Date(cur.getFullYear(), cur.getMonth() - 1, 1)));
  };

  const goNext = () => {
    if (period === 'daily')   setDate(toKey(addDays(cur, 1)));
    if (period === 'weekly')  setDate(toKey(addDays(cur, 7)));
    if (period === 'monthly') setDate(toKey(new Date(cur.getFullYear(), cur.getMonth() + 1, 1)));
  };

  const goToday = () => setDate(todayKey());

  return (
    <div className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={goPrev}
        className="flex h-full w-9 items-center justify-center rounded-l-xl text-slate-500 transition hover:bg-slate-50"
        aria-label="Previous"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-2 border-x border-slate-200 px-3">
        <CalendarDays className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-bold text-slate-700">{label}</span>
        <button
          type="button"
          onClick={goToday}
          className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 transition hover:bg-slate-200"
        >
          Hari ini
        </button>
      </div>
      <button
        type="button"
        onClick={goNext}
        className="flex h-full w-9 items-center justify-center rounded-r-xl text-slate-500 transition hover:bg-slate-50"
        aria-label="Next"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Build matrix from per-day detail responses ───────────────────────────────

function buildMatrixRows(
  perDay: Record<string, DetailResponse | null>,
  daysInRange: Date[],
): DayMatrixRow[] {
  const today = new Date();
  return daysInRange.map(d => {
    const key = toKey(d);
    const detail = perDay[key];

    let completed = 0;
    let total = 0;
    let inProgress = 0;
    let pending = 0;
    let discrepancy = 0;

    if (detail) {
      for (const t of detail.tasks ?? []) {
        total += 1;
        switch (t.status) {
          case 'completed':   completed += 1;   break;
          case 'in_progress': inProgress += 1;  break;
          case 'pending':     pending += 1;     break;
          case 'discrepancy': discrepancy += 1; break;
        }
      }
    }

    return {
      date: key,
      weekdayLabel: ID_WEEKDAY_SHORT[d.getDay()],
      dayLabel: String(d.getDate()),
      isToday: isSameDay(d, today),
      aggregate: {
        pending, inProgress, completed, discrepancy,
        verified: 0, rejected: 0,
        total,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    };
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsTaskProgressPage() {
  const [date, setDate]                           = useState(todayKey());
  const [period, setPeriod]                       = useState<Period>('daily');
  const [search, setSearch]                       = useState('');
  const [overview, setOverview]                   = useState<OverviewResponse | null>(null);
  const [detail, setDetail]                       = useState<DetailResponse | null>(null);
  const [selectedStoreId, setSelectedStoreId]     = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId]       = useState<string | null>(null);
  // Stored as the composite `type-id` key (see taskKey), NOT the bare row id.
  const [selectedTaskKey, setSelectedTaskKey]     = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview]     = useState(true);
  const [loadingDetail, setLoadingDetail]         = useState(false);
  const [loadingRange, setLoadingRange]           = useState(false);
  const [error, setError]                         = useState<string | null>(null);

  const [rangeMatrixRows, setRangeMatrixRows] = useState<DayMatrixRow[]>([]);

  const overviewDate = useMemo(() => {
    if (period === 'daily') return date;
    const cur = fromKey(date);
    const today = new Date();
    if (period === 'weekly') {
      const start = startOfISOWeek(cur);
      const end = addDays(start, 6);
      if (today >= start && today <= end) return todayKey();
      return toKey(start);
    }
    const start = startOfMonth(cur);
    const end = endOfMonth(cur);
    if (today >= start && today <= end) return todayKey();
    return toKey(start);
  }, [date, period]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true); setError(null);
    try {
      const res  = await fetch(`/api/ops/tasks/progress?date=${overviewDate}`, { cache: 'no-store' });
      const json = (await res.json()) as OverviewResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load task progress.');
      setOverview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task progress.');
      setOverview(null);
    } finally { setLoadingOverview(false); }
  }, [overviewDate]);

  const loadDetail = useCallback(async (storeId: string, forDate: string) => {
    setLoadingDetail(true); setError(null);
    try {
      const params = new URLSearchParams({ date: forDate, storeId });
      const res  = await fetch(`/api/ops/tasks/progress?${params}`, { cache: 'no-store' });
      const json = (await res.json()) as DetailResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load store detail.');
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load store detail.');
      setDetail(null);
    } finally { setLoadingDetail(false); }
  }, []);

  const loadRangeMatrix = useCallback(async (storeId: string, days: Date[]) => {
    setLoadingRange(true); setError(null);
    try {
      const settled = await Promise.all(
        days.map(async (d) => {
          const key = toKey(d);
          const params = new URLSearchParams({ date: key, storeId });
          const res = await fetch(`/api/ops/tasks/progress?${params}`, { cache: 'no-store' });
          const json = (await res.json()) as DetailResponse;
          if (!res.ok || !json.success) {
            return [key, null] as const;
          }
          return [key, json] as const;
        }),
      );
      const perDay: Record<string, DetailResponse | null> = {};
      for (const [k, v] of settled) perDay[k] = v;
      setRangeMatrixRows(buildMatrixRows(perDay, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load range data.');
      setRangeMatrixRows([]);
    } finally {
      setLoadingRange(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const rangeDays: Date[] = useMemo(() => {
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

  useEffect(() => {
    if (!selectedStoreId) {
      setDetail(null);
      setRangeMatrixRows([]);
      return;
    }
    if (period === 'daily') {
      void loadDetail(selectedStoreId, date);
    } else {
      void loadRangeMatrix(selectedStoreId, rangeDays);
    }
  }, [selectedStoreId, period, date, rangeDays, loadDetail, loadRangeMatrix]);

  // Whenever the store / date / period context changes, drop the open task so
  // the right panel falls back to the task list instead of a stale detail.
  useEffect(() => {
    setSelectedTaskKey(null);
  }, [selectedStoreId, date, period]);

  const isHo = overview?.scope === 'all_areas';

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overview?.stores ?? [];
    return (overview?.stores ?? []).filter(
      s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q),
    );
  }, [overview?.stores, search]);

  const groupedStores = useMemo(() => {
    const groups = new Map<string, { areaId: string; stores: StoreRow[] }>();
    for (const store of filteredStores) {
      const areaName =
        store.areaName?.trim() ||
        overview?.area?.name ||
        'Tanpa Area';
      const areaId = (store.areaId ?? overview?.area?.id ?? 'no-area') + '';
      const current = groups.get(areaName);
      if (current) current.stores.push(store);
      else groups.set(areaName, { areaId, stores: [store] });
    }
    return Array.from(groups.entries())
      .map(([areaName, g]) => ({
        areaName,
        areaId: g.areaId,
        stores: g.stores.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.areaName.localeCompare(b.areaName));
  }, [filteredStores, overview?.area?.id, overview?.area?.name]);

  const handleSelectArea = (areaId: string) => {
    setSelectedAreaId(cur => cur === areaId ? null : areaId);
    setSelectedStoreId(null);
  };

  const handleSelectStore = (storeId: string) => {
    setSelectedStoreId(cur => cur === storeId ? null : storeId);
  };

  const selectedAreaGroup = useMemo(
    () => groupedStores.find(g => g.areaId === selectedAreaId) ?? null,
    [groupedStores, selectedAreaId],
  );

  useEffect(() => {
    if (period !== 'daily') setSelectedAreaId(null);
  }, [period]);

  const headingScope = isHo
    ? 'All Areas'
    : (overview?.area?.name ?? 'Area');

  const headingRangeLabel = useMemo(() => {
    if (period === 'daily') return fmtDateLabel(date);
    if (period === 'weekly') {
      const start = startOfISOWeek(fromKey(date));
      const end = addDays(start, 6);
      return `${start.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
    return fmtMonthLabel(fromKey(date));
  }, [period, date]);

  // ── Right-panel routing ──────────────────────────────────────────────────
  const renderRightPanel = () => {
    if (selectedStoreId) {
      if (period === 'daily') {
        // Resolve by composite key so the correct task type is opened.
        const selectedTask = selectedTaskKey
          ? detail?.tasks.find(t => taskKey(t) === selectedTaskKey) ?? null
          : null;

        if (selectedTask) {
          return (
            <TaskDetailView
              task={selectedTask}
              onBack={() => setSelectedTaskKey(null)}
            />
          );
        }

        return (
          <StoreDetailPanel
            detail={detail}
            loading={loadingDetail}
            onSelectTask={setSelectedTaskKey}
          />
        );
      }

      const selectedStore = overview?.stores.find(s => s.id === selectedStoreId);
      return (
        <StoreRangeMatrixPanel
          storeName={selectedStore?.name ?? '—'}
          storeAddress={selectedStore?.address ?? ''}
          rows={rangeMatrixRows}
          loading={loadingRange}
          periodLabel={period === 'weekly' ? 'Tinjauan Mingguan' : 'Tinjauan Bulanan'}
        />
      );
    }

    if (isHo && selectedAreaGroup && period === 'daily') {
      return (
        <AreaGridPanel
          areaName={selectedAreaGroup.areaName}
          stores={selectedAreaGroup.stores}
          onSelectStore={handleSelectStore}
        />
      );
    }

    return (
      <StoreDetailPanel
        detail={null}
        loading={false}
        emptyMessage={
          isHo
            ? 'Pilih area atau toko untuk lihat detail'
            : 'Pilih toko untuk lihat detail'
        }
      />
    );
  };

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ── */}
      <div className="sticky top-0 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Ops · Task Monitor</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Task Progress</h1>
              <p className="mt-1 text-sm text-slate-500">{headingScope} · {headingRangeLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PeriodTabs value={period} onChange={(p) => { setPeriod(p); }} />
              <RangeNavigator period={period} date={date} setDate={(k) => { setDate(k); }} />
              <button type="button"
                onClick={() => {
                  void loadOverview();
                  if (selectedStoreId) {
                    if (period === 'daily') void loadDetail(selectedStoreId, date);
                    else void loadRangeMatrix(selectedStoreId, rangeDays);
                  }
                }}
                disabled={loadingOverview || loadingDetail || loadingRange}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-4 w-4', (loadingOverview || loadingDetail || loadingRange) && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

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
          {/* ── Store list ── */}
          <aside className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-[6.5rem]">
            <div className="shrink-0 border-b border-slate-100 p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Cari toko…"
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
                      <p className="mt-1 text-xs text-slate-400">
                        Coba ubah tanggal atau kata kunci pencarian.
                      </p>
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
                      />
                    ))
              }
            </div>
          </aside>

          {/* ── Right panel ── */}
          <div className="lg:sticky lg:top-[6.5rem]">
            {renderRightPanel()}
          </div>
        </div>
      </div>
    </main>
  );
}
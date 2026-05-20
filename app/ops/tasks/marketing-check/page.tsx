'use client';

// app/ops/tasks/marketing-check/page.tsx

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';
type HealthFilter = 'all' | 'done' | 'pending' | 'issues';
type SortKey = 'name' | 'progress_low' | 'progress_high' | 'most_pending';

interface UserInfo {
  id: string;
  name: string | null;
  nik?: string | null;
}

interface AvailableStore {
  id: string;
  name: string;
  areaId: number | null;
}

interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  checkedBy: UserInfo | null;
  checkedAt: string | null;
}

interface MarketingCheckTask {
  id: string;
  scheduleId: string;
  date: string | null;
  status: string;
  notes: string | null;
  completedAt: string | null;
  progress: number;
  completedFields: number;
  totalFields: number;
  checklist: ChecklistItem[];
  assignedUser: UserInfo | null;
  employee: UserInfo | null;
  completedBy: UserInfo | null;
  notesBy: UserInfo | null;
  notesAt: string | null;
}

interface StoreGroup {
  storeId: string;
  storeName: string;
  areaId: number | null;
  total: number;
  completed: number;
  averageProgress: number;
  tasks: MarketingCheckTask[];
}

interface Summary {
  stores: number;
  totalTasks: number;
  completedTasks: number;
  averageProgress: number;
}

interface ApiResponse {
  success: boolean;
  error?: string;
  period: Period;
  date: string;
  selectedStoreId?: string;
  availableStores?: AvailableStore[];
  summary: Summary;
  stores: StoreGroup[];
}

interface SortOption {
  value: SortKey;
  label: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PERIODS: Period[] = ['daily', 'weekly', 'monthly'];

const HEALTH_CHIPS: {
  label: string;
  value: HealthFilter;
  activeClass: string;
  inactiveClass: string;
}[] = [
  {
    label: 'Semua',
    value: 'all',
    activeClass: 'bg-indigo-600 text-white border-indigo-600',
    inactiveClass: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200',
  },
  {
    label: 'Selesai',
    value: 'done',
    activeClass: 'bg-indigo-500 text-white border-indigo-500',
    inactiveClass: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-100',
  },
  {
    label: 'Pending',
    value: 'pending',
    activeClass: 'bg-amber-500 text-white border-amber-500',
    inactiveClass: 'bg-white text-slate-600 border-slate-200 hover:border-amber-200',
  },
  {
    label: 'Masalah',
    value: 'issues',
    activeClass: 'bg-indigo-300 text-white border-indigo-300',
    inactiveClass: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-100',
  },
];

const SORT_OPTIONS: SortOption[] = [
  { value: 'most_pending', label: 'Paling banyak pending' },
  { value: 'progress_low', label: 'Progress terendah' },
  { value: 'progress_high', label: 'Progress tertinggi' },
  { value: 'name', label: 'Nama (A→Z)' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function userLabel(user: UserInfo | null): string {
  if (!user) return '-';
  return user.name || (user.nik ? `NIK ${user.nik}` : `User ${user.id}`);
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function progressTextClass(pct: number): string {
  if (pct >= 80) return 'text-indigo-600';
  if (pct >= 40) return 'text-amber-600';
  return 'text-indigo-400';
}

function progressBarColor(pct: number): string {
  if (pct >= 80) return 'bg-indigo-600';
  if (pct >= 40) return 'bg-amber-500';
  return 'bg-indigo-300';
}

function statusStyle(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'in_progress':
      return 'bg-indigo-50 text-indigo-600 border-indigo-100';
    case 'discrepancy':
      return 'bg-amber-50 text-amber-800 border-amber-300';
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
}

function healthOf(store: StoreGroup): HealthFilter {
  if (store.total === 0) return 'pending';
  if (store.tasks.some((t) => t.status === 'discrepancy')) return 'issues';
  if (store.completed < store.total) return 'pending';
  return 'done';
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function Toolbar({
  period,
  setPeriod,
  date,
  setDate,
  storeId,
  setStoreId,
  search,
  setSearch,
  stores,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
  date: string;
  setDate: (d: string) => void;
  storeId: string;
  setStoreId: (id: string) => void;
  search: string;
  setSearch: (s: string) => void;
  stores: AvailableStore[];
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[260px_180px_220px_1fr]">
      {/* Period toggle */}
      <div className="flex rounded-xl bg-slate-100 p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-xs font-bold capitalize transition',
              period === p
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Date picker */}
      <label className="relative block">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </label>

      {/* Store selector */}
      <select
        value={storeId}
        onChange={(e) => setStoreId(e.target.value)}
        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <option value="all">Semua toko</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {/* Search */}
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari toko, karyawan, atau checklist…"
          className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </label>
    </div>
  );
}

function EmphasisTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-indigo-900 bg-indigo-950 p-4 text-white shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="mt-1 text-[11px] text-indigo-200">{helper}</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  helper,
  accent,
}: {
  label: string;
  value: string | number;
  helper: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
      </div>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{helper}</p>
    </div>
  );
}

function FilterSortBar({
  health,
  onHealth,
  healthCounts,
  sort,
  onSort,
}: {
  health: HealthFilter;
  onHealth: (h: HealthFilter) => void;
  healthCounts: Record<HealthFilter, number>;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      {/* Health filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {HEALTH_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => onHealth(chip.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition',
              health === chip.value ? chip.activeClass : chip.inactiveClass,
            )}
          >
            {chip.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-[10px] font-bold',
                health === chip.value ? 'bg-white/20' : 'bg-slate-100 text-slate-600',
              )}
            >
              {healthCounts[chip.value]}
            </span>
          </button>
        ))}
      </div>

      {/* Sort dropdown */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Urutkan</span>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
      <div className="h-[360px] animate-pulse rounded-2xl bg-slate-100" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      <Megaphone className="mx-auto h-10 w-10 text-slate-300" />
      <h2 className="mt-3 text-base font-bold text-slate-900">Tidak ada task Marketing Check</h2>
      <p className="mt-1 text-sm text-slate-500">Coba tanggal, periode, toko, atau kata kunci berbeda.</p>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
      </div>
      <p className="mt-1 text-lg font-black tabular-nums" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function StoreList({
  stores,
  activeId,
  onSelect,
}: {
  stores: StoreGroup[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {stores.length} toko
      </div>

      <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
        {stores.map((store) => {
          const isActive = store.storeId === activeId;
          const rate = store.averageProgress;
          const pendingCount = Math.max(0, store.total - store.completed);

          return (
            <button
              key={store.storeId}
              type="button"
              onClick={() => onSelect(store.storeId)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition',
                isActive ? 'bg-indigo-50' : 'hover:bg-slate-50',
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500',
                )}
              >
                <Megaphone className="h-4 w-4" />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p
                    className={cn(
                      'truncate text-sm font-bold',
                      isActive ? 'text-indigo-900' : 'text-slate-900',
                    )}
                  >
                    {store.storeName}
                  </p>
                  <span className={cn('shrink-0 text-xs font-bold tabular-nums', progressTextClass(rate))}>
                    {rate}%
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn('h-full rounded-full transition-all', progressBarColor(rate))}
                    style={{ width: `${rate}%` }}
                  />
                </div>

                <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
                  {store.completed}/{store.total} task
                  {pendingCount > 0 && (
                    <span className="text-amber-600"> · {pendingCount} pending</span>
                  )}
                </p>
              </div>

              {/* Chevron */}
              <ChevronRight
                className={cn('mt-2 h-4 w-4 shrink-0', isActive ? 'text-indigo-500' : 'text-slate-300')}
              />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3',
        item.done ? 'border-indigo-100 bg-indigo-50' : 'border-slate-200 bg-slate-50',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          item.done ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500',
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-xs font-bold', item.done ? 'text-indigo-900' : 'text-slate-900')}>
          {item.label}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">
          <UserCheck className="mr-1 inline h-3 w-3" />
          {userLabel(item.checkedBy)} · {formatDateTime(item.checkedAt)}
        </p>
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: MarketingCheckTask }) {
  return (
    <>
      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize',
                statusStyle(task.status),
              )}
            >
              {task.status.replaceAll('_', ' ')}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {task.completedFields}/{task.totalFields} checklist
            </span>
          </div>

          {/* User info */}
          <div className="mt-3 space-y-0.5">
            <p className="text-sm font-bold text-slate-900">
              Karyawan aktif: {userLabel(task.employee)}
            </p>
            <p className="text-xs text-slate-500">Assigned: {userLabel(task.assignedUser)}</p>
            <p className="text-xs text-slate-500">
              Submitted: {userLabel(task.completedBy)} · {formatDateTime(task.completedAt)}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full sm:w-44">
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold">
            <span className="uppercase tracking-widest text-slate-400">Progress</span>
            <span className="text-slate-900">{task.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn('h-full rounded-full transition-all', progressBarColor(task.progress))}
              style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Checklist grid */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {task.checklist.map((item) => (
          <ChecklistRow key={item.key} item={item} />
        ))}
      </div>

      {/* Notes */}
      {task.notes && (
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          <span className="font-bold text-slate-800">Notes:</span> {task.notes}
          <p className="mt-1 text-[10px] text-slate-400">
            By: {userLabel(task.notesBy)} · {formatDateTime(task.notesAt)}
          </p>
        </div>
      )}
    </>
  );
}

function StoreDetail({ store }: { store: StoreGroup }) {
  const rate = store.averageProgress;
  const pendingCount = Math.max(0, store.total - store.completed);
  const discrepancyCount = store.tasks.filter((t) => t.status === 'discrepancy').length;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Store header */}
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Megaphone className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{store.storeName}</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {store.completed} selesai · {pendingCount} pending · {discrepancyCount} discrepancy
            </p>
          </div>

          <div className="hidden text-right sm:block">
            <p className="text-2xl font-black text-indigo-700 tabular-nums">{rate}%</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Progress</p>
          </div>
        </div>

        {/* Metric tiles */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <Metric label="Selesai" value={store.completed} accent="#4f46e5" />
          <Metric label="Pending" value={pendingCount} accent="#f59e0b" />
          <Metric label="Masalah" value={discrepancyCount} accent="#6366f1" />
          <Metric label="Total" value={store.total} accent="#64748b" />
        </div>

        {/* Overall progress bar */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full transition-all', progressBarColor(rate))}
            style={{ width: `${rate}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      <div className="divide-y divide-slate-100">
        {store.tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Tidak ada task Marketing Check dalam rentang ini.
          </div>
        ) : (
          store.tasks.map((task) => (
            <div key={task.id} className="p-4 sm:p-5">
              <TaskCard task={task} />
            </div>
          ))
        )}
      </div>
    </article>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function OpsMarketingCheckMonitorPage() {
  // State
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(todayInput());
  const [storeId, setStoreId] = useState('all');
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState<HealthFilter>('all');
  const [sort, setSort] = useState<SortKey>('most_pending');
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);

  // Data state
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data fetching
  async function load() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ period, date, storeId });
      const res = await fetch(`/api/ops/tasks/marketing-check?${params}`, {
        cache: 'no-store',
      });
      const json: ApiResponse = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Failed to load Marketing Check monitor.');
      }

      setData(json);

      // Reset store filter if current selection is no longer available
      const allowedIds = new Set((json.availableStores ?? []).map((s) => s.id));
      if (storeId !== 'all' && !allowedIds.has(storeId)) {
        setStoreId('all');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, date, storeId]);

  // Derived data
  const availableStores = data?.availableStores ?? [];

  const visibleStores = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list: StoreGroup[] = data?.stores ?? [];

    // Filter by search
    if (query) {
      list = list
        .map((store) => ({
          ...store,
          tasks: store.tasks.filter((task) => {
            const searchable = [
              store.storeName,
              userLabel(task.employee),
              userLabel(task.assignedUser),
              userLabel(task.completedBy),
              task.checklist.map((i) => `${i.label} ${userLabel(i.checkedBy)}`).join(' '),
              task.status,
              task.notes ?? '',
            ]
              .join(' ')
              .toLowerCase();

            return searchable.includes(query);
          }),
        }))
        .filter((store) => store.tasks.length > 0 || store.storeName.toLowerCase().includes(query));
    }

    // Filter by health
    if (health !== 'all') {
      list = list.filter((s) => healthOf(s) === health);
    }

    // Sort
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.storeName.localeCompare(b.storeName);

        case 'progress_low':
          return a.averageProgress - b.averageProgress;

        case 'progress_high':
          return b.averageProgress - a.averageProgress;

        case 'most_pending': {
          const scoreA = (a.total - a.completed) + a.tasks.filter((t) => t.status === 'discrepancy').length;
          const scoreB = (b.total - b.completed) + b.tasks.filter((t) => t.status === 'discrepancy').length;
          return scoreB !== scoreA ? scoreB - scoreA : a.storeName.localeCompare(b.storeName);
        }
      }
    });
  }, [data?.stores, search, health, sort]);

  // Sync active store with filtered list
  useEffect(() => {
    if (visibleStores.length === 0) {
      setActiveStoreId(null);
    } else if (!visibleStores.some((s) => s.storeId === activeStoreId)) {
      setActiveStoreId(visibleStores[0].storeId);
    }
  }, [visibleStores, activeStoreId]);

  const activeStore = visibleStores.find((s) => s.storeId === activeStoreId) ?? null;

  const healthCounts = useMemo(() => {
    const counts: Record<HealthFilter, number> = { all: 0, done: 0, pending: 0, issues: 0 };

    for (const store of data?.stores ?? []) {
      counts.all++;
      counts[healthOf(store)]++;
    }

    return counts;
  }, [data?.stores]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                Ops · Task Monitor
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Marketing Check
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Pantau checklist marketing dan siapa yang mengerjakan setiap field.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* Toolbar */}
        <Toolbar
          period={period}
          setPeriod={setPeriod}
          date={date}
          setDate={setDate}
          storeId={storeId}
          setStoreId={setStoreId}
          search={search}
          setSearch={setSearch}
          stores={availableStores}
        />

        {/* Error banner */}
        {error && (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-medium text-indigo-700">
            {error}
          </div>
        )}

        {/* Summary tiles */}
        {data && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <EmphasisTile
              label="Avg Progress"
              value={`${data.summary.averageProgress}%`}
              helper={`${data.summary.completedTasks} task selesai`}
            />
            <StatTile
              label="Toko"
              value={data.summary.stores}
              helper="Toko aktif"
              accent="#6366f1"
            />
            <StatTile
              label="Total Task"
              value={data.summary.totalTasks}
              helper="Dalam rentang dipilih"
              accent="#4f46e5"
            />
            <StatTile
              label="Selesai"
              value={data.summary.completedTasks}
              helper="Status completed"
              accent="#4f46e5"
            />
          </section>
        )}

        {/* Filter & sort bar */}
        <FilterSortBar
          health={health}
          onHealth={setHealth}
          healthCounts={healthCounts}
          sort={sort}
          onSort={setSort}
        />

        {/* Content area */}
        {loading && <LoadingSkeleton />}

        {!loading && !error && visibleStores.length === 0 && <EmptyState />}

        {!loading && visibleStores.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <StoreList
              stores={visibleStores}
              activeId={activeStoreId}
              onSelect={setActiveStoreId}
            />

            {activeStore ? (
              <StoreDetail store={activeStore} />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                Pilih toko untuk melihat detail.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
'use client';
// app/ops/tasks/marketing-check/page.tsx

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  Store,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'daily' | 'weekly' | 'monthly';
type HealthFilter = 'all' | 'done' | 'pending' | 'issues';
type SortKey = 'name' | 'progress_low' | 'progress_high' | 'most_pending';

type UserInfo = {
  id: string;
  name: string | null;
  email: string | null;
} | null;

type AvailableStore = {
  id: string;
  name: string;
  areaId: number | null;
};

type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  checkedBy: UserInfo;
  checkedAt: string | null;
};

type MarketingCheckTask = {
  id: string;
  scheduleId: string;
  date: string | null;
  status: string;
  notes: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  progress: number;
  completedFields: number;
  totalFields: number;
  checklist: ChecklistItem[];
  assignedUser: UserInfo;
  employee: UserInfo;
  completedBy: UserInfo;
  verifiedBy: UserInfo;
  notesBy: UserInfo;
  notesAt: string | null;
};

type StoreGroup = {
  storeId: string;
  storeName: string;
  areaId: number | null;
  total: number;
  completed: number;
  verified: number;
  averageProgress: number;
  tasks: MarketingCheckTask[];
};

type ApiResponse = {
  success: boolean;
  error?: string;
  period: Period;
  date: string;
  selectedStoreId?: string;
  availableStores?: AvailableStore[];
  summary: {
    stores: number;
    totalTasks: number;
    completedTasks: number;
    verifiedTasks: number;
    averageProgress: number;
  };
  stores: StoreGroup[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function userLabel(user: UserInfo): string {
  return user?.name || user?.email || (user?.id ? `User ${user.id}` : '-');
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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

function statusStyle(status: string): string {
  if (status === 'verified')
    return 'bg-violet-50 text-violet-700 border-violet-200';
  if (status === 'completed')
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'in_progress')
    return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (status === 'rejected' || status === 'discrepancy')
    return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function healthOf(store: StoreGroup): HealthFilter {
  if (store.total === 0) return 'pending';
  const hasIssues = store.tasks.some(
    (t) => t.status === 'rejected' || t.status === 'discrepancy',
  );
  if (hasIssues) return 'issues';
  if (store.completed < store.total) return 'pending';
  return 'done';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OpsMarketingCheckMonitorPage() {
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(todayInput());
  const [storeId, setStoreId] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Split-view state
  const [health, setHealth] = useState<HealthFilter>('all');
  const [sort, setSort] = useState<SortKey>('most_pending');
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);

  // ---- Data fetching ----

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period, date, storeId });
        const res = await fetch(
          `/api/ops/tasks/marketing-check?${params.toString()}`,
          { cache: 'no-store' },
        );
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? 'Failed to load Marketing Check monitor.');
        }
        if (!ignore) {
          setData(json);
          const allowed = new Set(
            (json.availableStores ?? []).map((s: AvailableStore) => s.id),
          );
          if (storeId !== 'all' && !allowed.has(storeId)) {
            setStoreId('all');
          }
        }
      } catch (err) {
        if (!ignore)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [period, date, storeId]);

  // ---- Derived state ----

  const availableStores = data?.availableStores ?? [];

  const visibleStores = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let list = data.stores;

    // Search filter
    if (q) {
      list = list
        .map((store) => ({
          ...store,
          tasks: store.tasks.filter((task) => {
            const checklistActors = task.checklist
              .map((item) => `${item.label} ${userLabel(item.checkedBy)}`)
              .join(' ');
            const searchable = [
              store.storeName,
              userLabel(task.employee),
              userLabel(task.assignedUser),
              userLabel(task.completedBy),
              checklistActors,
              task.status,
              task.notes ?? '',
            ]
              .join(' ')
              .toLowerCase();
            return searchable.includes(q);
          }),
        }))
        .filter((store) => store.tasks.length > 0);
    }

    // Health filter
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
          const issuesA =
            a.total -
            a.completed +
            a.tasks.filter(
              (t) =>
                t.status === 'rejected' || t.status === 'discrepancy',
            ).length;
          const issuesB =
            b.total -
            b.completed +
            b.tasks.filter(
              (t) =>
                t.status === 'rejected' || t.status === 'discrepancy',
            ).length;
          if (issuesB !== issuesA) return issuesB - issuesA;
          return a.storeName.localeCompare(b.storeName);
        }
      }
    });
  }, [data, search, health, sort]);

  // Keep activeStoreId pointing to a visible store
  useEffect(() => {
    if (visibleStores.length === 0) {
      setActiveStoreId(null);
      return;
    }
    if (!visibleStores.some((s) => s.storeId === activeStoreId)) {
      setActiveStoreId(visibleStores[0].storeId);
    }
  }, [visibleStores, activeStoreId]);

  const activeStore =
    visibleStores.find((s) => s.storeId === activeStoreId) ?? null;

  const healthCounts = useMemo(() => {
    const c = { all: 0, done: 0, pending: 0, issues: 0 };
    for (const s of data?.stores ?? []) {
      c.all += 1;
      c[healthOf(s)] += 1;
    }
    return c;
  }, [data?.stores]);

  // ---- Render ----

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
                Monitor checklist progress and see who checked every item.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({ period, date, storeId });
                setLoading(true);
                fetch(`/api/ops/tasks/marketing-check?${params.toString()}`, {
                  cache: 'no-store',
                })
                  .then((r) => r.json())
                  .then((json) => {
                    if (json.success) setData(json);
                    else throw new Error(json.error);
                  })
                  .catch((err) =>
                    setError(
                      err instanceof Error ? err.message : 'Failed to refresh',
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
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

      {/* Body */}
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* Toolbar */}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[260px_180px_220px_1fr]">
          {/* Period toggle */}
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
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
            <option value="all">All stores</option>
            {availableStores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>

          {/* Search */}
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari toko, employee, atau item checklist…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        {/* Summary tiles */}
        {data && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryTile
              label="Avg Progress"
              value={`${data.summary.averageProgress}%`}
              helper={`${data.summary.completedTasks} tasks completed`}
              accent="#4f46e5"
              emphasis
            />
            <SummaryTile
              label="Stores"
              value={data.summary.stores}
              helper="Active stores"
              accent="#6366f1"
            />
            <SummaryTile
              label="Total Tasks"
              value={data.summary.totalTasks}
              helper="In selected range"
              accent="#0ea5e9"
            />
            <SummaryTile
              label="Completed"
              value={data.summary.completedTasks}
              helper={`${data.summary.verifiedTasks} verified`}
              accent="#10b981"
            />
            <SummaryTile
              label="Verified"
              value={data.summary.verifiedTasks}
              helper="Approved by Ops"
              accent="#f59e0b"
            />
          </section>
        )}

        {/* Health filter chips + sort */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <HealthChip
              label="All"
              count={healthCounts.all}
              active={health === 'all'}
              onClick={() => setHealth('all')}
            />
            <HealthChip
              label="Done"
              count={healthCounts.done}
              active={health === 'done'}
              onClick={() => setHealth('done')}
              color="emerald"
            />
            <HealthChip
              label="Pending"
              count={healthCounts.pending}
              active={health === 'pending'}
              onClick={() => setHealth('pending')}
              color="amber"
            />
            <HealthChip
              label="Issues"
              count={healthCounts.issues}
              active={health === 'issues'}
              onClick={() => setHealth('issues')}
              color="rose"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Sort
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option value="most_pending">Most pending first</option>
              <option value="progress_low">Lowest progress</option>
              <option value="progress_high">Highest progress</option>
              <option value="name">Name (A→Z)</option>
            </select>
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-2xl bg-slate-100"
                />
              ))}
            </div>
            <div className="h-[360px] animate-pulse rounded-2xl bg-slate-100" />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && visibleStores.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Megaphone className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-base font-bold text-slate-900">
              No Marketing Check tasks found
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Try a different date, period, store, or search keyword.
            </p>
          </div>
        )}

        {/* Split layout: List + Detail (Highly Scalable for 50+ stores) */}
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
                Select a store to see its tasks.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryTile({
  label,
  value,
  helper,
  accent,
  emphasis,
}: {
  label: string;
  value: string | number;
  helper: string;
  accent: string;
  emphasis?: boolean;
  warning?: boolean;
}) {
  if (emphasis) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4 text-white shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
          {label}
        </p>
        <p className="mt-2 text-2xl font-black">{value}</p>
        <p className="mt-1 text-[11px] text-slate-300">{helper}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: accent }}
        />
      </div>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{helper}</p>
    </div>
  );
}

function HealthChip({
  label,
  count,
  active,
  onClick,
  color = 'indigo',
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: 'indigo' | 'emerald' | 'amber' | 'rose';
}) {
  const palette: Record<string, { active: string; idle: string }> = {
    indigo: {
      active: 'bg-indigo-600 text-white border-indigo-600',
      idle: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200',
    },
    emerald: {
      active: 'bg-emerald-500 text-white border-emerald-500',
      idle: 'bg-white text-slate-600 border-slate-200 hover:border-emerald-200',
    },
    amber: {
      active: 'bg-amber-500 text-white border-amber-500',
      idle: 'bg-white text-slate-600 border-slate-200 hover:border-amber-200',
    },
    rose: {
      active: 'bg-rose-500 text-white border-rose-500',
      idle: 'bg-white text-slate-600 border-slate-200 hover:border-rose-200',
    },
  };

  const { active: activeCls, idle } = palette[color];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition',
        active ? activeCls : idle,
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 text-[10px] font-bold',
          active ? 'bg-white/20' : 'bg-slate-100 text-slate-600',
        )}
      >
        {count}
      </span>
    </button>
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
        {stores.length} store{stores.length !== 1 ? 's' : ''}
      </div>

      {/* Scrollable list — keeps detail visible on the right at any list size */}
      <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
        {stores.map((store) => {
          const active = store.storeId === activeId;
          const rate = store.averageProgress;
          const left = Math.max(0, store.total - store.completed);

          return (
            <button
              key={store.storeId}
              type="button"
              onClick={() => onSelect(store.storeId)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition',
                active ? 'bg-indigo-50' : 'hover:bg-slate-50',
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-500',
                )}
              >
                <Megaphone className="h-4 w-4" />
              </div>

              {/* Body */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p
                    className={cn(
                      'truncate text-sm font-bold',
                      active ? 'text-indigo-900' : 'text-slate-900',
                    )}
                  >
                    {store.storeName}
                  </p>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-bold tabular-nums',
                      rate >= 80
                        ? 'text-emerald-600'
                        : rate >= 40
                          ? 'text-amber-600'
                          : 'text-rose-600',
                    )}
                  >
                    {rate}%
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${rate}%` }}
                  />
                </div>

                <div className="mt-1.5 flex items-center gap-2 text-[10px] font-semibold text-slate-500">
                  <span>
                    {store.completed}/{store.total} tasks
                  </span>
                  {left > 0 && (
                    <span className="text-amber-600">· {left} pending</span>
                  )}
                </div>
              </div>

              {/* Chevron */}
              <ChevronRight
                className={cn(
                  'mt-2 h-4 w-4 shrink-0',
                  active ? 'text-indigo-500' : 'text-slate-300',
                )}
              />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function StoreDetail({ store }: { store: StoreGroup }) {
  const rate = store.averageProgress;
  const left = Math.max(0, store.total - store.completed);
  const rejected = store.tasks.filter(
    (t) => t.status === 'rejected' || t.status === 'discrepancy',
  ).length;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Store header */}
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">
              {store.storeName}
            </h2>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-2xl font-black text-slate-900 tabular-nums">
              {rate}%
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Progress
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <Metric label="Done" value={store.completed} accent="#10b981" />
          <Metric label="Pending" value={left} accent="#f59e0b" />
          <Metric label="Rejected" value={rejected} accent="#ef4444" />
          <Metric label="Total" value={store.total} accent="#6366f1" />
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${rate}%` }}
          />
        </div>
      </div>

      {/* Task cards */}
      <div className="divide-y divide-slate-100">
        {store.tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No Marketing Check task in the selected range.
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
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: accent }}
        />
      </div>
      <p
        className="mt-1 text-lg font-black tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </p>
    </div>
  );
}

function TaskCard({ task }: { task: MarketingCheckTask }) {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Meta */}
        <div className="min-w-0 flex-1">
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

          <div className="mt-3 space-y-0.5">
            <p className="text-sm font-bold text-slate-900">
              Active employee: {userLabel(task.employee)}
            </p>
            <p className="text-xs text-slate-500">
              Assigned row: {userLabel(task.assignedUser)}
            </p>
            <p className="text-xs text-slate-500">
              Submitted by: {userLabel(task.completedBy)} ·{' '}
              {formatDateTime(task.completedAt)}
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="w-full sm:w-44">
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold">
            <span className="text-slate-400 uppercase tracking-widest">
              Progress
            </span>
            <span className="text-slate-900">{task.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{
                width: `${Math.min(100, Math.max(0, task.progress))}%`,
              }}
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

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3',
        item.done
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-slate-200 bg-slate-50',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          item.done
            ? 'bg-emerald-500 text-white'
            : 'bg-slate-200 text-slate-500',
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-xs font-bold',
            item.done ? 'text-emerald-900' : 'text-slate-900',
          )}
        >
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
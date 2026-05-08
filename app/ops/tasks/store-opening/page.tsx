// app/ops/tasks/store-opening/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'daily' | 'weekly' | 'monthly';
type Status = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';
type Actor = { id: string; name: string | null; email: string | null } | null;

type FieldRow = {
  label: string;
  done: boolean;
  actor: Actor;
  at: string | null;
  photoCount?: number;
};

type StoreGroup = {
  store: { id: string; name: string; address?: string | null; areaId?: number | null };
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    verified: number;
    rejected: number;
    discrepancy: number;
    completionRate: number;
    completedFields: number;
    totalFields: number;
  };
  tasks: Array<{
    id: string;
    scheduleId: string;
    date: string | null;
    status: Status;
    rawStatus: Status;
    progress: number;
    completedFields: number;
    totalFields: number;
    assignedUser: Actor;
    completedBy: Actor;
    completedAt: string | null;
    notes: string | null;
    fields: Record<string, FieldRow>;
  }>;
};

type ResponseShape = {
  success: boolean;
  error?: string;
  range?: { start: string; end: string };
  stores?: StoreGroup[];
  data?: {
    period: Period;
    range: { start: string; end: string };
    summary: {
      totalStores: number;
      totalTasks: number;
      completedFields: number;
      totalFields: number;
      completionRate: number;
    };
    stores: StoreGroup[];
  };
};

type HealthFilter = 'all' | 'done' | 'pending' | 'issues';
type SortKey = 'name' | 'completion_low' | 'completion_high' | 'most_pending';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_ORDER = [
  'loginPos',
  'cashDrawer',
  'checkAbsenSunfish',
  'tarikSohSales',
  'fiveR',
  'fiveRAreaKasir',
  'fiveRAreaDepan',
  'fiveRAreaKanan',
  'fiveRAreaKiri',
  'fiveRAreaGudang',
  'cekLamp',
  'cekSoundSystem',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function actorName(actor: Actor) {
  return actor?.name || actor?.email || actor?.id || '—';
}

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statusStyle(status: Status): string {
  const styles: Record<Status, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    verified: 'bg-violet-50 text-violet-700 border-violet-200',
    rejected: 'bg-rose-50 text-rose-700 border-rose-200',
    discrepancy: 'bg-amber-50 text-amber-800 border-amber-300',
  };
  return styles[status] ?? styles.pending;
}

function statusIcon(status: Status) {
  if (status === 'verified') return <ShieldCheck className="h-3.5 w-3.5" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'in_progress') return <Clock3 className="h-3.5 w-3.5" />;
  if (status === 'rejected') return <XCircle className="h-3.5 w-3.5" />;
  if (status === 'discrepancy') return <AlertCircle className="h-3.5 w-3.5" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

function healthOf(group: StoreGroup): HealthFilter {
  const s = group.summary;
  if (s.total === 0) return 'pending';
  if (s.rejected > 0 || s.discrepancy > 0) return 'issues';
  if (s.completionRate < 100) return 'pending';
  return 'done';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OpsStoreOpeningMonitorPage() {
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(todayInputValue());
  const [storeId, setStoreId] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<StoreGroup[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthFilter>('all');
  const [sort, setSort] = useState<SortKey>('most_pending');
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);

  // ---- Data fetching ----

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, date, storeId });
      const res = await fetch(`/api/ops/tasks/store-opening?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = (await res.json()) as ResponseShape;

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Failed to load Store Opening monitor.');
      }

      const nextStores = json.data?.stores ?? json.stores ?? [];
      setGroups(nextStores);
      setRange(json.data?.range ?? json.range ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data.');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, date, storeId]);

  // ---- Derived state ----

  const storeOptions = useMemo(
    () => groups.map((g) => ({ id: g.store.id, name: g.store.name })),
    [groups],
  );

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = groups;

    // Search filter
    if (q) {
      list = list
        .map((g) => ({
          ...g,
          tasks: g.tasks.filter(
            (t) =>
              g.store.name.toLowerCase().includes(q) ||
              actorName(t.completedBy).toLowerCase().includes(q) ||
              actorName(t.assignedUser).toLowerCase().includes(q) ||
              Object.values(t.fields).some((f) =>
                actorName(f.actor).toLowerCase().includes(q),
              ),
          ),
        }))
        .filter(
          (g) => g.tasks.length > 0 || g.store.name.toLowerCase().includes(q),
        );
    }

    // Health filter
    if (health !== 'all') {
      list = list.filter((g) => healthOf(g) === health);
    }

    // Sort
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.store.name.localeCompare(b.store.name);
        case 'completion_low':
          return a.summary.completionRate - b.summary.completionRate;
        case 'completion_high':
          return b.summary.completionRate - a.summary.completionRate;
        case 'most_pending': {
          const scoreA =
            a.summary.totalFields -
            a.summary.completedFields +
            a.summary.rejected +
            a.summary.discrepancy;
          const scoreB =
            b.summary.totalFields -
            b.summary.completedFields +
            b.summary.rejected +
            b.summary.discrepancy;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return a.store.name.localeCompare(b.store.name);
        }
      }
    });
  }, [groups, query, health, sort]);

  // Keep activeStoreId pointing to a visible group
  useEffect(() => {
    if (visibleGroups.length === 0) {
      setActiveStoreId(null);
      return;
    }
    if (!visibleGroups.some((g) => g.store.id === activeStoreId)) {
      setActiveStoreId(visibleGroups[0].store.id);
    }
  }, [visibleGroups, activeStoreId]);

  const activeGroup =
    visibleGroups.find((g) => g.store.id === activeStoreId) ?? null;

  // ---- Aggregate stats ----

  const totalFields = groups.reduce((sum, g) => sum + g.summary.totalFields, 0);
  const completedFields = groups.reduce(
    (sum, g) => sum + g.summary.completedFields,
    0,
  );
  const totalTasks = groups.reduce((sum, g) => sum + g.summary.total, 0);
  const totalPendingFields = Math.max(0, totalFields - completedFields);
  const overallRate = totalFields
    ? Math.round((completedFields / totalFields) * 100)
    : 0;

  const healthCounts = useMemo(() => {
    const c = { all: 0, done: 0, pending: 0, issues: 0 };
    for (const g of groups) {
      c.all += 1;
      c[healthOf(g)] += 1;
    }
    return c;
  }, [groups]);

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
                Store Opening
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Track every Store Opening checklist field and who completed it.
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

      {/* Body */}
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* Toolbar */}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[260px_180px_220px_1fr]">
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
              value={date}
              onChange={(e) => setDate(e.target.value)}
              type="date"
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
            {storeOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Search */}
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari toko atau employee…"
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
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryTile
            label="Progress"
            value={`${overallRate}%`}
            helper={range ? `${range.start} – ${range.end}` : 'Selected range'}
            accent="#4f46e5"
            emphasis
          />
          <SummaryTile
            label="Stores"
            value={groups.length}
            helper="Visible to your area"
            accent="#6366f1"
          />
          <SummaryTile
            label="Tasks"
            value={totalTasks}
            helper="Task rows"
            accent="#0ea5e9"
          />
          <SummaryTile
            label="Fields done"
            value={`${completedFields}/${totalFields}`}
            helper="Checklist progress"
            accent="#10b981"
          />
          <SummaryTile
            label="Need action"
            value={totalPendingFields}
            helper="Fields left"
            accent="#f59e0b"
            warning
          />
        </section>

        {/* Health & sort bar */}
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
              <option value="most_pending">Most pending fields</option>
              <option value="completion_low">Lowest progress</option>
              <option value="completion_high">Highest progress</option>
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
        {!loading && !error && visibleGroups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Store className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-base font-bold text-slate-900">
              No matching stores
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Try a different date, period, filter, or search keyword.
            </p>
          </div>
        )}

        {/* Main content: store list + detail */}
        {!loading && visibleGroups.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <StoreList
              groups={visibleGroups}
              activeId={activeStoreId}
              onSelect={setActiveStoreId}
            />
            {activeGroup ? (
              <StoreDetail group={activeGroup} />
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
  emphasis,
  warning,
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
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 shadow-sm',
        warning ? 'border-amber-200 bg-amber-50' : 'border-slate-200',
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>
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
      active: 'bg-indigo-500 text-white border-indigo-500',
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
  groups,
  activeId,
  onSelect,
}: {
  groups: StoreGroup[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {groups.length} store{groups.length !== 1 ? 's' : ''}
      </div>

      <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
        {groups.map((group) => {
          const active = group.store.id === activeId;
          const rate = group.summary.completionRate;
          const left = Math.max(
            0,
            group.summary.totalFields - group.summary.completedFields,
          );

          return (
            <button
              key={group.store.id}
              type="button"
              onClick={() => onSelect(group.store.id)}
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
                <Store className="h-4 w-4" />
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
                    {group.store.name}
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
                    {group.summary.completedFields}/{group.summary.totalFields}{' '}
                    fields
                  </span>
                  {left > 0 && (
                    <span className="text-amber-600">· {left} left</span>
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

function StoreDetail({ group }: { group: StoreGroup }) {
  const rate = group.summary.completionRate;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Store header */}
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Store className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">
              {group.store.name}
            </h2>
            {group.store.address && (
              <p className="mt-0.5 flex items-start gap-1.5 text-xs text-slate-500">
                <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="line-clamp-2">{group.store.address}</span>
              </p>
            )}
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

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-500"
            style={{ width: `${rate}%` }}
          />
        </div>
        <div className="mt-2 text-xs font-semibold text-slate-500">
          {group.summary.completedFields}/{group.summary.totalFields} checklist
          fields completed
        </div>
      </div>

      {/* Task cards */}
      <div className="divide-y divide-slate-100">
        {group.tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No Store Opening task in this range.
          </div>
        ) : (
          group.tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </article>
  );
}

function TaskCard({ task }: { task: StoreGroup['tasks'][number] }) {
  const fields = FIELD_ORDER.map((key) => task.fields[key]).filter(Boolean);

  return (
    <div className="p-4 sm:p-5">
      {/* Task header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize',
                statusStyle(task.status),
              )}
            >
              {statusIcon(task.status)}
              {task.status.replace('_', ' ')}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {formatDate(task.date)}
            </span>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-900">
            Assigned: {actorName(task.assignedUser)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Completed by: {actorName(task.completedBy)} ·{' '}
            {formatTime(task.completedAt)}
          </p>
        </div>
      </div>
      
      {/* Field pills */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <FieldPill key={field.label} field={field} />
        ))}
      </div>

      {/* Notes */}
      {task.notes && (
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {task.notes}
        </div>
      )}
    </div>
  );
}

function FieldPill({ field }: { field: FieldRow }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        field.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50',
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            field.done
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-200 text-slate-500',
          )}
        >
          {field.done ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Clock3 className="h-3.5 w-3.5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-slate-900">
            {field.label}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            <UserCheck className="mr-1 inline h-3 w-3" />
            {actorName(field.actor)} · {formatTime(field.at)}
          </p>
          {typeof field.photoCount === 'number' && (
            <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
              {field.photoCount} photo{field.photoCount === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
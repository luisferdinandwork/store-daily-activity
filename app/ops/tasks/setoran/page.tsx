'use client';
// app/ops/tasks/setoran/page.tsx

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'daily' | 'weekly' | 'monthly';

type UserInfo = { id: string; name: string | null; email: string | null } | null;

type FieldActor = {
  user: UserInfo;
  at: string | null;
};

type AvailableStore = {
  id: string;
  name: string;
  areaId: number | null;
};

type SetoranMonitorTask = {
  id: string;
  scheduleId: string;
  date: string | null;
  status: string;
  completedAt: string | null;
  verifiedAt: string | null;
  notes: string | null;
  actualReceivedAmount: string | null;
  previousUnpaidAmount: string | null;
  requiredStoreAmount: string | null;
  storedAmount: string | null;
  unpaidAmount: string | null;
  resiPhoto: string | null;
  atmCardSelfiePhoto: string | null;
  assignedUser: UserInfo;
  completedUser: UserInfo;
  fieldActors: {
    actualReceivedAmount: FieldActor;
    storedAmount: FieldActor;
    resiPhoto: FieldActor;
    atmCardSelfiePhoto: FieldActor;
    notes: FieldActor;
  };
};

type StoreGroup = {
  storeId: string;
  storeName: string;
  areaId?: number | null;
  total: number;
  completed: number;
  verified: number;
  unpaidTotal: number;
  tasks: SetoranMonitorTask[];
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
    completed: number;
    verified: number;
    unpaidTotal: number;
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

function rupiah(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 'Rp 0';
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function userLabel(user: UserInfo): string {
  return user?.name || user?.email || (user?.id ? `User ${user.id}` : '-');
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OpsSetoranMonitorPage() {
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(todayInput());
  const [storeId, setStoreId] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStores, setOpenStores] = useState<Record<string, boolean>>({});

  // ---- Data fetching ----

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period, date, storeId });
        const res = await fetch(`/api/ops/tasks/setoran?${params.toString()}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok || !json.success)
          throw new Error(json.error ?? 'Failed to load Setoran monitor.');

        if (!ignore) {
          setData(json);
          // Reset store filter if it's no longer in the allowed list
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

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data.stores;

    return data.stores
      .map((store) => ({
        ...store,
        tasks: store.tasks.filter((task) => {
          const values = [
            store.storeName,
            userLabel(task.completedUser),
            userLabel(task.assignedUser),
            userLabel(task.fieldActors.actualReceivedAmount.user),
            userLabel(task.fieldActors.storedAmount.user),
            userLabel(task.fieldActors.resiPhoto.user),
            userLabel(task.fieldActors.atmCardSelfiePhoto.user),
          ]
            .join(' ')
            .toLowerCase();
          return values.includes(q);
        }),
      }))
      .filter((store) => store.tasks.length > 0);
  }, [data, search]);

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
                Setoran Penjualan
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Pantau nominal setoran, unpaid carry-forward, dan siapa yang
                mengisi tiap field.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({ period, date, storeId });
                setLoading(true);
                fetch(`/api/ops/tasks/setoran?${params.toString()}`, {
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
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[200px_180px_200px_1fr]">
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
        {data && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryTile
              label="Tasks"
              value={data.summary.totalTasks}
              helper={`${data.summary.completed} completed`}
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
              label="Completed"
              value={`${data.summary.completed + data.summary.verified}/${data.summary.totalTasks}`}
              helper={`${data.summary.verified} verified`}
              accent="#10b981"
            />
            <SummaryTile
              label="Verified"
              value={data.summary.verified}
              helper="Approved tasks"
              accent="#0ea5e9"
            />
            <SummaryTile
              label="Unpaid"
              value={rupiah(data.summary.unpaidTotal)}
              helper="Total carry-forward"
              accent="#f59e0b"
              warning={data.summary.unpaidTotal > 0}
            />
          </section>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-slate-400" />
            <span className="text-sm font-semibold text-slate-500">
              Loading monitor...
            </span>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filteredStores.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Wallet className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-base font-bold text-slate-900">
              No Setoran tasks found
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Try a different date, period, or search keyword.
            </p>
          </div>
        )}

        {/* Store accordion list */}
        <div className="space-y-3">
          {filteredStores.map((store) => {
            const opened = openStores[store.storeId] ?? true;
            return (
              <section
                key={store.storeId}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                {/* Store header */}
                <button
                  type="button"
                  onClick={() =>
                    setOpenStores((prev) => ({
                      ...prev,
                      [store.storeId]: !opened,
                    }))
                  }
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
                >
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      {store.storeName}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {store.completed + store.verified}/{store.total} completed
                      <span className="mx-1.5 text-slate-300">·</span>
                      Unpaid{' '}
                      <span className="font-bold text-amber-700">
                        {rupiah(store.unpaidTotal)}
                      </span>
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-5 w-5 shrink-0 text-slate-400 transition-transform',
                      opened && 'rotate-180',
                    )}
                  />
                </button>

                {/* Task rows */}
                {opened && (
                  <div className="divide-y divide-slate-100">
                    {store.tasks.map((task) => (
                      <article key={task.id} className="space-y-4 p-4 sm:p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          {/* Left: Meta info */}
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize',
                                  statusStyle(task.status),
                                )}
                              >
                                {task.status.replace('_', ' ')}
                              </span>
                              {Number(task.unpaidAmount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                  <AlertTriangle className="h-3 w-3" /> Unpaid{' '}
                                  {rupiah(task.unpaidAmount)}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-sm font-bold text-slate-900">
                              {fmtDate(task.date)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              Completed by: {userLabel(task.completedUser)}
                            </p>
                          </div>

                          {/* Right: Money pills */}
                          <div className="grid grid-cols-2 gap-2 text-right text-xs sm:min-w-[320px]">
                            <MoneyPill
                              label="Received"
                              value={task.actualReceivedAmount}
                            />
                            <MoneyPill
                              label="Stored"
                              value={task.storedAmount}
                            />
                            <MoneyPill
                              label="Prev unpaid"
                              value={task.previousUnpaidAmount}
                            />
                            <MoneyPill
                              label="Unpaid"
                              value={task.unpaidAmount}
                              danger={Number(task.unpaidAmount ?? 0) > 0}
                            />
                          </div>
                        </div>

                        {/* Field actors */}
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                          <FieldActorLine
                            label="Actual received"
                            actor={task.fieldActors.actualReceivedAmount}
                          />
                          <FieldActorLine
                            label="Stored amount"
                            actor={task.fieldActors.storedAmount}
                          />
                          <FieldActorLine
                            label="Resi photo"
                            actor={task.fieldActors.resiPhoto}
                          />
                          <FieldActorLine
                            label="ATM selfie"
                            actor={task.fieldActors.atmCardSelfiePhoto}
                          />
                          <FieldActorLine
                            label="Notes"
                            actor={task.fieldActors.notes}
                          />
                        </div>

                        {/* Photo links */}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <PhotoLink label="Resi" url={task.resiPhoto} />
                          <PhotoLink
                            label="ATM Selfie"
                            url={task.atmCardSelfiePhoto}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
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
      <div className="flex items-start justify-between">
        <p
          className={cn(
            'text-[10px] font-bold uppercase tracking-widest',
            warning ? 'text-amber-700' : 'text-slate-400',
          )}
        >
          {label}
        </p>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: accent }}
        />
      </div>
      <p
        className={cn(
          'mt-2 text-2xl font-black',
          warning ? 'text-amber-900' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          'mt-1 text-[11px]',
          warning ? 'text-amber-700' : 'text-slate-500',
        )}
      >
        {helper}
      </p>
    </div>
  );
}

function MoneyPill({
  label,
  value,
  danger,
}: {
  label: string;
  value: string | null | undefined;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2',
        danger
          ? 'border-amber-200 bg-amber-50'
          : 'border-slate-200 bg-slate-50',
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 text-sm font-black',
          danger ? 'text-amber-900' : 'text-slate-900',
        )}
      >
        {rupiah(value)}
      </p>
    </div>
  );
}

function FieldActorLine({
  label,
  actor,
}: {
  label: string;
  actor: FieldActor;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="text-right">
        <p className="text-xs font-bold text-slate-900">
          {userLabel(actor.user)}
        </p>
        <p className="text-[10px] text-slate-400">{fmtDateTime(actor.at)}</p>
      </div>
    </div>
  );
}

function PhotoLink({
  label,
  url,
}: {
  label: string;
  url: string | null;
}) {
  if (!url) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-400">
        <Receipt className="h-4 w-4" /> {label}: no photo
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700"
    >
      <Receipt className="h-4 w-4" /> Open {label}
    </a>
  );
}
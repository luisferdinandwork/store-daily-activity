'use client';
// app/ops/tasks/grooming/page.tsx

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Store,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';
type Status = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';
type HealthFilter = 'all' | 'done' | 'pending' | 'issues';
type SortKey = 'name' | 'progress_low' | 'progress_high' | 'most_pending';

interface GroomingField {
  key: string;
  label: string;
  active: boolean;
  done: boolean;
}

interface GroomingTaskRecord {
  id: string | null;
  scheduleId: string;
  date: string | null;
  status: Status;
  progress: number;
  completedFields: number;
  totalFields: number;
  fields: GroomingField[];
  employee: {
    id: string;
    name: string;
    email: string | null;
    employeeType: { code: string | null; label: string | null } | null;
  };
  shift: { id: number | null; code: string | null; label: string | null } | null;
  selfiePhotos: string[];
  selfiePhotoCount: number;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

interface GroomingStoreRow {
  id: number;
  name: string;
  address: string | null;
  areaId: number | null;
  summary: {
    totalEmployees: number;
    totalTasks: number;
    completedTasks: number;
    verifiedTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    rejectedTasks: number;
    completionRate: number;
    averageProgress: number;
    statusCount: Record<string, number>;
  };
  tasks: GroomingTaskRecord[];
}

interface GroomingMonitorResponse {
  success: boolean;
  error?: string;
  data?: {
    period: Period;
    range: { start: string; end: string };
    availableStores: { id: number; name: string }[];
    summary: {
      totalStores: number;
      totalEmployees: number;
      totalTasks: number;
      completedTasks: number;
      verifiedTasks: number;
      pendingTasks: number;
      inProgressTasks: number;
      rejectedTasks: number;
      completionRate: number;
      averageProgress: number;
    };
    stores: GroomingStoreRow[];
  };
}

// ─── Shared design tokens ─────────────────────────────────────────────────────

// Single source of truth for progress → color mapping used across all OPS pages
export function progressColor(pct: number): string {
  if (pct >= 80) return '#4f46e5'; // indigo-600
  if (pct >= 40) return '#f59e0b'; // amber-500
  return '#6366f1';                 // indigo-400 (soft indigo for low, not alarming)
}

export function progressTextClass(pct: number): string {
  if (pct >= 80) return 'text-indigo-600';
  if (pct >= 40) return 'text-amber-600';
  return 'text-indigo-400';
}

export function progressBarClass(pct: number): string {
  if (pct >= 80) return 'bg-indigo-600';
  if (pct >= 40) return 'bg-amber-500';
  return 'bg-indigo-300';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function healthOf(store: GroomingStoreRow): HealthFilter {
  const s = store.summary;
  if (s.totalTasks === 0) return 'pending';
  if (s.rejectedTasks > 0) return 'issues';
  if (s.pendingTasks + s.inProgressTasks > 0) return 'pending';
  return 'done';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsGroomingPage() {
  const [period, setPeriod]             = useState<Period>('daily');
  const [date, setDate]                 = useState(todayKey());
  const [storeId, setStoreId]           = useState('all');
  const [search, setSearch]             = useState('');
  const [data, setData]                 = useState<GroomingMonitorResponse['data'] | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [health, setHealth]             = useState<HealthFilter>('all');
  const [sort, setSort]                 = useState<SortKey>('most_pending');
  const [activeStoreId, setActiveStoreId] = useState<number | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ period, date, storeId });
      const res  = await fetch(`/api/ops/tasks/grooming?${params}`, { cache: 'no-store' });
      const json = await res.json() as GroomingMonitorResponse;
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || 'Failed to load.');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
      setData(null);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period, date, storeId]);

  const storeOptions = useMemo(() => (data?.availableStores ?? []).map(s => ({ id: s.id, name: s.name })), [data?.availableStores]);

  const visibleStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data?.stores ?? [];
    if (q) {
      list = list.map(s => ({
        ...s,
        tasks: s.tasks.filter(t => [s.name, t.employee.name, t.employee.email, t.employee.employeeType?.label, t.shift?.label, t.notes].join(' ').toLowerCase().includes(q)),
      })).filter(s => s.tasks.length > 0 || s.name.toLowerCase().includes(q));
    }
    if (health !== 'all') list = list.filter(s => healthOf(s) === health);
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':          return a.name.localeCompare(b.name);
        case 'progress_low':  return a.summary.averageProgress - b.summary.averageProgress;
        case 'progress_high': return b.summary.averageProgress - a.summary.averageProgress;
        case 'most_pending': {
          const pa = a.summary.pendingTasks + a.summary.inProgressTasks + a.summary.rejectedTasks;
          const pb = b.summary.pendingTasks + b.summary.inProgressTasks + b.summary.rejectedTasks;
          return pb !== pa ? pb - pa : a.name.localeCompare(b.name);
        }
      }
    });
  }, [data?.stores, search, health, sort]);

  useEffect(() => {
    if (!visibleStores.length) { setActiveStoreId(null); return; }
    if (!visibleStores.some(s => s.id === activeStoreId)) setActiveStoreId(visibleStores[0].id);
  }, [visibleStores, activeStoreId]);

  const activeStore = visibleStores.find(s => s.id === activeStoreId) ?? null;
  const summary     = data?.summary;

  const healthCounts = useMemo(() => {
    const c = { all: 0, done: 0, pending: 0, issues: 0 };
    for (const s of data?.stores ?? []) { c.all++; c[healthOf(s)]++; }
    return c;
  }, [data?.stores]);

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Ops · Task Monitor</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Grooming</h1>
              <p className="mt-1 text-sm text-slate-500">Per-employee personal task. Tap a store to see who's still pending.</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* ── Toolbar ── */}
        <Toolbar period={period} date={date} storeId={storeId} search={search} storeOptions={storeOptions}
          onPeriod={setPeriod} onDate={setDate} onStore={setStoreId} onSearch={setSearch} />

        {error && <ErrorBanner message={error} />}

        {/* ── Summary ── */}
        {summary && (
          <section className="grid gap-3 sm:grid-cols-3">
            <SummaryTile label="Avg Progress" value={`${summary.averageProgress}%`} helper={`${summary.totalStores} stores · ${summary.totalEmployees} employees`} emphasis />
            <SummaryTile label="Selesai" value={summary.completedTasks + summary.verifiedTasks} helper={`dari ${summary.totalTasks} task`} accent="#4f46e5" />
            <SummaryTile label="Perlu Tindakan" value={summary.pendingTasks + summary.inProgressTasks + summary.rejectedTasks} helper={summary.rejectedTasks > 0 ? `${summary.rejectedTasks} ditolak` : 'Pending + in-progress'} accent="#f59e0b" warning />
          </section>
        )}

        {/* ── Filter bar ── */}
        <FilterBar
          healthCounts={healthCounts} health={health} onHealth={setHealth}
          sortOptions={[
            { value: 'most_pending', label: 'Most pending first' },
            { value: 'progress_low', label: 'Lowest progress' },
            { value: 'progress_high', label: 'Highest progress' },
            { value: 'name', label: 'Name (A→Z)' },
          ]}
          sort={sort} onSort={v => setSort(v as SortKey)}
        />

        {loading && <LoadingSkeleton />}

        {!loading && !error && visibleStores.length === 0 && (
          <EmptyState icon={<Sparkles className="mx-auto h-10 w-10 text-slate-300" />}
            title="No grooming tasks found"
            body="Try a different date, period, filter, or search keyword." />
        )}

        {!loading && visibleStores.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            {/* Store list */}
            <StoreList stores={visibleStores} activeId={activeStoreId} onSelect={(id) => setActiveStoreId(id as number)}
              renderRow={(store, active) => {
                const rate    = store.summary.averageProgress;
                const pending = store.summary.pendingTasks + store.summary.inProgressTasks;
                const rejected = store.summary.rejectedTasks;
                return (
                  <>
                    <StoreIcon active={active} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{store.name}</p>
                        <span className={cn('shrink-0 text-xs font-bold tabular-nums', progressTextClass(rate))}>{rate}%</span>
                      </div>
                      <ProgressBar pct={rate} className="mt-1.5" />
                      <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
                        {store.summary.totalEmployees} karyawan
                        {pending  > 0 && <span className="text-amber-600"> · {pending} pending</span>}
                        {rejected > 0 && <span className="text-indigo-500"> · {rejected} ditolak</span>}
                      </p>
                    </div>
                  </>
                );
              }}
            />

            {/* Detail panel */}
            {activeStore ? (
              <GroomingDetail store={activeStore} />
            ) : (
              <EmptyDetail />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Grooming-specific detail ─────────────────────────────────────────────────

function GroomingDetail({ store }: { store: GroomingStoreRow }) {
  const rate    = store.summary.averageProgress;
  const done    = store.summary.completedTasks + store.summary.verifiedTasks;
  const pending = store.summary.pendingTasks + store.summary.inProgressTasks;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <DetailHeader
        name={store.name}
        address={store.address}
        ring={<ProgressRing pct={rate} size={64} stroke={6} />}
        meta={
          <p className="mt-1.5 text-xs font-semibold text-slate-600">
            <span className="text-indigo-600">{done} selesai</span>
            <span className="text-slate-300"> · </span>
            <span className={pending > 0 ? 'text-amber-600' : 'text-slate-400'}>{pending} pending</span>
            {store.summary.rejectedTasks > 0 && (
              <><span className="text-slate-300"> · </span><span className="text-indigo-500">{store.summary.rejectedTasks} ditolak</span></>
            )}
            <span className="text-slate-400"> dari {store.summary.totalEmployees}</span>
          </p>
        }
      />
      <div className="divide-y divide-slate-100">
        {store.tasks.length === 0
          ? <div className="p-8 text-center text-sm text-slate-500">Tidak ada task grooming dalam rentang ini.</div>
          : store.tasks.map(task => <EmployeeRow key={`${task.scheduleId}-${task.id ?? 'no-id'}`} task={task} />)
        }
      </div>
    </article>
  );
}

function EmployeeRow({ task }: { task: GroomingTaskRecord }) {
  const [expanded, setExpanded] = useState(false);
  const activeFields = task.fields.filter(f => f.active);
  const missing      = activeFields.filter(f => !f.done);
  const isDone       = task.progress >= 100;
  const initials     = task.employee.name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();

  return (
    <div>
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 sm:px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">
          {initials || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-bold text-slate-900">{task.employee.name}</p>
            <p className="truncate text-[11px] text-slate-500">
              {task.employee.employeeType?.label ?? 'Employee'}
              {task.shift?.label && <> · {task.shift.label}</>}
              <> · {formatDate(task.date)}</>
            </p>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {isDone ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                <CheckCircle2 className="h-3 w-3" />Semua selesai
              </span>
            ) : missing.length === 0 ? (
              <span className="text-[10px] font-semibold text-slate-400">Tidak ada item aktif</span>
            ) : (
              <>
                {missing.slice(0, 3).map(f => (
                  <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    <AlertCircle className="h-3 w-3" />{f.label}
                  </span>
                ))}
                {missing.length > 3 && <span className="text-[10px] font-semibold text-slate-500">+{missing.length - 3} lagi</span>}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <p className={cn('text-sm font-black tabular-nums', progressTextClass(task.progress))}>{task.progress}%</p>
            <p className="text-[10px] font-semibold text-slate-400">{task.completedFields}/{task.totalFields}</p>
          </div>
          <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-5">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {task.fields.map(field => (
              <div key={field.key} className={cn(
                'flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                !field.active && 'text-slate-400',
                field.active && field.done && 'text-indigo-700',
                field.active && !field.done && 'text-amber-700',
              )}>
                <span className="font-semibold">{field.label}</span>
                {!field.active ? <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">N/A</span>
                  : field.done ? <CheckCircle2 className="h-4 w-4 text-indigo-500" />
                  : <AlertCircle className="h-4 w-4 text-amber-500" />}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            {task.selfiePhotoCount > 0 && <span>{task.selfiePhotoCount} foto selfie</span>}
            {task.completedAt && <span>Selesai {formatDateTime(task.completedAt)}</span>}
            {task.verifiedAt && <span className="text-indigo-600">Diverifikasi {formatDateTime(task.verifiedAt)}</span>}
          </div>
          {task.notes && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              <span className="font-bold text-slate-800">Catatan:</span> {task.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shared OPS UI building blocks ────────────────────────────────────────────
// These are extracted so Store Opening and Setoran pages can import the same
// primitives and stay visually identical.

export function Toolbar({ period, date, storeId, search, storeOptions, onPeriod, onDate, onStore, onSearch }: {
  period: string; date: string; storeId: string; search: string;
  storeOptions: { id: number | string; name: string }[];
  onPeriod: (p: Period) => void; onDate: (d: string) => void;
  onStore: (s: string) => void; onSearch: (s: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[260px_180px_220px_1fr]">
      <div className="flex rounded-xl bg-slate-100 p-1">
        {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
          <button key={p} type="button" onClick={() => onPeriod(p)}
            className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-bold capitalize transition',
              period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {p}
          </button>
        ))}
      </div>
      <label className="relative block">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={date} onChange={e => onDate(e.target.value)} type="date"
          className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
      </label>
      <select value={storeId} onChange={e => onStore(e.target.value)}
        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
        <option value="all">Semua toko</option>
        {storeOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Cari toko atau karyawan…"
          className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
      </label>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-medium text-indigo-700">{message}</div>;
}

export function SummaryTile({ label, value, helper, accent, emphasis, warning }: {
  label: string; value: string | number; helper: string; accent?: string; emphasis?: boolean; warning?: boolean;
}) {
  if (emphasis) return (
    <div className="rounded-2xl border border-indigo-900 bg-indigo-950 p-4 text-white shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="mt-1 text-[11px] text-indigo-200">{helper}</p>
    </div>
  );
  return (
    <div className={cn('rounded-2xl border bg-white p-4 shadow-sm', warning ? 'border-amber-200 bg-amber-50' : 'border-slate-200')}>
      <div className="flex items-start justify-between">
        <p className={cn('text-[10px] font-bold uppercase tracking-widest', warning ? 'text-amber-700' : 'text-slate-400')}>{label}</p>
        {accent && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
      </div>
      <p className={cn('mt-2 text-3xl font-black', warning ? 'text-amber-900' : 'text-slate-900')}>{value}</p>
      <p className={cn('mt-1 text-[11px]', warning ? 'text-amber-700' : 'text-slate-500')}>{helper}</p>
    </div>
  );
}

export function FilterBar({ healthCounts, health, onHealth, sortOptions, sort, onSort }: {
  healthCounts: Record<HealthFilter, number>;
  health: HealthFilter; onHealth: (h: HealthFilter) => void;
  sortOptions: { value: string; label: string }[];
  sort: string; onSort: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-1.5">
        <HealthChip label="Semua" count={healthCounts.all}     active={health === 'all'}     onClick={() => onHealth('all')} />
        <HealthChip label="Selesai" count={healthCounts.done}  active={health === 'done'}    onClick={() => onHealth('done')}    color="indigo" />
        <HealthChip label="Pending" count={healthCounts.pending} active={health === 'pending'} onClick={() => onHealth('pending')} color="amber" />
        <HealthChip label="Masalah" count={healthCounts.issues} active={health === 'issues'}  onClick={() => onHealth('issues')}  color="indigo-soft" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Urutkan</span>
        <select value={sort} onChange={e => onSort(e.target.value)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
          {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

export function HealthChip({ label, count, active, onClick, color = 'indigo' }: {
  label: string; count: number; active: boolean; onClick: () => void;
  color?: 'indigo' | 'amber' | 'indigo-soft';
}) {
  const palette = {
    indigo:      { active: 'bg-indigo-600 text-white border-indigo-600',   idle: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200' },
    amber:       { active: 'bg-amber-500 text-white border-amber-500',      idle: 'bg-white text-slate-600 border-slate-200 hover:border-amber-200' },
    'indigo-soft': { active: 'bg-indigo-400 text-white border-indigo-400', idle: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-100' },
  };
  const { active: activeCls, idle } = palette[color];
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition', active ? activeCls : idle)}>
      {label}
      <span className={cn('rounded-full px-1.5 text-[10px] font-bold', active ? 'bg-white/20' : 'bg-slate-100 text-slate-600')}>{count}</span>
    </button>
  );
}

export function StoreIcon({ active }: { active: boolean }) {
  return (
    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>
      <Store className="h-4 w-4" />
    </div>
  );
}

export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all', progressBarClass(pct))} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StoreList<T extends { id: number | string; name: string }>({
  stores, activeId, onSelect, renderRow,
}: {
  stores: T[];
  activeId: number | string | null;
  onSelect: (id: number | string) => void;
  renderRow: (store: T, active: boolean) => React.ReactNode;
}) {
  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {stores.length} toko
      </div>
      <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
        {stores.map(store => {
          const active = store.id === activeId;
          return (
            <button key={store.id} type="button" onClick={() => onSelect(store.id)}
              className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition', active ? 'bg-indigo-50' : 'hover:bg-slate-50')}>
              {renderRow(store, active)}
              <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function DetailHeader({ name, address, ring, meta }: {
  name: string; address?: string | null;
  ring?: React.ReactNode; meta?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-slate-100 p-4 sm:p-5">
      {ring}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-bold text-slate-900">{name}</h2>
        {address && (
          <p className="mt-0.5 flex items-start gap-1.5 text-xs text-slate-500">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-1">{address}</span>
          </p>
        )}
        {meta}
      </div>
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
      <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
      <div className="h-[360px] animate-pulse rounded-2xl bg-slate-100" />
    </div>
  );
}

export function EmptyState({ icon, title, body }: { icon?: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      {icon}
      <h2 className="mt-3 text-base font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}

export function EmptyDetail() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
      Pilih toko untuk melihat detail task.
    </div>
  );
}

export function ProgressRing({ pct, size = 56, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r    = (size - stroke) / 2;
  const c    = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color = progressColor(pct);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" className="transition-all duration-300" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black tabular-nums" style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}
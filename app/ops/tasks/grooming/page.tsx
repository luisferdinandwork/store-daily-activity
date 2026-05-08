'use client';
// app/ops/tasks/grooming/page.tsx

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Store,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function statusLabel(status: Status): string {
  return { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', verified: 'Verified', rejected: 'Rejected', discrepancy: 'Discrepancy' }[status] ?? status;
}

function statusIcon(status: Status) {
  if (status === 'completed' || status === 'verified') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'rejected' || status === 'discrepancy') return <XCircle className="h-3.5 w-3.5" />;
  if (status === 'in_progress') return <Clock3 className="h-3.5 w-3.5" />;
  return <AlertCircle className="h-3.5 w-3.5" />;
}

function statusStyle(status: Status): string {
  if (status === 'completed' || status === 'verified') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'rejected' || status === 'discrepancy') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'in_progress') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function healthOf(store: GroomingStoreRow): HealthFilter {
  const s = store.summary;
  if (s.totalTasks === 0) return 'pending';
  if (s.rejectedTasks > 0) return 'issues';
  if (s.pendingTasks + s.inProgressTasks > 0) return 'pending';
  return 'done';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OpsGroomingPage() {
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(todayKey());
  const [storeId, setStoreId] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<GroomingMonitorResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthFilter>('all');
  const [sort, setSort] = useState<SortKey>('most_pending');
  const [activeStoreId, setActiveStoreId] = useState<number | null>(null);

  // ---- Data fetching ----

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, date, storeId });
      const res = await fetch(`/api/ops/tasks/grooming?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json() as GroomingMonitorResponse;
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || 'Failed to load Grooming monitor.');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Grooming monitor.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period, date, storeId]);

  // ---- Derived state ----

  const storeOptions = useMemo(() => (data?.availableStores ?? []).map((s) => ({ id: s.id, name: s.name })), [data?.availableStores]);

  const visibleStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data?.stores ?? [];

    if (q) {
      list = list
        .map((s) => ({
          ...s,
          tasks: s.tasks.filter((t) => {
            const vals = [s.name, t.employee.name, t.employee.email, t.employee.employeeType?.label, t.shift?.label, t.notes].join(' ').toLowerCase();
            return vals.includes(q);
          }),
        }))
        .filter((s) => s.tasks.length > 0 || s.name.toLowerCase().includes(q));
    }

    if (health !== 'all') {
      list = list.filter((s) => healthOf(s) === health);
    }

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name);
        case 'progress_low': return a.summary.averageProgress - b.summary.averageProgress;
        case 'progress_high': return b.summary.averageProgress - a.summary.averageProgress;
        case 'most_pending': {
          const pa = a.summary.pendingTasks + a.summary.inProgressTasks + a.summary.rejectedTasks;
          const pb = b.summary.pendingTasks + b.summary.inProgressTasks + b.summary.rejectedTasks;
          if (pb !== pa) return pb - pa;
          return a.name.localeCompare(b.name);
        }
      }
    });
  }, [data?.stores, search, health, sort]);

  useEffect(() => {
    if (visibleStores.length === 0) { setActiveStoreId(null); return; }
    if (!visibleStores.some((s) => s.id === activeStoreId)) setActiveStoreId(visibleStores[0].id);
  }, [visibleStores, activeStoreId]);

  const activeStore = visibleStores.find((s) => s.id === activeStoreId) ?? null;
  const summary = data?.summary;

  const healthCounts = useMemo(() => {
    const c = { all: 0, done: 0, pending: 0, issues: 0 };
    for (const s of data?.stores ?? []) { c.all += 1; c[healthOf(s)] += 1; }
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Ops · Task Monitor</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Grooming Monitor</h1>
              <p className="mt-1 text-sm text-slate-500">Monitor grooming per employee. Each scheduled employee has their own task and progress.</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* Toolbar */}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[260px_180px_220px_1fr]">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)} className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-bold capitalize transition', period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>{p}</button>
            ))}
          </div>
          <label className="relative block">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
            <option value="all">All stores</option>
            {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari toko, employee, role, atau shift…" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
        </div>

        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{error}</div>}

        {/* Summary tiles */}
        {summary && data && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryTile label="Avg Progress" value={`${summary.averageProgress}%`} helper={data.range.start && data.range.end ? `${data.range.start} – ${data.range.end}` : 'Selected range'} accent="#4f46e5" emphasis />
            <SummaryTile label="Stores" value={summary.totalStores} helper="Active stores" accent="#6366f1" />
            <SummaryTile label="Employees" value={summary.totalEmployees} helper="Scheduled staff" accent="#0ea5e9" />
            <SummaryTile label="Tasks" value={summary.totalTasks} helper={`${summary.completedTasks} completed`} accent="#10b981" />
            <SummaryTile label="Verified" value={summary.verifiedTasks} helper="Approved tasks" accent="#f59e0b" />
          </section>
        )}

        {/* Health filter + Sort */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <HealthChip label="All" count={healthCounts.all} active={health === 'all'} onClick={() => setHealth('all')} />
            <HealthChip label="Done" count={healthCounts.done} active={health === 'done'} onClick={() => setHealth('done')} color="emerald" />
            <HealthChip label="Pending" count={healthCounts.pending} active={health === 'pending'} onClick={() => setHealth('pending')} color="amber" />
            <HealthChip label="Issues" count={healthCounts.issues} active={health === 'issues'} onClick={() => setHealth('issues')} color="rose" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              <option value="most_pending">Most pending first</option>
              <option value="progress_low">Lowest progress</option>
              <option value="progress_high">Highest progress</option>
              <option value="name">Name (A→Z)</option>
            </select>
          </div>
        </div>

        {loading && (
          <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
            <div className="h-[360px] animate-pulse rounded-2xl bg-slate-100" />
          </div>
        )}

        {!loading && !error && visibleStores.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-base font-bold text-slate-900">No grooming tasks found</h2>
            <p className="mt-1 text-sm text-slate-500">Try a different date, period, filter, or search keyword.</p>
          </div>
        )}

        {!loading && visibleStores.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <StoreList stores={visibleStores} activeId={activeStoreId} onSelect={setActiveStoreId} />
            {activeStore ? <StoreDetail store={activeStore} /> : <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Select a store to see its tasks.</div>}
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SummaryTile({ label, value, helper, accent, emphasis, warning }: { label: string; value: string | number; helper: string; accent: string; emphasis?: boolean; warning?: boolean }) {
  if (emphasis) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4 text-white shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{label}</p>
        <p className="mt-2 text-2xl font-black">{value}</p>
        <p className="mt-1 text-[11px] text-slate-300">{helper}</p>
      </div>
    );
  }
  return (
    <div className={cn('rounded-2xl border bg-white p-4 shadow-sm', warning ? 'border-amber-200 bg-amber-50' : 'border-slate-200')}>
      <div className="flex items-start justify-between">
        <p className={cn('text-[10px] font-bold uppercase tracking-widest', warning ? 'text-amber-700' : 'text-slate-400')}>{label}</p>
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
      </div>
      <p className={cn('mt-2 text-2xl font-black', warning ? 'text-amber-900' : 'text-slate-900')}>{value}</p>
      <p className={cn('mt-1 text-[11px]', warning ? 'text-amber-700' : 'text-slate-500')}>{helper}</p>
    </div>
  );
}

function HealthChip({ label, count, active, onClick, color = 'indigo' }: { label: string; count: number; active: boolean; onClick: () => void; color?: 'indigo' | 'emerald' | 'amber' | 'rose' }) {
  const palette: Record<'indigo' | 'emerald' | 'amber' | 'rose', { active: string; idle: string }> = {
    indigo: { active: 'bg-indigo-600 text-white border-indigo-600', idle: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200' },
    emerald: { active: 'bg-emerald-500 text-white border-emerald-500', idle: 'bg-white text-slate-600 border-slate-200 hover:border-emerald-200' },
    amber: { active: 'bg-amber-500 text-white border-amber-500', idle: 'bg-white text-slate-600 border-slate-200 hover:border-amber-200' },
    rose: { active: 'bg-rose-500 text-white border-rose-500', idle: 'bg-white text-slate-600 border-slate-200 hover:border-rose-200' },
  };
  const { active: activeCls, idle } = palette[color];
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition', active ? activeCls : idle)}>
      {label}
      <span className={cn('rounded-full px-1.5 text-[10px] font-bold', active ? 'bg-white/20' : 'bg-slate-100 text-slate-600')}>{count}</span>
    </button>
  );
}

function StoreList({ stores, activeId, onSelect }: { stores: GroomingStoreRow[]; activeId: number | null; onSelect: (id: number) => void }) {
  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {stores.length} store{stores.length !== 1 ? 's' : ''}
      </div>
      <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
        {stores.map((store) => {
          const active = store.id === activeId;
          const rate = store.summary.averageProgress;
          const left = Math.max(0, store.summary.totalEmployees - store.summary.completedTasks);
          return (
            <button key={store.id} type="button" onClick={() => onSelect(store.id)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition', active ? 'bg-indigo-50' : 'hover:bg-slate-50')}>
              <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}><Store className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{store.name}</p>
                  <span className={cn('shrink-0 text-xs font-bold tabular-nums', rate >= 80 ? 'text-emerald-600' : rate >= 40 ? 'text-amber-600' : 'text-rose-600')}>{rate}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${rate}%` }} /></div>
                <div className="mt-1.5 flex items-center gap-2 text-[10px] font-semibold text-slate-500">
                  <span>{store.summary.totalEmployees} employees</span>
                  {left > 0 && <span className="text-amber-600">· {left} pending</span>}
                </div>
              </div>
              <ChevronRight className={cn('mt-2 h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function StoreDetail({ store }: { store: GroomingStoreRow }) {
  const rate = store.summary.averageProgress;
  const pending = store.summary.pendingTasks + store.summary.inProgressTasks;
  const rejected = store.summary.rejectedTasks;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Store className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{store.name}</h2>
            {store.address && <p className="mt-0.5 flex items-start gap-1.5 text-xs text-slate-500"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /><span className="line-clamp-2">{store.address}</span></p>}
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-2xl font-black text-slate-900 tabular-nums">{rate}%</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Avg Progress</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <Metric label="Done" value={store.summary.completedTasks + store.summary.verifiedTasks} accent="#10b981" />
          <Metric label="Pending" value={pending} accent="#f59e0b" />
          <Metric label="Rejected" value={rejected} accent="#ef4444" />
          <Metric label="Total" value={store.summary.totalEmployees} accent="#6366f1" />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${rate}%` }} /></div>
      </div>

      <div className="divide-y divide-slate-100">
        {store.tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No grooming tasks in this range.</div>
        ) : (
          store.tasks.map((task) => <GroomingTaskCard key={`${task.scheduleId}-${task.id}`} task={task} />)
        )}
      </div>
    </article>
  );
}

// Mock MapPin used above if not imported
function MapPin({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>;
}

function Metric({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
      </div>
      <p className="mt-1 text-lg font-black tabular-nums" style={{ color: accent }}>{value}</p>
    </div>
  );
}

function GroomingTaskCard({ task }: { task: GroomingTaskRecord }) {
  return (
    <div className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">{task.employee.name}</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{task.employee.employeeType?.label ?? 'Employee'}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{task.shift?.label ?? task.shift?.code ?? 'Shift'}</span>
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold', statusStyle(task.status))}>
              {statusIcon(task.status)} {statusLabel(task.status)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDate(task.date)}</span>
            <span className="inline-flex items-center gap-1"><UserCheck className="h-3.5 w-3.5" />{task.selfiePhotoCount} selfie photos</span>
            <span>Completed: {formatDateTime(task.completedAt)}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {task.fields.map((field) => (
              <div key={field.key} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs', !field.active ? 'border-slate-200 bg-slate-50 text-slate-400' : field.done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600')}>
                <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', !field.active ? 'bg-slate-200 text-slate-500' : field.done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500')}>
                  {field.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                </div>
                <span className="font-medium">{field.label}</span>
              </div>
            ))}
          </div>

          {task.notes && (
            <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              <span className="font-bold text-slate-800">Notes:</span> {task.notes}
            </div>
          )}
        </div>

        <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:w-48">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-500">Progress</span>
            <span className="text-lg font-black text-slate-900 tabular-nums">{task.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className={cn('h-full rounded-full transition-all', task.progress >= 100 ? 'bg-emerald-500' : task.progress >= 60 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${Math.max(0, Math.min(task.progress, 100))}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {task.completedFields}/{task.totalFields} items done
          </p>
        </div>
      </div>
    </div>
  );
}
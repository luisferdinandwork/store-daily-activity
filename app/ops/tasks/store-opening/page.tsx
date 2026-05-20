'use client';
// app/ops/tasks/store-opening/page.tsx

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  Store,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Re-use shared primitives from grooming page ──────────────────────────────
// In your project, extract these to a shared file like
// `app/ops/tasks/_shared/ui.tsx` and import from there.
// For this file they are inlined below.

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';
type Status = 'pending' | 'in_progress' | 'completed' | 'discrepancy';
type HealthFilter = 'all' | 'done' | 'pending' | 'issues';
type SortKey = 'name' | 'completion_low' | 'completion_high' | 'most_pending';
type Actor = { id: string; name: string | null; nik: string | null } | null;

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

// ─── Design tokens (same as grooming) ────────────────────────────────────────

function progressColor(pct: number): string {
  if (pct >= 80) return '#4f46e5';
  if (pct >= 40) return '#f59e0b';
  return '#6366f1';
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIELD_ORDER = [
  'loginPos','cashDrawer','checkAbsenSunfish','tarikSohSales','fiveR',
  'fiveRAreaKasir','fiveRAreaDepan','fiveRAreaKanan','fiveRAreaKiri','fiveRAreaGudang',
  'cekLamp','cekSoundSystem',
] as const;

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function actorName(actor: Actor) { return actor?.name || actor?.nik || actor?.id || '—'; }
function formatTime(v: string | null) { if (!v) return '—'; return new Date(v).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}); }
function formatDate(v: string | null) { if (!v) return '—'; return new Date(v).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}); }

function healthOf(g: StoreGroup): HealthFilter {
  const s = g.summary;
  if (s.total === 0) return 'pending';
  if (s.discrepancy > 0) return 'issues';
  if (s.completionRate < 100) return 'pending';
  return 'done';
}

function statusStyle(status: Status): string {
  return ({
    pending:     'bg-amber-50 text-amber-700 border-amber-200',
    in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    completed:   'bg-indigo-50 text-indigo-700 border-indigo-200',
    discrepancy: 'bg-amber-50 text-amber-800 border-amber-300',
  } as Record<Status, string>)[status] ?? 'bg-amber-50 text-amber-700 border-amber-200';
}

function statusIcon(status: Status) {
  if (status === 'completed')   return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'in_progress') return <Clock3 className="h-3.5 w-3.5" />;
  if (status === 'discrepancy') return <AlertCircle className="h-3.5 w-3.5" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsStoreOpeningMonitorPage() {
  const [period, setPeriod]               = useState<Period>('daily');
  const [date, setDate]                   = useState(todayInput());
  const [storeId, setStoreId]             = useState('all');
  const [query, setQuery]                 = useState('');
  const [loading, setLoading]             = useState(true);
  const [groups, setGroups]               = useState<StoreGroup[]>([]);
  const [range, setRange]                 = useState<{start:string;end:string}|null>(null);
  const [error, setError]                 = useState<string|null>(null);
  const [health, setHealth]               = useState<HealthFilter>('all');
  const [sort, setSort]                   = useState<SortKey>('most_pending');
  const [activeStoreId, setActiveStoreId] = useState<string|null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ period, date, storeId });
      const res  = await fetch(`/api/ops/tasks/store-opening?${params}`, { cache: 'no-store' });
      const json = await res.json() as ResponseShape;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load.');
      setGroups(json.data?.stores ?? json.stores ?? []);
      setRange(json.data?.range ?? json.range ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.'); setGroups([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period, date, storeId]);

  const storeOptions = useMemo(() => groups.map(g => ({ id: g.store.id, name: g.store.name })), [groups]);

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = groups;
    if (q) {
      list = list.map(g => ({
        ...g,
        tasks: g.tasks.filter(t =>
          g.store.name.toLowerCase().includes(q) ||
          actorName(t.completedBy).toLowerCase().includes(q) ||
          actorName(t.assignedUser).toLowerCase().includes(q) ||
          Object.values(t.fields).some(f => actorName(f.actor).toLowerCase().includes(q)),
        ),
      })).filter(g => g.tasks.length > 0 || g.store.name.toLowerCase().includes(q));
    }
    if (health !== 'all') list = list.filter(g => healthOf(g) === health);
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':            return a.store.name.localeCompare(b.store.name);
        case 'completion_low':  return a.summary.completionRate - b.summary.completionRate;
        case 'completion_high': return b.summary.completionRate - a.summary.completionRate;
        case 'most_pending': {
          const sa = a.summary.totalFields - a.summary.completedFields + a.summary.discrepancy;
          const sb = b.summary.totalFields - b.summary.completedFields + b.summary.discrepancy;
          return sb !== sa ? sb - sa : a.store.name.localeCompare(b.store.name);
        }
      }
    });
  }, [groups, query, health, sort]);

  useEffect(() => {
    if (!visibleGroups.length) { setActiveStoreId(null); return; }
    if (!visibleGroups.some(g => g.store.id === activeStoreId)) setActiveStoreId(visibleGroups[0].store.id);
  }, [visibleGroups, activeStoreId]);

  const activeGroup = visibleGroups.find(g => g.store.id === activeStoreId) ?? null;

  const totalFields     = groups.reduce((s, g) => s + g.summary.totalFields, 0);
  const completedFields = groups.reduce((s, g) => s + g.summary.completedFields, 0);
  const totalTasks      = groups.reduce((s, g) => s + g.summary.total, 0);
  const overallRate     = totalFields ? Math.round((completedFields / totalFields) * 100) : 0;

  const healthCounts = useMemo(() => {
    const c = { all: 0, done: 0, pending: 0, issues: 0 };
    for (const g of groups) { c.all++; c[healthOf(g)]++; }
    return c;
  }, [groups]);

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Ops · Task Monitor</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Store Opening</h1>
              <p className="mt-1 text-sm text-slate-500">Pantau setiap checklist Store Opening dan siapa yang menyelesaikannya.</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* ── Toolbar ── */}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[260px_180px_220px_1fr]">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(['daily','weekly','monthly'] as Period[]).map(p => (
              <button key={p} type="button" onClick={() => setPeriod(p)}
                className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-bold capitalize transition',
                  period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                {p}
              </button>
            ))}
          </div>
          <label className="relative block">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={date} onChange={e => setDate(e.target.value)} type="date"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          <select value={storeId} onChange={e => setStoreId(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
            <option value="all">Semua toko</option>
            {storeOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari toko atau karyawan…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
        </div>

        {error && <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-medium text-indigo-700">{error}</div>}

        {/* ── Summary tiles ── */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Emphasis tile — dark indigo */}
          <div className="rounded-2xl border border-indigo-900 bg-indigo-950 p-4 text-white shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">Progress</p>
            <p className="mt-2 text-3xl font-black">{overallRate}%</p>
            <p className="mt-1 text-[11px] text-indigo-200">{range ? `${range.start} – ${range.end}` : 'Rentang dipilih'}</p>
          </div>
          <StatTile label="Toko" value={groups.length} helper="Terlihat di areamu" />
          <StatTile label="Field Selesai" value={`${completedFields}/${totalFields}`} helper="Progres checklist" accent="#4f46e5" />
          <StatTile label="Perlu Tindakan" value={Math.max(0, totalFields - completedFields)} helper="Field belum selesai" accent="#f59e0b" warning />
        </section>

        {/* ── Filter + sort bar ── */}
        <FilterSortBar
          health={health} onHealth={setHealth} healthCounts={healthCounts}
          sort={sort} onSort={v => setSort(v as SortKey)}
          sortOptions={[
            { value: 'most_pending',   label: 'Field terbanyak pending' },
            { value: 'completion_low', label: 'Progress terendah' },
            { value: 'completion_high',label: 'Progress tertinggi' },
            { value: 'name',           label: 'Nama (A→Z)' },
          ]}
        />

        {loading && <LoadingSkeletonGrid />}

        {!loading && !error && visibleGroups.length === 0 && (
          <EmptyStatePanel icon={<Store className="mx-auto h-10 w-10 text-slate-300" />}
            title="Tidak ada toko yang cocok" body="Coba tanggal, periode, filter, atau kata kunci berbeda." />
        )}

        {!loading && visibleGroups.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            {/* Left: store list */}
            <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {visibleGroups.length} toko
              </div>
              <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
                {visibleGroups.map(group => {
                  const active = group.store.id === activeStoreId;
                  const rate   = group.summary.completionRate;
                  const left   = Math.max(0, group.summary.totalFields - group.summary.completedFields);
                  const hasIssue = group.summary.discrepancy > 0;
                  return (
                    <button key={group.store.id} type="button" onClick={() => setActiveStoreId(group.store.id)}
                      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition',
                        active ? 'bg-indigo-50' : 'hover:bg-slate-50')}>
                      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{group.store.name}</p>
                          <span className={cn('shrink-0 text-xs font-bold tabular-nums', progressTextClass(rate))}>{rate}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full transition-all', progressBarColor(rate))} style={{ width: `${rate}%` }} />
                        </div>
                        <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
                          {group.summary.completedFields}/{group.summary.totalFields} field
                          {left > 0 && <span className="text-amber-600"> · {left} sisa</span>}
                          {hasIssue && <span className="text-indigo-500"> · ada masalah</span>}
                        </p>
                      </div>
                      <ChevronRightIcon active={active} />
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Right: store detail */}
            {activeGroup ? (
              <StoreOpeningDetail group={activeGroup} />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                Pilih toko untuk melihat task-nya.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Store Opening detail ─────────────────────────────────────────────────────

function StoreOpeningDetail({ group }: { group: StoreGroup }) {
  const rate = group.summary.completionRate;
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <ProgressRingInline pct={rate} size={56} stroke={5} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{group.store.name}</h2>
            {group.store.address && (
              <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{group.store.address}</p>
            )}
            <p className="mt-1.5 text-xs font-semibold text-slate-600">
              <span className="text-indigo-600">{group.summary.completedFields} field selesai</span>
              <span className="text-slate-300"> · </span>
              <span className="text-slate-500">{group.summary.totalFields} total</span>
              {(group.summary.discrepancy) > 0 && (
                <><span className="text-slate-300"> · </span>
                <span className="text-indigo-400">{group.summary.discrepancy} masalah</span></>
              )}
            </p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', progressBarColor(rate))} style={{ width: `${rate}%` }} />
        </div>
      </div>

      {/* Task cards */}
      <div className="divide-y divide-slate-100">
        {group.tasks.length === 0
          ? <div className="p-8 text-center text-sm text-slate-500">Tidak ada task Store Opening dalam rentang ini.</div>
          : group.tasks.map(task => <StoreOpeningTaskCard key={task.id} task={task} />)
        }
      </div>
    </article>
  );
}

function StoreOpeningTaskCard({ task }: { task: StoreGroup['tasks'][number] }) {
  const fields = FIELD_ORDER.map(key => task.fields[key]).filter(Boolean);
  const done   = fields.filter(f => f.done).length;
  const total  = fields.length;

  return (
    <div className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize', statusStyle(task.status))}>
              {statusIcon(task.status)}{task.status.replace('_',' ')}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{formatDate(task.date)}</span>
            <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', done === total ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700')}>
              {done}/{total} field
            </span>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-900">Ditugaskan: {actorName(task.assignedUser)}</p>
          <p className="mt-0.5 text-xs text-slate-500">Diselesaikan: {actorName(task.completedBy)} · {formatTime(task.completedAt)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {fields.map(field => (
          <div key={field.label} className={cn('rounded-xl border p-3', field.done ? 'border-indigo-100 bg-indigo-50' : 'border-slate-200 bg-slate-50')}>
            <div className="flex items-start gap-2">
              <div className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                field.done ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500')}>
                {field.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-900">{field.label}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  <UserCheck className="mr-1 inline h-3 w-3" />{actorName(field.actor)} · {formatTime(field.at)}
                </p>
                {typeof field.photoCount === 'number' && (
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{field.photoCount} foto</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {task.notes && (
        <div className="mt-4 rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <span className="font-bold">Catatan:</span> {task.notes}
        </div>
      )}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StatTile({ label, value, helper, accent, warning }: { label: string; value: string|number; helper: string; accent?: string; warning?: boolean }) {
  return (
    <div className={cn('rounded-2xl border bg-white p-4 shadow-sm', warning ? 'border-amber-200 bg-amber-50' : 'border-slate-200')}>
      <div className="flex items-start justify-between">
        <p className={cn('text-[10px] font-bold uppercase tracking-widest', warning ? 'text-amber-700' : 'text-slate-400')}>{label}</p>
        {accent && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
      </div>
      <p className={cn('mt-2 text-2xl font-black', warning ? 'text-amber-900' : 'text-slate-900')}>{value}</p>
      <p className={cn('mt-1 text-[11px]', warning ? 'text-amber-700' : 'text-slate-500')}>{helper}</p>
    </div>
  );
}

function FilterSortBar({ health, onHealth, healthCounts, sort, onSort, sortOptions }: {
  health: HealthFilter; onHealth: (h: HealthFilter) => void;
  healthCounts: Record<HealthFilter, number>;
  sort: string; onSort: (s: string) => void;
  sortOptions: { value: string; label: string }[];
}) {
  const chips: { label: string; value: HealthFilter; color: string }[] = [
    { label: 'Semua',   value: 'all',     color: 'indigo' },
    { label: 'Selesai', value: 'done',    color: 'indigo-light' },
    { label: 'Pending', value: 'pending', color: 'amber' },
    { label: 'Masalah', value: 'issues',  color: 'indigo-soft' },
  ];
  const palette: Record<string, { a: string; i: string }> = {
    indigo:       { a: 'bg-indigo-600 text-white border-indigo-600',   i: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200' },
    'indigo-light':{ a: 'bg-indigo-500 text-white border-indigo-500', i: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-100' },
    amber:        { a: 'bg-amber-500 text-white border-amber-500',     i: 'bg-white text-slate-600 border-slate-200 hover:border-amber-200' },
    'indigo-soft':{ a: 'bg-indigo-300 text-white border-indigo-300',  i: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-100' },
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map(c => {
          const active = health === c.value;
          const p = palette[c.color];
          return (
            <button key={c.value} type="button" onClick={() => onHealth(c.value)}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition', active ? p.a : p.i)}>
              {c.label}
              <span className={cn('rounded-full px-1.5 text-[10px] font-bold', active ? 'bg-white/20' : 'bg-slate-100 text-slate-600')}>
                {healthCounts[c.value]}
              </span>
            </button>
          );
        })}
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

function LoadingSkeletonGrid() {
  return (
    <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
      <div className="space-y-2">{Array.from({length:8}).map((_,i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
      <div className="h-[360px] animate-pulse rounded-2xl bg-slate-100" />
    </div>
  );
}

function EmptyStatePanel({ icon, title, body }: { icon?: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      {icon}
      <h2 className="mt-3 text-base font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}

function ChevronRightIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ProgressRingInline({ pct, size, stroke }: { pct: number; size: number; stroke: number }) {
  const r    = (size - stroke) / 2;
  const c    = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color = pct >= 80 ? '#4f46e5' : pct >= 40 ? '#f59e0b' : '#6366f1';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" className="transition-all duration-300" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-black tabular-nums" style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}
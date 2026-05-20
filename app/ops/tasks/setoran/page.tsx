'use client';
// app/ops/tasks/setoran/page.tsx

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';
type HealthFilter = 'all' | 'done' | 'pending' | 'issues';
type SortKey = 'name' | 'unpaid_high' | 'completion_low' | 'completion_high';

type UserInfo = { id: string; name: string | null; email: string | null } | null;
type FieldActor = { user: UserInfo; at: string | null };
type AvailableStore = { id: string; name: string; areaId: number | null };

type SetoranMonitorTask = {
  id: string; scheduleId: string; date: string | null; status: string;
  completedAt: string | null; verifiedAt: string | null; notes: string | null;
  actualReceivedAmount: string | null; previousUnpaidAmount: string | null;
  requiredStoreAmount: string | null; storedAmount: string | null;
  unpaidAmount: string | null; resiPhoto: string | null; atmCardSelfiePhoto: string | null;
  assignedUser: UserInfo; completedUser: UserInfo;
  fieldActors: {
    actualReceivedAmount: FieldActor; storedAmount: FieldActor;
    resiPhoto: FieldActor; atmCardSelfiePhoto: FieldActor; notes: FieldActor;
  };
};

type StoreGroup = {
  storeId: string; storeName: string; areaId?: number | null;
  total: number; completed: number; verified: number; unpaidTotal: number;
  tasks: SetoranMonitorTask[];
};

type ApiResponse = {
  success: boolean; error?: string; period: Period; date: string;
  selectedStoreId?: string; availableStores?: AvailableStore[];
  summary: { stores: number; totalTasks: number; completed: number; verified: number; unpaidTotal: number };
  stores: StoreGroup[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function rupiah(v: string | number | null | undefined) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 'Rp 0';
  return `Rp ${n.toLocaleString('id-ID')}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
}
function fmtDateTime(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}
function userLabel(user: UserInfo) { return user?.name || user?.email || (user?.id ? `User ${user.id}` : '-'); }

function statusStyle(status: string) {
  if (status === 'verified')    return 'bg-indigo-100 text-indigo-800 border-indigo-200';
  if (status === 'completed')   return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (status === 'in_progress') return 'bg-indigo-50 text-indigo-600 border-indigo-100';
  if (status === 'rejected' || status === 'discrepancy') return 'bg-amber-50 text-amber-800 border-amber-300';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function healthOf(store: StoreGroup): HealthFilter {
  if (store.total === 0) return 'pending';
  if (store.tasks.some(t => t.status === 'rejected' || t.status === 'discrepancy')) return 'issues';
  if (store.completed + store.verified === store.total && store.unpaidTotal === 0) return 'done';
  return 'pending';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsSetoranMonitorPage() {
  const [period, setPeriod]               = useState<Period>('daily');
  const [date, setDate]                   = useState(todayInput());
  const [storeId, setStoreId]             = useState('all');
  const [search, setSearch]               = useState('');
  const [data, setData]                   = useState<ApiResponse | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [health, setHealth]               = useState<HealthFilter>('all');
  const [sort, setSort]                   = useState<SortKey>('unpaid_high');
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ period, date, storeId });
      const res  = await fetch(`/api/ops/tasks/setoran?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load.');
      setData(json);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period, date, storeId]);

  const availableStores = data?.availableStores ?? [];

  const visibleStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data?.stores ?? [];
    if (q) {
      list = list.map(store => ({
        ...store,
        tasks: store.tasks.filter(task => {
          const vals = [store.storeName, userLabel(task.completedUser), userLabel(task.assignedUser),
            userLabel(task.fieldActors.actualReceivedAmount.user), userLabel(task.fieldActors.storedAmount.user),
            userLabel(task.fieldActors.resiPhoto.user), userLabel(task.fieldActors.atmCardSelfiePhoto.user),
          ].join(' ').toLowerCase();
          return vals.includes(q);
        }),
      })).filter(s => s.tasks.length > 0);
    }
    if (health !== 'all') list = list.filter(s => healthOf(s) === health);
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':            return a.storeName.localeCompare(b.storeName);
        case 'completion_low':  return (a.completed + a.verified) - (b.completed + b.verified);
        case 'completion_high': return (b.completed + b.verified) - (a.completed + a.verified);
        case 'unpaid_high':
          return b.unpaidTotal !== a.unpaidTotal ? b.unpaidTotal - a.unpaidTotal : a.storeName.localeCompare(b.storeName);
      }
    });
  }, [data?.stores, search, health, sort]);

  useEffect(() => {
    if (!visibleStores.length) { setActiveStoreId(null); return; }
    if (!visibleStores.some(s => s.storeId === activeStoreId)) setActiveStoreId(visibleStores[0].storeId);
  }, [visibleStores, activeStoreId]);

  const activeStore = visibleStores.find(s => s.storeId === activeStoreId) ?? null;
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
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Setoran Penjualan</h1>
              <p className="mt-1 text-sm text-slate-500">Pantau nominal setoran, sisa unpaid, dan siapa yang mengisi tiap field.</p>
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
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[200px_180px_200px_1fr]">
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
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          <select value={storeId} onChange={e => setStoreId(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
            <option value="all">Semua toko</option>
            {availableStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari toko atau karyawan…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
        </div>

        {error && <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-medium text-indigo-700">{error}</div>}

        {/* ── Summary tiles ── */}
        {data && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-indigo-900 bg-indigo-950 p-4 text-white shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">Total Task</p>
              <p className="mt-2 text-3xl font-black">{summary?.totalTasks ?? 0}</p>
              <p className="mt-1 text-[11px] text-indigo-200">{summary?.completed ?? 0} diselesaikan</p>
            </div>
            <StatTile label="Selesai" value={`${(summary?.completed ?? 0) + (summary?.verified ?? 0)}/${summary?.totalTasks ?? 0}`}
              helper={`${summary?.verified ?? 0} diverifikasi`} accent="#4f46e5" />
            <StatTile label="Toko" value={summary?.stores ?? 0} helper="Toko aktif" accent="#6366f1" />
            <StatTile label="Total Unpaid" value={rupiah(summary?.unpaidTotal)} helper="Carry-forward"
              accent="#f59e0b" warning={(summary?.unpaidTotal ?? 0) > 0} />
          </section>
        )}

        {/* ── Filter + sort ── */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { label: 'Semua',   value: 'all'     as HealthFilter, cls: { a: 'bg-indigo-600 text-white border-indigo-600',   i: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200' } },
              { label: 'Lunas',   value: 'done'    as HealthFilter, cls: { a: 'bg-indigo-500 text-white border-indigo-500',   i: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-100' } },
              { label: 'Pending', value: 'pending' as HealthFilter, cls: { a: 'bg-amber-500 text-white border-amber-500',     i: 'bg-white text-slate-600 border-slate-200 hover:border-amber-200'  } },
              { label: 'Masalah', value: 'issues'  as HealthFilter, cls: { a: 'bg-indigo-300 text-white border-indigo-300',   i: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-100' } },
            ].map(c => (
              <button key={c.value} type="button" onClick={() => setHealth(c.value)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition', health === c.value ? c.cls.a : c.cls.i)}>
                {c.label}
                <span className={cn('rounded-full px-1.5 text-[10px] font-bold', health === c.value ? 'bg-white/20' : 'bg-slate-100 text-slate-600')}>
                  {healthCounts[c.value]}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Urutkan</span>
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              <option value="unpaid_high">Unpaid terbesar</option>
              <option value="completion_low">Completion terendah</option>
              <option value="completion_high">Completion tertinggi</option>
              <option value="name">Nama (A→Z)</option>
            </select>
          </div>
        </div>

        {loading && (
          <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
            <div className="space-y-2">{Array.from({length:8}).map((_,i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
            <div className="h-[360px] animate-pulse rounded-2xl bg-slate-100" />
          </div>
        )}

        {!loading && !error && visibleStores.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Wallet className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-base font-bold text-slate-900">Tidak ada task Setoran</h2>
            <p className="mt-1 text-sm text-slate-500">Coba tanggal, periode, atau kata kunci berbeda.</p>
          </div>
        )}

        {!loading && visibleStores.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            {/* ── Store list ── */}
            <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {visibleStores.length} toko
              </div>
              <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
                {visibleStores.map(store => {
                  const active      = store.storeId === activeStoreId;
                  const hasUnpaid   = store.unpaidTotal > 0;
                  const completedCt = store.completed + store.verified;
                  const left        = Math.max(0, store.total - completedCt);
                  const pct         = store.total > 0 ? Math.round((completedCt / store.total) * 100) : 0;
                  return (
                    <button key={store.storeId} type="button" onClick={() => setActiveStoreId(store.storeId)}
                      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition', active ? 'bg-indigo-50' : 'hover:bg-slate-50')}>
                      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>
                        <Wallet className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{store.storeName}</p>
                          <span className={cn('shrink-0 text-xs font-bold tabular-nums', hasUnpaid ? 'text-amber-600' : 'text-indigo-600')}>
                            {hasUnpaid ? rupiah(store.unpaidTotal) : 'Lunas'}
                          </span>
                        </div>
                        {/* Progress bar — completion rate */}
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-indigo-600' : pct > 0 ? 'bg-indigo-400' : 'bg-slate-200')}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
                          {completedCt}/{store.total} selesai
                          {left > 0 && <span className="text-amber-600"> · {left} pending</span>}
                        </p>
                      </div>
                      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* ── Store detail ── */}
            {activeStore ? (
              <SetoranDetail store={activeStore} />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                Pilih toko untuk melihat detail task.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Setoran detail ───────────────────────────────────────────────────────────

function SetoranDetail({ store }: { store: StoreGroup }) {
  const completedCt = store.completed + store.verified;
  const pending     = Math.max(0, store.total - completedCt);
  const rejected    = store.tasks.filter(t => t.status === 'rejected' || t.status === 'discrepancy').length;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{store.storeName}</h2>
          </div>
          <div className="hidden text-right sm:block">
            <p className={cn('text-2xl font-black tabular-nums', store.unpaidTotal > 0 ? 'text-amber-700' : 'text-indigo-700')}>
              {store.unpaidTotal > 0 ? rupiah(store.unpaidTotal) : 'Lunas'}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total Unpaid</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <MiniMetric label="Selesai"  value={completedCt} color="#4f46e5" />
          <MiniMetric label="Pending"  value={pending}     color="#f59e0b" />
          <MiniMetric label="Masalah"  value={rejected}    color="#6366f1" />
          <MiniMetric label="Total"    value={store.total} color="#64748b" />
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {store.tasks.length === 0
          ? <div className="p-8 text-center text-sm text-slate-500">Tidak ada task Setoran dalam rentang yang dipilih.</div>
          : store.tasks.map(task => <SetoranTaskRow key={task.id} task={task} />)
        }
      </div>
    </article>
  );
}

function SetoranTaskRow({ task }: { task: SetoranMonitorTask }) {
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize', statusStyle(task.status))}>
              {task.status.replace('_', ' ')}
            </span>
            {Number(task.unpaidAmount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                <AlertTriangle className="h-3 w-3" /> Unpaid {rupiah(task.unpaidAmount)}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-bold text-slate-900">{fmtDate(task.date)}</p>
          <p className="mt-0.5 text-xs text-slate-500">Diselesaikan: {userLabel(task.completedUser)}</p>
        </div>

        {/* Money grid */}
        <div className="grid grid-cols-2 gap-2 text-right text-xs sm:min-w-[320px]">
          <MoneyPill label="Diterima"   value={task.actualReceivedAmount} />
          <MoneyPill label="Disimpan"   value={task.storedAmount} />
          <MoneyPill label="Prev Unpaid" value={task.previousUnpaidAmount} />
          <MoneyPill label="Unpaid"     value={task.unpaidAmount} danger={Number(task.unpaidAmount ?? 0) > 0} />
        </div>
      </div>

      {/* Field actors */}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        <FieldActorLine label="Jumlah diterima"  actor={task.fieldActors.actualReceivedAmount} />
        <FieldActorLine label="Jumlah disimpan"  actor={task.fieldActors.storedAmount} />
        <FieldActorLine label="Foto resi"         actor={task.fieldActors.resiPhoto} />
        <FieldActorLine label="Selfie ATM"        actor={task.fieldActors.atmCardSelfiePhoto} />
        <FieldActorLine label="Catatan"           actor={task.fieldActors.notes} />
      </div>

      {/* Photo links */}
      <div className="grid gap-2 sm:grid-cols-2">
        <PhotoLink label="Resi"      url={task.resiPhoto} />
        <PhotoLink label="ATM Selfie" url={task.atmCardSelfiePhoto} />
      </div>

      {task.notes && (
        <div className="rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <span className="font-bold">Catatan:</span> {task.notes}
        </div>
      )}
    </div>
  );
}

// ─── Atoms ────────────────────────────────────────────────────────────────────

function StatTile({ label, value, helper, accent, warning }: {
  label: string; value: string | number; helper: string; accent?: string; warning?: boolean;
}) {
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

function MiniMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      </div>
      <p className="mt-1 text-lg font-black tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

function MoneyPill({ label, value, danger }: { label: string; value: string | null | undefined; danger?: boolean }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2', danger ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50')}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-sm font-black', danger ? 'text-amber-900' : 'text-slate-900')}>{rupiah(value)}</p>
    </div>
  );
}

function FieldActorLine({ label, actor }: { label: string; actor: FieldActor }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="text-right">
        <p className="text-xs font-bold text-slate-900">{userLabel(actor.user)}</p>
        <p className="text-[10px] text-slate-400">{fmtDateTime(actor.at)}</p>
      </div>
    </div>
  );
}

function PhotoLink({ label, url }: { label: string; url: string | null }) {
  if (!url) return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-400">
      <Receipt className="h-4 w-4" /> {label}: tidak ada foto
    </div>
  );
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-600 transition hover:bg-indigo-100 hover:text-indigo-800">
      <Receipt className="h-4 w-4" /> Buka {label}
    </a>
  );
}
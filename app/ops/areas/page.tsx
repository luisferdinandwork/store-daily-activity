'use client';
// app/ops/areas/page.tsx — OPS HO only.
//
// "Area Management": the org-chart layer above individual stores.
//   • Monitoring — today's task completion + attendance, rolled up per area
//     (reuses the same per-store stats /ops/stores already computes).
//   • Settings   — rename an area, assign the one OPS Area user responsible
//     for it (1:1), and move stores between areas.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  MapPinned, ClipboardCheck, UserCheck, Users, Store, Loader2, Shield,
  ChevronDown, Plus, Pencil, Check, X, UserX, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import type { AreaGroup } from '@/app/api/ops/stores/route';
import type { AreaSettingsRow, OpsAreaUserRow } from '@/app/api/ops/areas/route';

// ─── Auth guard ───────────────────────────────────────────────────────────────

function useIsOpsHo() {
  const { data: session } = useSession();
  return session?.user?.isOpsHo === true || session?.user?.role === 'it';
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

type Tab = 'monitoring' | 'settings';

function rateColor(rate: number, total: number) {
  if (total === 0) return { text: 'text-slate-400', bar: 'bg-slate-300', bg: 'bg-slate-50' };
  if (rate >= 80) return { text: 'text-emerald-600', bar: 'bg-emerald-500', bg: 'bg-emerald-50' };
  if (rate >= 50) return { text: 'text-amber-600', bar: 'bg-amber-400', bg: 'bg-amber-50' };
  return { text: 'text-rose-600', bar: 'bg-rose-500', bg: 'bg-rose-50' };
}

function MiniBar({ pct }: { pct: number }) {
  const c = rateColor(pct, 1);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn('h-full rounded-full transition-all', c.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ─── Monitoring tab ─────────────────────────────────────────────────────────

interface AreaRollup {
  id: number;
  name: string;
  storeCount: number;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  scheduled: number;
  present: number;
  attendanceRate: number;
  stores: AreaGroup['stores'];
}

function rollupArea(group: AreaGroup): AreaRollup {
  let totalTasks = 0, completedTasks = 0, scheduled = 0, present = 0;
  for (const s of group.stores) {
    totalTasks += s.taskStats.total;
    completedTasks += s.taskStats.completed;
    scheduled += s.attendanceSummary.scheduled;
    present += s.attendanceSummary.present;
  }
  return {
    id: group.id,
    name: group.name,
    storeCount: group.stores.length,
    totalTasks,
    completedTasks,
    completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    scheduled,
    present,
    attendanceRate: scheduled > 0 ? Math.round((present / scheduled) * 100) : 0,
    stores: group.stores,
  };
}

function AreaMonitorCard({ area }: { area: AreaRollup }) {
  const [expanded, setExpanded] = useState(false);
  const taskColor = rateColor(area.completionRate, area.totalTasks);
  const attColor = rateColor(area.attendanceRate, area.scheduled);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-4 p-4 text-left hover:bg-slate-50"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <MapPinned className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-slate-900">{area.name}</p>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
              {area.storeCount} toko
            </span>
          </div>

          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <span className="flex items-center gap-1"><ClipboardCheck className="h-3 w-3" /> Task</span>
                <span className={taskColor.text}>{area.completionRate}%</span>
              </div>
              <div className="mt-1"><MiniBar pct={area.completionRate} /></div>
              <p className="mt-0.5 text-[10px] text-slate-400">{area.completedTasks}/{area.totalTasks} selesai</p>
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" /> Kehadiran</span>
                <span className={attColor.text}>{area.attendanceRate}%</span>
              </div>
              <div className="mt-1"><MiniBar pct={area.attendanceRate} /></div>
              <p className="mt-0.5 text-[10px] text-slate-400">{area.present}/{area.scheduled} hadir</p>
            </div>
          </div>
        </div>

        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {area.stores.length === 0 ? (
            <p className="p-4 text-center text-xs text-slate-400">Belum ada toko di area ini.</p>
          ) : area.stores.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <Store className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{s.name}</p>
              <span className={cn('shrink-0 text-[11px] font-bold tabular-nums', rateColor(s.taskStats.completionRate, s.taskStats.total).text)}>
                {s.taskStats.completionRate}%
              </span>
              <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                {s.attendanceSummary.present}/{s.attendanceSummary.scheduled} hadir
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MonitoringView({ groups, loading }: { groups: AreaGroup[]; loading: boolean }) {
  const rollups = useMemo(() => groups.map(rollupArea), [groups]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />)}
      </div>
    );
  }

  if (rollups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
        <MapPinned className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada area</p>
        <p className="mt-1 text-xs text-slate-400">Buat area di tab Settings untuk mulai memantau.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rollups.map((a) => <AreaMonitorCard key={a.id} area={a} />)}
    </div>
  );
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function AssignOpsUserControl({
  area, opsUsers, saving, onAssign,
}: {
  area: AreaSettingsRow;
  opsUsers: OpsAreaUserRow[];
  saving: boolean;
  onAssign: (userId: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <UserCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <select
        value={area.opsUser?.id ?? ''}
        disabled={saving}
        onChange={(e) => onAssign(e.target.value || null)}
        className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none disabled:opacity-60"
      >
        <option value="">— Belum ditugaskan —</option>
        {opsUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.nik}){u.areaId != null && u.areaId !== area.id ? ` · saat ini: ${u.areaName}` : ''}
          </option>
        ))}
      </select>
      {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />}
    </div>
  );
}

function StoreMoveRow({
  store, areas, saving, onMove,
}: {
  store: AreaSettingsRow['stores'][number];
  areas: AreaSettingsRow[];
  saving: boolean;
  onMove: (newAreaId: number) => void;
}) {
  const currentAreaId = areas.find((a) => a.stores.some((s) => s.id === store.id))?.id;
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <Store className="h-3.5 w-3.5 shrink-0 text-slate-300" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-700">{store.name}</p>
        <p className="truncate text-[10px] text-slate-400 font-mono">{store.storeNo}</p>
      </div>
      <select
        value={currentAreaId ?? ''}
        disabled={saving}
        onChange={(e) => onMove(Number(e.target.value))}
        className="h-7 shrink-0 rounded-lg border border-slate-200 bg-white px-1.5 text-[10px] font-semibold text-slate-600 focus:border-indigo-400 focus:outline-none disabled:opacity-60"
      >
        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </div>
  );
}

function NewAreaForm({ onCreate, creating }: { onCreate: (name: string) => void; creating: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 py-3 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
      >
        <Plus className="h-3.5 w-3.5" /> Area baru
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nama area (mis. Jawa Tengah)"
        className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); setOpen(false); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button
        type="button"
        disabled={!name.trim() || creating}
        onClick={() => { onCreate(name.trim()); setName(''); setOpen(false); }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white disabled:opacity-50"
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function AreaSettingsCard({
  area, allAreas, opsUsers, busy, onRename, onAssign, onMoveStore,
}: {
  area: AreaSettingsRow;
  allAreas: AreaSettingsRow[];
  opsUsers: OpsAreaUserRow[];
  busy: Set<string>;
  onRename: (id: number, name: string) => void;
  onAssign: (id: number, userId: string | null) => void;
  onMoveStore: (storeId: number, newAreaId: number) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(area.name);
  const [storesOpen, setStoresOpen] = useState(false);

  const savingRename = busy.has(`rename:${area.id}`);
  const savingAssign = busy.has(`assign:${area.id}`);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <MapPinned className="h-4.5 w-4.5" />
        </div>

        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-indigo-300 bg-white px-2 text-sm font-bold text-slate-900 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameDraft.trim()) { onRename(area.id, nameDraft.trim()); setEditingName(false); }
                  if (e.key === 'Escape') { setNameDraft(area.name); setEditingName(false); }
                }}
              />
              <button
                type="button"
                onClick={() => { if (nameDraft.trim()) { onRename(area.id, nameDraft.trim()); setEditingName(false); } }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white"
              >
                {savingRename ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-bold text-slate-900">{area.name}</p>
              <button
                type="button"
                onClick={() => { setNameDraft(area.name); setEditingName(true); }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}
          <p className="mt-0.5 text-[11px] text-slate-400">{area.storeCount} toko</p>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">OPS Area bertanggung jawab</p>
        <AssignOpsUserControl
          area={area}
          opsUsers={opsUsers}
          saving={savingAssign}
          onAssign={(userId) => onAssign(area.id, userId)}
        />
        {!area.opsUser && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-amber-600">
            <UserX className="h-3 w-3" /> Belum ada OPS Area yang bertanggung jawab
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setStoresOpen((v) => !v)}
        className="mt-3 flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"
      >
        <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Toko di area ini</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', storesOpen && 'rotate-180')} />
      </button>

      {storesOpen && (
        <div className="mt-1.5 divide-y divide-slate-100 rounded-xl border border-slate-100 px-2">
          {area.stores.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-slate-400">Belum ada toko.</p>
          ) : area.stores.map((s) => (
            <StoreMoveRow
              key={s.id}
              store={s}
              areas={allAreas}
              saving={busy.has(`store:${s.id}`)}
              onMove={(newAreaId) => onMoveStore(s.id, newAreaId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsView({
  areasData, opsUsers, loading, busy, search, onSearch,
  onCreateArea, creatingArea, onRename, onAssign, onMoveStore,
}: {
  areasData: AreaSettingsRow[];
  opsUsers: OpsAreaUserRow[];
  loading: boolean;
  busy: Set<string>;
  search: string;
  onSearch: (v: string) => void;
  onCreateArea: (name: string) => void;
  creatingArea: boolean;
  onRename: (id: number, name: string) => void;
  onAssign: (id: number, userId: string | null) => void;
  onMoveStore: (storeId: number, newAreaId: number) => void;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return areasData;
    return areasData.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.opsUser?.name.toLowerCase().includes(q) ||
      a.stores.some((s) => s.name.toLowerCase().includes(q)),
    );
  }, [areasData, search]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-slate-100" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Cari area, toko, atau OPS…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((a) => (
          <AreaSettingsCard
            key={a.id}
            area={a}
            allAreas={areasData}
            opsUsers={opsUsers}
            busy={busy}
            onRename={onRename}
            onAssign={onAssign}
            onMoveStore={onMoveStore}
          />
        ))}
      </div>

      <NewAreaForm onCreate={onCreateArea} creating={creatingArea} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsAreasPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isOpsHo = useIsOpsHo();

  const [tab, setTab] = useState<Tab>('monitoring');
  const [monitorGroups, setMonitorGroups] = useState<AreaGroup[]>([]);
  const [settingsAreas, setSettingsAreas] = useState<AreaSettingsRow[]>([]);
  const [opsUsers, setOpsUsers] = useState<OpsAreaUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [creatingArea, setCreatingArea] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOpsHo) router.replace('/ops');
  }, [authStatus, session, isOpsHo, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [storesRes, areasRes] = await Promise.all([
        fetch('/api/ops/stores', { cache: 'no-store' }),
        fetch('/api/ops/areas', { cache: 'no-store' }),
      ]);
      const storesJson = await storesRes.json();
      const areasJson = await areasRes.json();

      if (!storesRes.ok || !storesJson.success) throw new Error(storesJson.error ?? 'Failed to load monitoring data');
      if (!areasRes.ok || !areasJson.success) throw new Error(areasJson.error ?? 'Failed to load areas');

      setMonitorGroups(storesJson.data);
      setSettingsAreas(areasJson.areas);
      setOpsUsers(areasJson.opsUsers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load area data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOpsHo) void load(); }, [isOpsHo, load]);

  function withBusy<T>(key: string, fn: () => Promise<T>) {
    setBusy((cur) => new Set(cur).add(key));
    return fn().finally(() => setBusy((cur) => { const next = new Set(cur); next.delete(key); return next; }));
  }

  async function handleCreateArea(name: string) {
    setCreatingArea(true);
    try {
      const res = await fetch('/api/ops/areas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to create area');
      toast.success(`Area "${name}" dibuat`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat area');
    } finally {
      setCreatingArea(false);
    }
  }

  async function handleRename(id: number, name: string) {
    const prev = settingsAreas;
    setSettingsAreas((cur) => cur.map((a) => (a.id === id ? { ...a, name } : a)));
    await withBusy(`rename:${id}`, async () => {
      try {
        const res = await fetch(`/api/ops/areas/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to rename area');
        toast.success('Nama area diperbarui');
      } catch (e) {
        setSettingsAreas(prev);
        toast.error(e instanceof Error ? e.message : 'Gagal mengubah nama area');
      }
    });
  }

  async function handleAssign(areaId: number, userId: string | null) {
    const prev = settingsAreas;
    const prevOpsUsers = opsUsers;

    await withBusy(`assign:${areaId}`, async () => {
      try {
        const res = await fetch(`/api/ops/areas/${areaId}/assign`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to assign');
        toast.success(userId ? 'OPS Area ditugaskan' : 'Penugasan dihapus');
        await load(); // simplest correct way to reflect the 1:1 displacement everywhere
      } catch (e) {
        setSettingsAreas(prev);
        setOpsUsers(prevOpsUsers);
        toast.error(e instanceof Error ? e.message : 'Gagal menugaskan OPS Area');
      }
    });
  }

  async function handleMoveStore(storeId: number, newAreaId: number) {
    await withBusy(`store:${storeId}`, async () => {
      try {
        const res = await fetch(`/api/ops/stores/${storeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ areaId: newAreaId }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to move store');
        toast.success('Toko dipindahkan');
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal memindahkan toko');
      }
    });
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isOpsHo) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS HO can manage areas.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Head Office"
        title="Area Management"
        subtitle={`${settingsAreas.length} area · ${settingsAreas.reduce((n, a) => n + a.storeCount, 0)} toko`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <div className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5">
          {([
            { id: 'monitoring' as const, label: 'Monitoring', icon: ClipboardCheck },
            { id: 'settings' as const, label: 'Settings', icon: MapPinned },
          ]).map((t) => {
            const active = t.id === tab;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition',
                  active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'monitoring' ? (
          <MonitoringView groups={monitorGroups} loading={loading} />
        ) : (
          <SettingsView
            areasData={settingsAreas}
            opsUsers={opsUsers}
            loading={loading}
            busy={busy}
            search={search}
            onSearch={setSearch}
            onCreateArea={handleCreateArea}
            creatingArea={creatingArea}
            onRename={handleRename}
            onAssign={handleAssign}
            onMoveStore={handleMoveStore}
          />
        )}
      </div>
    </div>
  );
}

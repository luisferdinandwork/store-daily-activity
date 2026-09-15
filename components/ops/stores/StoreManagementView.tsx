'use client';
// components/ops/stores/StoreManagementView.tsx
//
// Shared body of the Stores overview/management page. Self-fetching —
// mounted by both app/ops/stores/page.tsx (OPS) and app/it/stores/page.tsx
// (IT); each page supplies its own header chrome, this component owns
// everything below that.
//
// Layout:
//   • Summary pills at the top (stores, tasks done, completion %, present)
//   • Color legend
//   • One collapsible section per area
//     └─ Table of stores — click a row → accordion with employee roster
//        (IT can assign/unassign employees & ops accounts to a store here)
//
// Color system (task completion %):
//   green  ≥ 80%   on track
//   yellow 50–79%  in progress
//   red    < 50%   behind
//   gray   no tasks assigned yet

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Store,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader } from '@/components/ui/sheet';
import StoreEditSheet from '@/components/ops/stores/StoreEditSheet';
import { cn } from '@/lib/utils';
import type { AreaGroup, EmployeeRow, StoreRow, TaskColorStatus } from '@/app/api/ops/stores/route';

type EditState =
  | { mode: 'create'; fixedAreaId?: number }
  | { mode: 'edit'; store: StoreRow };

interface AssignableUser {
  id: string;
  nik: string;
  name: string;
  isActive: boolean;
  roleLabel: string;
  employeeTypeLabel: string | null;
  homeStoreId: number | null;
  storeName: string | null;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const COLOR: Record<
  TaskColorStatus,
  {
    swatch: string;
    bar: string;
    badge: string;
    text: string;
    label: string;
    range: string;
  }
> = {
  green: {
    swatch: 'bg-emerald-500',
    bar:    'bg-emerald-500',
    badge:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
    text:   'text-emerald-600',
    label:  'On track',
    range:  '≥ 80%',
  },
  yellow: {
    swatch: 'bg-amber-400',
    bar:    'bg-amber-400',
    badge:  'bg-amber-50 text-amber-700 ring-amber-200',
    text:   'text-amber-600',
    label:  'In progress',
    range:  '50–79%',
  },
  red: {
    swatch: 'bg-rose-500',
    bar:    'bg-rose-500',
    badge:  'bg-rose-50 text-rose-700 ring-rose-200',
    text:   'text-rose-600',
    label:  'Behind',
    range:  '< 50%',
  },
  gray: {
    swatch: 'bg-slate-300',
    bar:    'bg-slate-200',
    badge:  'bg-slate-50 text-slate-400 ring-slate-200',
    text:   'text-slate-400',
    label:  'No tasks',
    range:  '—',
  },
};

const ATTENDANCE_BADGE: Record<string, string> = {
  present:       'bg-emerald-50 text-emerald-700 ring-emerald-200',
  late:          'bg-amber-50 text-amber-700 ring-amber-200',
  absent:        'bg-rose-50 text-rose-700 ring-rose-200',
  off:           'bg-slate-100 text-slate-500 ring-slate-200',
  not_scheduled: 'bg-slate-50 text-slate-400 ring-slate-200',
};

const ATTENDANCE_DOT: Record<string, string> = {
  present:       'bg-emerald-500',
  late:          'bg-amber-400',
  absent:        'bg-rose-500',
  off:           'bg-slate-300',
  not_scheduled: 'border border-dashed border-slate-300',
};

// ─── Small presentational helpers ────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function cash(raw: string) {
  const n = Number(raw);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('id-ID', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

function ProgressBar({ rate, status }: { rate: number; status: TaskColorStatus }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', COLOR[status].bar)}
          style={{ width: `${rate}%` }}
        />
      </div>
      <span className={cn('w-9 shrink-0 text-right text-xs font-bold tabular-nums', COLOR[status].text)}>
        {rate}%
      </span>
    </div>
  );
}

// ─── Assign employee/ops to store (IT-only) ──────────────────────────────────

function AssignEmployeeSheet({
  store, currentEmployeeIds, onClose, onAssigned,
}: {
  store: StoreRow;
  currentEmployeeIds: Set<string>;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/it/users', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to load users.');
      setUsers(data.users ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const assignable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => u.isActive && !currentEmployeeIds.has(u.id))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.nik.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, search, currentEmployeeIds]);

  async function handleAssign(userId: string) {
    setAssigningId(userId);
    try {
      const res = await fetch(`/api/it/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeStoreId: store.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to assign user.');
      toast.success('User assigned to this store.');
      onAssigned();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign user.');
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-indigo-500" />
            Assign to {store.name}
          </SheetTitle>
          <SheetDescription>Pick an active user to make this their home store.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or NIK…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>

          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
          ) : assignable.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No matching active users.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {assignable.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  disabled={assigningId === u.id}
                  onClick={() => handleAssign(u.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-indigo-50/60 disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{u.name}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {u.nik} · {u.roleLabel}{u.employeeTypeLabel ? ` · ${u.employeeTypeLabel}` : ''}
                      {u.storeName ? ` · currently: ${u.storeName}` : ''}
                    </p>
                  </div>
                  {assigningId === u.id
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-400" />
                    : <UserPlus className="h-4 w-4 shrink-0 text-slate-300" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Employee roster (accordion content) ─────────────────────────────────────

function EmployeeRoster({
  store, employees, isIt, onAssignClick, onRemove, removingId,
}: {
  store: StoreRow;
  employees: EmployeeRow[];
  isIt: boolean;
  onAssignClick: () => void;
  onRemove: (userId: string) => void;
  removingId: string | null;
}) {
  return (
    <tr>
      <td colSpan={7} className="p-0">
        <div className="border-t border-slate-100 bg-slate-50/70">
          {/* Roster sub-header */}
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-2">
            <div className="grid flex-1 grid-cols-[1fr_6rem_8rem_7rem_6rem] gap-x-4 pl-8 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <span>Employee</span>
              <span>NIK</span>
              <span>Role</span>
              <span>Status</span>
              <span>Check-in</span>
            </div>
            {isIt && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAssignClick}
                className="h-7 shrink-0 gap-1.5 rounded-lg text-[11px]"
              >
                <UserPlus className="h-3 w-3" />
                Assign
              </Button>
            )}
          </div>

          {employees.length === 0 ? (
            <p className="px-6 py-6 text-center text-xs italic text-slate-400">
              No employees assigned to {store.storeNo}.
            </p>
          ) : employees.map((emp) => {
            const dot = ATTENDANCE_DOT[emp.attendanceStatus] ?? ATTENDANCE_DOT.not_scheduled;
            const badge = ATTENDANCE_BADGE[emp.attendanceStatus] ?? ATTENDANCE_BADGE.not_scheduled;

            return (
              <div
                key={emp.id}
                className="flex items-center gap-4 border-b border-slate-100/70 px-6 py-2.5 text-sm last:border-0 hover:bg-white/80 transition-colors"
              >
                <div className="grid flex-1 grid-cols-[1fr_6rem_8rem_7rem_6rem] items-center gap-x-4">
                  <div className="flex items-center gap-2.5 min-w-0 pl-8">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
                    <span className="truncate font-medium text-slate-800">{emp.name}</span>
                    {emp.employeeType && (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">
                        {emp.employeeTypeCode}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-slate-500">{emp.nik}</span>
                  <span className="truncate text-slate-600">{emp.role}</span>
                  <span>
                    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', badge)}>
                      {emp.attendanceStatus === 'not_scheduled' ? 'Not scheduled' : emp.attendanceStatus}
                    </span>
                  </span>
                  <span className="tabular-nums text-slate-500">{fmt(emp.checkInTime)}</span>
                </div>
                {isIt && (
                  <button
                    type="button"
                    disabled={removingId === emp.id}
                    onClick={() => onRemove(emp.id)}
                    aria-label={`Remove ${emp.name} from ${store.storeNo}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-60"
                  >
                    {removingId === emp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </td>
    </tr>
  );
}

// ─── Store table row ──────────────────────────────────────────────────────────

function StoreTableRow({
  store,
  expanded,
  isIt,
  removingId,
  onToggle,
  onEdit,
  onAssignClick,
  onRemove,
}: {
  store: StoreRow;
  expanded: boolean;
  isIt: boolean;
  removingId: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onAssignClick: () => void;
  onRemove: (userId: string) => void;
}) {
  const c = COLOR[store.taskStats.colorStatus];

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'group cursor-pointer select-none border-b border-slate-100 transition-colors',
          expanded ? 'bg-indigo-50/40' : 'bg-white hover:bg-slate-50/70',
        )}
      >
        {/* Chevron */}
        <td className="w-10 py-3.5 pl-4 pr-0">
          <div className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
            expanded ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 group-hover:bg-slate-100',
          )}>
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />
            }
          </div>
        </td>

        {/* Color swatch + name + address */}
        <td className="py-3.5 pl-2 pr-4">
          <div className="flex items-center gap-3">
            <span className={cn('h-9 w-1 shrink-0 rounded-full', c.swatch)} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{store.name}</span>
                <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] font-bold text-slate-500">
                  {store.storeNo}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate max-w-[220px]">{store.address}</span>
              </div>
            </div>
          </div>
        </td>

        {/* Task progress */}
        <td className="px-4 py-3.5">
          <ProgressBar rate={store.taskStats.completionRate} status={store.taskStats.colorStatus} />
          <p className="mt-1 text-[10px] text-slate-400">
            {store.taskStats.completed}/{store.taskStats.total} done
            {store.taskStats.pending > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-500">
                <AlertTriangle className="h-2.5 w-2.5" />
                {store.taskStats.pending} pending
              </span>
            )}
          </p>
        </td>

        {/* Status badge */}
        <td className="px-4 py-3.5">
          <span className={cn('inline-flex items-center rounded-md px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset', c.badge)}>
            {c.label}
          </span>
        </td>

        {/* Attendance */}
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">
              {store.attendanceSummary.present}
              <span className="font-normal text-slate-400">
                /{store.attendanceSummary.scheduled}
              </span>
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">present / scheduled</p>
        </td>

        {/* Petty cash */}
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-sm font-semibold tabular-nums text-slate-700">
              Rp {cash(store.pettyCashBalance)}
            </span>
          </div>
        </td>

        {/* Actions */}
        <td className="px-4 py-3.5 pr-5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            aria-label={`Edit ${store.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>

      {expanded && (
        <EmployeeRoster
          store={store}
          employees={store.employees}
          isIt={isIt}
          onAssignClick={onAssignClick}
          onRemove={onRemove}
          removingId={removingId}
        />
      )}
    </>
  );
}

// ─── Area section ─────────────────────────────────────────────────────────────

function AreaSection({
  area,
  isIt,
  removingId,
  onEditStore,
  onAddStore,
  onAssignClick,
  onRemove,
}: {
  area: AreaGroup;
  isIt: boolean;
  removingId: string | null;
  onEditStore: (store: StoreRow) => void;
  onAddStore: (areaId: number) => void;
  onAssignClick: (store: StoreRow) => void;
  onRemove: (userId: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Area-level rollup
  const totalTasks = area.stores.reduce((s, st) => s + st.taskStats.total, 0);
  const doneTasks  = area.stores.reduce((s, st) => s + st.taskStats.completed, 0);
  const areaRate   = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const areaStatus: TaskColorStatus =
    totalTasks === 0 ? 'gray'
    : areaRate >= 80  ? 'green'
    : areaRate >= 50  ? 'yellow'
    : 'red';

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Area header bar */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('h-2.5 w-2.5 rounded-full', COLOR[areaStatus].swatch)} />
          <h2 className="text-sm font-bold text-slate-800">{area.name}</h2>
          <Badge variant="secondary" className="rounded-md px-2 text-[10px] font-bold">
            {area.stores.length} store{area.stores.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('text-xs font-bold tabular-nums', COLOR[areaStatus].text)}>
            {areaRate}% avg completion
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAddStore(area.id)}
            className="h-7 gap-1.5 rounded-lg text-xs"
          >
            <Plus className="h-3 w-3" />
            Add Store
          </Button>
        </div>
      </div>

      {/* Stores table */}
      {area.stores.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm font-medium text-slate-500">No stores in this area yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <th className="w-10" />
                <th className="py-2.5 pl-2 pr-4 text-left">Store</th>
                <th className="px-4 py-2.5 text-left">Task Progress</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5 text-left">Attendance</th>
                <th className="px-4 py-2.5 text-left">Petty Cash</th>
                <th className="px-4 py-2.5 pr-5 text-left">Manage</th>
              </tr>
            </thead>
            <tbody>
              {area.stores.map((store) => (
                <StoreTableRow
                  key={store.id}
                  store={store}
                  expanded={expandedIds.has(store.id)}
                  isIt={isIt}
                  removingId={removingId}
                  onToggle={() => toggle(store.id)}
                  onEdit={() => onEditStore(store)}
                  onAssignClick={() => onAssignClick(store)}
                  onRemove={onRemove}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Summary pill ─────────────────────────────────────────────────────────────

function SummaryPill({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', accent)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xl font-bold leading-none text-slate-900">{value}</p>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="h-11 animate-pulse bg-slate-100" />
          {[1, 2, 3].map((j) => (
            <div key={j} className="flex items-center gap-4 border-b border-slate-100 px-5 py-3.5 last:border-0">
              <div className="h-4 w-4 animate-pulse rounded bg-slate-100" />
              <div className="h-8 flex-1 animate-pulse rounded-lg bg-slate-50" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function StoreManagementView({
  onReady,
}: {
  /** Called on every load with a small snapshot + Add Store/reload triggers the host page's header may want to show. */
  onReady?: (info: {
    loading: boolean;
    totalAreas: number;
    totalStores: number;
    avgRate: number;
    onAddStore: () => void;
    reload: () => void;
  }) => void;
}) {
  const { data: session } = useSession();
  const isIt = session?.user?.role === 'it';

  const [areas, setAreas] = useState<AreaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [assigningStore, setAssigningStore] = useState<StoreRow | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/ops/stores', { cache: 'no-store' });
      const body = await res.json();
      if (body.success) {
        setAreas(body.data ?? []);
      } else {
        setError(body.error ?? 'Failed to load stores.');
        setAreas([]);
      }
    } catch {
      setError('Network error. Could not reach the server.');
      setAreas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Summary rollups
  const totalAreas   = areas.length;
  const totalStores  = areas.reduce((s, a) => s + a.stores.length, 0);
  const totalTasks   = areas.reduce((s, a) => a.stores.reduce((ss, st) => ss + st.taskStats.total, s), 0);
  const doneTasks    = areas.reduce((s, a) => a.stores.reduce((ss, st) => ss + st.taskStats.completed, s), 0);
  const avgRate      = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const totalPresent = areas.reduce((s, a) => a.stores.reduce((ss, st) => ss + st.attendanceSummary.present, s), 0);

  useEffect(() => {
    onReady?.({ loading, totalAreas, totalStores, avgRate, onAddStore: () => setEditing({ mode: 'create' }), reload: () => void loadData() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, totalAreas, totalStores, avgRate]);

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    try {
      const res = await fetch(`/api/it/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeStoreId: null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to remove user from store.');
      toast.success('User removed from store.');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove user from store.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {!onReady && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => setEditing({ mode: 'create' })}
            className="h-10 gap-2 rounded-xl px-4 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" />
            Add Store
          </Button>
        </div>
      )}

      {/* Summary pills */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryPill icon={Store}         value={totalStores}              label="Stores"        accent="bg-indigo-50 text-indigo-500" />
        <SummaryPill icon={ClipboardList} value={`${doneTasks}/${totalTasks}`} label="Tasks done" accent="bg-emerald-50 text-emerald-500" />
        <SummaryPill icon={CheckCircle2}  value={`${avgRate}%`}            label="Completion"    accent="bg-violet-50 text-violet-500" />
        <SummaryPill icon={Users}         value={totalPresent}             label="Present today" accent="bg-sky-50 text-sky-500" />
      </div>

      {/* Color legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wide">Task completion:</span>
        {(['green', 'yellow', 'red', 'gray'] as TaskColorStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-full', COLOR[s].swatch)} />
            <span className="font-medium text-slate-600">{COLOR[s].label}</span>
            {COLOR[s].range !== '—' && (
              <span className="text-slate-400">({COLOR[s].range})</span>
            )}
          </span>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <Skeleton />
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-10 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-400" />
          <p className="font-semibold text-rose-700">{error}</p>
          <button
            onClick={loadData}
            className="mt-3 rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      ) : areas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
          <Store className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No stores visible for your scope</p>
          <p className="mt-1 text-xs text-slate-400">Check your area assignment or store setup in admin.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {areas.map((area) => (
            <AreaSection
              key={area.id}
              area={area}
              isIt={isIt}
              removingId={removingId}
              onEditStore={(store) => setEditing({ mode: 'edit', store })}
              onAddStore={(areaId) => setEditing({ mode: 'create', fixedAreaId: areaId })}
              onAssignClick={(store) => setAssigningStore(store)}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {editing && (
        <StoreEditSheet
          mode={editing.mode}
          store={editing.mode === 'edit' ? editing.store : undefined}
          areas={areas.map((a) => ({ id: a.id, name: a.name }))}
          fixedAreaId={editing.mode === 'create' ? editing.fixedAreaId : undefined}
          onClose={() => setEditing(null)}
          onSaved={loadData}
        />
      )}

      {assigningStore && (
        <AssignEmployeeSheet
          store={assigningStore}
          currentEmployeeIds={new Set(assigningStore.employees.map((e) => e.id))}
          onClose={() => setAssigningStore(null)}
          onAssigned={loadData}
        />
      )}
    </div>
  );
}

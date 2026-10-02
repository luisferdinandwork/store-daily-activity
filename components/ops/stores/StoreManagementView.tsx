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
//   • Red banner when a store has more than one PIC 1 (lib/store-pic1.ts) —
//     the store row and its roster are flagged too; IT fixes it in Users
//   • Toolbar: search, area / status / task-progress filters, sort
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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FilterX,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Power,
  Search,
  Store,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader } from '@/components/ui/sheet';
import StoreEditSheet from '@/components/ops/stores/StoreEditSheet';
import StoreStatusSheet from '@/components/ops/stores/StoreStatusSheet';
import StoreDeleteDialog from '@/components/ops/stores/StoreDeleteDialog';
import { STORE_STATUSES, STORE_STATUS_BADGE, STORE_STATUS_LABEL } from '@/lib/store-status';
import { findDuplicatePic1, PIC_1_TYPE_CODE } from '@/lib/store-pic1';
import { attendanceStatusLabel } from '@/lib/attendance-status';
import { jakartaTime } from '@/lib/day-bucket';
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
  employeeTypeCode: string | null;
  employeeTypeLabel: string | null;
  homeStoreId: number | null;
  storeName: string | null;
}

type StoreSortKey = 'name' | 'storeNo' | 'progress' | 'attendance' | 'pettyCash' | 'staff' | 'status';

const SORT_OPTIONS: { key: StoreSortKey; label: string }[] = [
  { key: 'name',       label: 'Name' },
  { key: 'storeNo',    label: 'Store code' },
  { key: 'progress',   label: 'Task progress' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'pettyCash',  label: 'Petty cash' },
  { key: 'staff',      label: 'Staff count' },
  { key: 'status',     label: 'Status' },
];

/** Store id → its PIC 1s, only for stores with more than one (lib/store-pic1.ts). */
type Pic1Conflicts = Map<number, EmployeeRow[]>;

const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });

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

const LEAVE_BADGE = 'bg-indigo-50 text-indigo-700 ring-indigo-200';

const ATTENDANCE_BADGE: Record<string, string> = {
  present:            'bg-emerald-50 text-emerald-700 ring-emerald-200',
  late:               'bg-amber-50 text-amber-700 ring-amber-200',
  absent:             'bg-rose-50 text-rose-700 ring-rose-200',
  not_checked_in:     'bg-rose-50 text-rose-600 ring-rose-200',
  upcoming:           'bg-sky-50 text-sky-700 ring-sky-200',
  excused:            LEAVE_BADGE,
  dinas:              LEAVE_BADGE,
  cuti:               LEAVE_BADGE,
  sakit_tanpa_surat:  LEAVE_BADGE,
  sakit_dengan_surat: LEAVE_BADGE,
  leave:              LEAVE_BADGE,
  off:                'bg-slate-100 text-slate-500 ring-slate-200',
  not_scheduled:      'bg-slate-50 text-slate-400 ring-slate-200',
  not_recording:      'bg-slate-50 text-slate-400 ring-slate-200',
};

const ATTENDANCE_DOT: Record<string, string> = {
  present:            'bg-emerald-500',
  late:               'bg-amber-400',
  absent:             'bg-rose-500',
  not_checked_in:     'bg-rose-300',
  upcoming:           'bg-sky-400',
  excused:            'bg-indigo-400',
  dinas:              'bg-indigo-400',
  cuti:               'bg-indigo-400',
  sakit_tanpa_surat:  'bg-indigo-400',
  sakit_dengan_surat: 'bg-indigo-400',
  leave:              'bg-indigo-400',
  off:                'bg-slate-300',
  not_scheduled:      'border border-dashed border-slate-300',
  not_recording:      'border border-dashed border-slate-300',
};

const ATTENDANCE_LABEL: Record<string, string> = {
  not_checked_in: 'Not checked in',
  upcoming:       'Upcoming',
  leave:          'Leave',
  off:            'Off',
  not_scheduled:  'Not scheduled',
  not_recording:  'Not recording',
};

function attendanceLabel(status: string): string {
  return ATTENDANCE_LABEL[status] ?? attendanceStatusLabel(status);
}

// ─── Small presentational helpers ────────────────────────────────────────────

function fmt(iso: string | null) {
  return jakartaTime(iso) || '—';
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

  // One PIC 1 per store: assigning another one is allowed (handover) but flagged.
  const storePic1Names = store.employees
    .filter((e) => e.employeeTypeCode === PIC_1_TYPE_CODE)
    .map((e) => e.name);

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
      const assigned = users.find((u) => u.id === userId);
      if (assigned?.employeeTypeCode === PIC_1_TYPE_CODE && storePic1Names.length > 0) {
        toast.warning(`${store.storeNo} now has ${storePic1Names.length + 1} PIC 1 — change one of them to PIC 2 or SA in Users.`);
      } else {
        toast.success('User assigned to this store.');
      }
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
                    {u.employeeTypeCode === PIC_1_TYPE_CODE && storePic1Names.length > 0 && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-semibold text-rose-600">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Store already has a PIC 1: {storePic1Names.join(', ')}
                      </p>
                    )}
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
  store, employees, isIt, duplicatePic1, onAssignClick, onRemove, removingId,
}: {
  store: StoreRow;
  employees: EmployeeRow[];
  isIt: boolean;
  /** The store has more than one PIC 1 — flag them. */
  duplicatePic1: boolean;
  onAssignClick: () => void;
  onRemove: (userId: string) => void;
  removingId: string | null;
}) {
  return (
    <tr>
      <td colSpan={7} className="p-0">
        <div className="border-t border-slate-100 bg-slate-50/70">
          {duplicatePic1 && (
            <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-6 py-2 pl-14 text-xs font-semibold text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
              {store.storeNo} has more than one PIC 1 — a store should have only one.{' '}
              {isIt ? (
                <Link href="/it/users?pic1=duplicates" className="underline underline-offset-2 hover:text-rose-800">
                  Change one in Users
                </Link>
              ) : (
                'Ask IT to change one of them to PIC 2 or SA.'
              )}
            </div>
          )}
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
            const extraPic1 = duplicatePic1 && emp.employeeTypeCode === PIC_1_TYPE_CODE;

            return (
              <div
                key={emp.id}
                className={cn(
                  'flex items-center gap-4 border-b border-slate-100/70 px-6 py-2.5 text-sm last:border-0 transition-colors',
                  extraPic1 ? 'bg-rose-50 hover:bg-rose-100/60' : 'hover:bg-white/80',
                )}
              >
                <div className="grid flex-1 grid-cols-[1fr_6rem_8rem_7rem_6rem] items-center gap-x-4">
                  <div className="flex items-center gap-2.5 min-w-0 pl-8">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
                    <span className={cn('truncate font-medium', extraPic1 ? 'text-rose-800' : 'text-slate-800')}>{emp.name}</span>
                    {emp.employeeType && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-px text-[10px] font-semibold',
                          extraPic1 ? 'bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-300' : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {emp.employeeTypeCode}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-slate-500">{emp.nik}</span>
                  <span className="truncate text-slate-600">{emp.role}</span>
                  <span>
                    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', badge)}>
                      {attendanceLabel(emp.attendanceStatus)}
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
  pic1s,
  removingId,
  onToggle,
  onEdit,
  onChangeStatus,
  onDelete,
  onAssignClick,
  onRemove,
}: {
  store: StoreRow;
  expanded: boolean;
  isIt: boolean;
  /** Set only when the store has more than one PIC 1. */
  pic1s: EmployeeRow[] | undefined;
  removingId: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onChangeStatus: () => void;
  onDelete: () => void;
  onAssignClick: () => void;
  onRemove: (userId: string) => void;
}) {
  const c = COLOR[store.taskStats.colorStatus];
  // Prep / closed stores record nothing, so task + attendance columns give way
  // to the lifecycle badge.
  const recording = store.status === 'active';

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'group cursor-pointer select-none border-b border-slate-100 transition-colors',
          expanded ? 'bg-indigo-50/40' : pic1s ? 'bg-rose-50/70 hover:bg-rose-50' : 'bg-white hover:bg-slate-50/70',
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
                {isIt && store.deptCode && (
                  <span
                    title="Business Central dept code"
                    className="rounded bg-indigo-50 px-1.5 py-px font-mono text-[10px] font-semibold text-indigo-600"
                  >
                    {store.deptCode}
                  </span>
                )}
                {pic1s && (
                  <span
                    title={`PIC 1: ${pic1s.map((e) => e.name).join(', ')} — a store should have only one.`}
                    className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-px text-[10px] font-bold text-rose-700 ring-1 ring-inset ring-rose-300"
                  >
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {pic1s.length}× PIC 1
                  </span>
                )}
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
          {recording ? (
            <>
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
            </>
          ) : (
            <p className="text-[11px] italic text-slate-400">Not recording</p>
          )}
        </td>

        {/* Status badge */}
        <td className="px-4 py-3.5">
          <span
            className={cn(
              'inline-flex items-center rounded-md px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset',
              recording ? c.badge : STORE_STATUS_BADGE[store.status],
            )}
          >
            {recording ? c.label : STORE_STATUS_LABEL[store.status]}
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              aria-label={`Edit ${store.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {isIt && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChangeStatus(); }}
                aria-label={`Change status of ${store.name}`}
                title="Change status"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              >
                <Power className="h-3.5 w-3.5" />
              </button>
            )}
            {isIt && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                disabled={store.status === 'active'}
                aria-label={`Delete ${store.name}`}
                title={store.status === 'active' ? 'Close the store first to delete it' : 'Delete store permanently'}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <EmployeeRoster
          store={store}
          employees={store.employees}
          isIt={isIt}
          duplicatePic1={!!pic1s}
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
  stores,
  filtered,
  isIt,
  pic1Conflicts,
  removingId,
  onEditStore,
  onChangeStatus,
  onDeleteStore,
  onAddStore,
  onAssignClick,
  onRemove,
}: {
  area: AreaGroup;
  /** The area's stores that pass the toolbar filters, in display order. */
  stores: StoreRow[];
  /** A store filter is active — the header shows "x of y". */
  filtered: boolean;
  isIt: boolean;
  pic1Conflicts: Pic1Conflicts;
  removingId: string | null;
  onEditStore: (store: StoreRow) => void;
  onChangeStatus: (store: StoreRow) => void;
  onDeleteStore: (store: StoreRow) => void;
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
            {filtered && `${stores.length} of `}{area.stores.length} store{area.stores.length !== 1 ? 's' : ''}
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
              {stores.map((store) => (
                <StoreTableRow
                  key={store.id}
                  store={store}
                  expanded={expandedIds.has(store.id)}
                  isIt={isIt}
                  pic1s={pic1Conflicts.get(store.id)}
                  removingId={removingId}
                  onToggle={() => toggle(store.id)}
                  onEdit={() => onEditStore(store)}
                  onChangeStatus={() => onChangeStatus(store)}
                  onDelete={() => onDeleteStore(store)}
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

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function FilterSelect({
  label, value, onChange, highlight = value !== 'all', children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Tint the control while it narrows the list (default: value !== 'all'). */
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-10 max-w-[220px] appearance-none truncate rounded-xl border pl-3 pr-8 text-sm font-semibold focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100',
          highlight ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700',
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

/** Sort value per key; null sorts last in both directions. */
function sortValue(store: StoreRow, key: StoreSortKey): number | string | null {
  switch (key) {
    case 'name':       return store.name;
    case 'storeNo':    return store.storeNo;
    case 'progress':   // Only stores that record tasks have a rate to compare.
      return store.status === 'active' && store.taskStats.total > 0 ? store.taskStats.completionRate : null;
    case 'attendance':
      return store.attendanceSummary.scheduled > 0
        ? store.attendanceSummary.present / store.attendanceSummary.scheduled
        : null;
    case 'pettyCash': {
      const n = Number(store.pettyCashBalance);
      return Number.isFinite(n) ? n : null;
    }
    case 'staff':      return store.employees.length;
    case 'status':     return STORE_STATUSES.indexOf(store.status);
  }
}

function compareStores(a: StoreRow, b: StoreRow, key: StoreSortKey, dir: 'asc' | 'desc'): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  let c = 0;
  if (va == null || vb == null) {
    c = va == null ? (vb == null ? 0 : 1) : -1;
  } else {
    c = (dir === 'asc' ? 1 : -1) * (typeof va === 'string' ? collator.compare(va, String(vb)) : va - (vb as number));
  }
  return c || collator.compare(a.name, b.name);
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
  const [statusStore, setStatusStore] = useState<StoreRow | null>(null);
  const [deleteStoreTarget, setDeleteStoreTarget] = useState<StoreRow | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [progressFilter, setProgressFilter] = useState('all');
  const [pic1Only, setPic1Only] = useState(false);
  const [sortKey, setSortKey] = useState<StoreSortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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

  // One PIC 1 per store — the roster only holds active accounts.
  const pic1Conflicts: Pic1Conflicts = useMemo(() => {
    const people = areas.flatMap((a) => a.stores.flatMap((st) => st.employees.map((emp) => ({ storeId: st.id, emp }))));
    const dup = findDuplicatePic1(people, (p) => ({ storeKey: p.storeId, employeeTypeCode: p.emp.employeeTypeCode, isActive: true }));
    return new Map([...dup].map(([storeId, list]) => [storeId, list.map((p) => p.emp)]));
  }, [areas]);
  const conflictStores = useMemo(
    () => areas.flatMap((a) => a.stores).filter((st) => pic1Conflicts.has(st.id))
      .sort((a, b) => collator.compare(a.storeNo, b.storeNo)),
    [areas, pic1Conflicts],
  );
  // Once the last conflict is fixed the toggle has nothing left to show.
  const showPic1Only = pic1Only && conflictStores.length > 0;

  const storeFiltersActive =
    search.trim() !== '' || statusFilter !== 'all' || progressFilter !== 'all' || showPic1Only;
  const filtersActive = storeFiltersActive || areaFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setAreaFilter('all');
    setStatusFilter('all');
    setProgressFilter('all');
    setPic1Only(false);
  }

  const visibleAreas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return areas
      .filter((a) => areaFilter === 'all' || String(a.id) === areaFilter)
      .map((area) => ({
        area,
        stores: area.stores
          .filter((st) => {
            if (statusFilter !== 'all' && st.status !== statusFilter) return false;
            if (progressFilter !== 'all' && st.taskStats.colorStatus !== progressFilter) return false;
            if (showPic1Only && !pic1Conflicts.has(st.id)) return false;
            if (!q) return true;
            return st.name.toLowerCase().includes(q)
              || st.storeNo.toLowerCase().includes(q)
              || st.address.toLowerCase().includes(q);
          })
          .sort((a, b) => compareStores(a, b, sortKey, sortDir)),
      }))
      // An empty area stays visible (to add its first store) unless a store filter hides everything in it.
      .filter(({ stores }) => stores.length > 0 || !storeFiltersActive);
  }, [areas, search, areaFilter, statusFilter, progressFilter, showPic1Only, pic1Conflicts, sortKey, sortDir, storeFiltersActive]);

  const visibleStoreCount = visibleAreas.reduce((n, a) => n + a.stores.length, 0);

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

      {/* One PIC 1 per store */}
      {!loading && conflictStores.length > 0 && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-rose-800">
                  {conflictStores.length} store{conflictStores.length !== 1 ? 's have' : ' has'} more than one PIC 1
                </p>
                <p className="mt-0.5 text-xs text-rose-700">
                  Each store should have exactly one PIC 1 — the petty-cash holder.{' '}
                  {isIt ? 'Change the extra one to PIC 2 or SA in Users.' : 'Ask IT to change the extra one to PIC 2 or SA.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPic1Only(!showPic1Only)}
                className="border-rose-300 bg-white text-rose-700 hover:bg-rose-100 hover:text-rose-800"
              >
                {showPic1Only ? 'Show all stores' : 'Show only these'}
              </Button>
              {isIt && (
                <Button asChild size="sm" className="bg-rose-600 text-white hover:bg-rose-700">
                  <Link href="/it/users?pic1=duplicates">Fix in Users</Link>
                </Button>
              )}
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-xs sm:pl-12">
            {conflictStores.map((st) => (
              <li key={st.id} className="text-rose-800">
                <span className="font-mono font-bold">{st.storeNo}</span>
                <span className="text-rose-700"> {st.name}</span>
                <span className="text-rose-300"> — </span>
                <span className="font-semibold">{pic1Conflicts.get(st.id)?.map((e) => e.name).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search store name, code or address…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {areas.length > 1 && (
          <FilterSelect label="Area" value={areaFilter} onChange={setAreaFilter}>
            <option value="all">All areas</option>
            {areas.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect label="Store status" value={statusFilter} onChange={setStatusFilter}>
          <option value="all">All statuses</option>
          {STORE_STATUSES.map((st) => (
            <option key={st} value={st}>{STORE_STATUS_LABEL[st]}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Task progress" value={progressFilter} onChange={setProgressFilter}>
          <option value="all">All progress</option>
          {(['green', 'yellow', 'red', 'gray'] as TaskColorStatus[]).map((st) => (
            <option key={st} value={st}>{COLOR[st].label}</option>
          ))}
        </FilterSelect>
        <div className="flex items-center gap-1.5">
          <FilterSelect label="Sort by" value={sortKey} onChange={(v) => setSortKey(v as StoreSortKey)} highlight={false}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>Sort: {o.label}</option>
            ))}
          </FilterSelect>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            aria-label={sortDir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            {sortDir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </button>
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <FilterX className="h-4 w-4" />
            Clear
          </button>
        )}
        {filtersActive && !loading && (
          <span className="text-xs text-slate-400">
            {visibleStoreCount} of {totalStores} store{totalStores !== 1 ? 's' : ''}
          </span>
        )}
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
      ) : visibleAreas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <Search className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No stores match these filters</p>
          <Button type="button" variant="outline" size="sm" onClick={clearFilters} className="mt-3 gap-1.5">
            <FilterX className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleAreas.map(({ area, stores }) => (
            <AreaSection
              key={area.id}
              area={area}
              stores={stores}
              filtered={storeFiltersActive}
              isIt={isIt}
              pic1Conflicts={pic1Conflicts}
              removingId={removingId}
              onEditStore={(store) => setEditing({ mode: 'edit', store })}
              onChangeStatus={(store) => setStatusStore(store)}
              onDeleteStore={(store) => setDeleteStoreTarget(store)}
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

      {statusStore && (
        <StoreStatusSheet
          store={statusStore}
          onClose={() => setStatusStore(null)}
          onSaved={loadData}
        />
      )}

      {deleteStoreTarget && (
        <StoreDeleteDialog
          store={deleteStoreTarget}
          onClose={() => setDeleteStoreTarget(null)}
          onDeleted={loadData}
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

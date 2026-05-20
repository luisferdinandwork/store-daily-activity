// components/ops/users/ops-user-management-client.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  History,
  Loader2,
  MapPin,
  Search,
  Store as StoreIcon,
  Undo2,
  UserMinus,
  UserRound,
  Users,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types ────────────────────────────────────────────────────────────────────

type StoreOption = {
  id: number;
  name: string;
  areaId: number;
  areaName: string | null;
};

type RoleOption = { id: number; code: string; label: string };
type EmployeeTypeOption = { id: number; code: string; label: string };

type ManagedUser = {
  id: string;
  nik: string;
  name: string;
  isActive: boolean;
  roleId: number;
  roleCode: string | null;
  roleLabel: string | null;
  employeeTypeId: number | null;
  employeeTypeCode: string | null;
  employeeTypeLabel: string | null;
  homeStoreId: number | null;
  storeName: string | null;
  areaId: number | null;
  areaName: string | null;
};

type AssignmentHistory = {
  id: number;
  storeName: string | null;
  areaName: string | null;
  roleLabel: string | null;
  employeeTypeLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  assignedByName: string | null;
  notes: string | null;
};

type ApiPayload = {
  users: ManagedUser[];
  stores: StoreOption[];
  roles: RoleOption[];
  employeeTypes: EmployeeTypeOption[];
};

const UNASSIGNED_KEY = '__unassigned__';
const MAX_SLOTS = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(value: string | null) {
  if (!value) return 'sekarang';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hueFromString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function avatarStyle(name: string): React.CSSProperties {
  const h = hueFromString(name);
  return {
    background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 75% 45%))`,
  };
}

function employeeTypeChipClass(code: string | null): string {
  switch (code) {
    case 'fulltime':  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'parttime':  return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'contract':  return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'intern':    return 'bg-purple-50 text-purple-700 border-purple-200';
    default:          return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ring-2 ring-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        ...avatarStyle(name),
      }}
    >
      {initials(name)}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OpsUserManagementClient() {
  const [query, setQuery] = useState('');
  const [payload, setPayload] = useState<ApiPayload>({
    users: [],
    stores: [],
    roles: [],
    employeeTypes: [],
  });

  const [selectedStoreKey, setSelectedStoreKey] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const [history, setHistory] = useState<AssignmentHistory[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [selectedEmployeeTypeId, setSelectedEmployeeTypeId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── Derived: employee-only role id ──────────────────────────────────────────

  const employeeRoleId = useMemo(
    () => payload.roles.find(r => r.code === 'employee')?.id ?? null,
    [payload.roles],
  );

  // ── Derived: only employees ─────────────────────────────────────────────────

  const employeeUsers = useMemo(
    () => payload.users.filter(u => u.roleCode === 'employee'),
    [payload.users],
  );

  const selectedUser = useMemo(
    () => employeeUsers.find(u => u.id === selectedUserId) ?? null,
    [employeeUsers, selectedUserId],
  );

  const selectedStoreOption = useMemo(
    () => payload.stores.find(s => String(s.id) === selectedStoreId),
    [payload.stores, selectedStoreId],
  );

  const selectedEmpType = useMemo(
    () => payload.employeeTypes.find(t => String(t.id) === selectedEmployeeTypeId),
    [payload.employeeTypes, selectedEmployeeTypeId],
  );

  // ── Store groups (employees only, search-aware) ─────────────────────────────

  const storeGroups = useMemo(() => {
    const q = query.trim().toLowerCase();

    // Pre-compute store IDs that match the query text
    let matchingStoreIds: Set<number> | null = null;
    if (q) {
      matchingStoreIds = new Set();
      for (const s of payload.stores) {
        if (s.name.toLowerCase().includes(q)) {
          matchingStoreIds.add(s.id);
        }
      }
    }

    const byStore = new Map<string, ManagedUser[]>();
    for (const u of employeeUsers) {
      if (q) {
        const nameMatch = u.name.toLowerCase().includes(q);
        const nikMatch = u.nik.toLowerCase().includes(q);
        const storeMatch = u.homeStoreId
          ? matchingStoreIds?.has(u.homeStoreId) ?? false
          : false;
        const unassignedMatch =
          !u.homeStoreId && 'tanpa toko'.includes(q);

        if (!nameMatch && !nikMatch && !storeMatch && !unassignedMatch) continue;
      }

      const key = u.homeStoreId ? String(u.homeStoreId) : UNASSIGNED_KEY;
      const arr = byStore.get(key);
      if (arr) arr.push(u);
      else byStore.set(key, [u]);
    }

    for (const arr of byStore.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }

    const rows: {
      key: string;
      name: string;
      areaName: string | null;
      users: ManagedUser[];
    }[] = payload.stores
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(s => ({
        key: String(s.id),
        name: s.name,
        areaName: s.areaName,
        users: byStore.get(String(s.id)) ?? [],
      }));

    const unassigned = byStore.get(UNASSIGNED_KEY) ?? [];
    if (unassigned.length > 0) {
      rows.push({
        key: UNASSIGNED_KEY,
        name: 'Tanpa Toko',
        areaName: null,
        users: unassigned,
      });
    }

    return q ? rows.filter(r => r.users.length > 0) : rows;
  }, [employeeUsers, payload.stores, query]);

  const activeGroup = useMemo(
    () => storeGroups.find(g => g.key === selectedStoreKey) ?? null,
    [storeGroups, selectedStoreKey],
  );

  // ── Employee slots (always MAX_SLOTS, null = vacant) ────────────────────────

  const employeeSlots = useMemo<(ManagedUser | null)[]>(() => {
    if (!activeGroup) return [];
    const users = activeGroup.users;
    if (users.length >= MAX_SLOTS) return users.slice(0, users.length);
    const slots: (ManagedUser | null)[] = [...users];
    while (slots.length < MAX_SLOTS) slots.push(null);
    return slots;
  }, [activeGroup]);

  // ── Change detection ────────────────────────────────────────────────────────

  const hasChanges = useMemo(() => {
    if (!selectedUser) return false;
    const storeChanged =
      String(selectedUser.homeStoreId ?? '') !== selectedStoreId;
    const typeChanged =
      String(selectedUser.employeeTypeId ?? '') !== selectedEmployeeTypeId;
    return storeChanged || typeChanged;
  }, [selectedUser, selectedStoreId, selectedEmployeeTypeId]);

  // ── Data loading ────────────────────────────────────────────────────────────

  async function loadUsers(search = '') {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/ops/users?q=${encodeURIComponent(search)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load users.');
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(userId: string) {
    setHistoryLoading(true);
    setHistory([]);
    try {
      const res = await fetch(`/api/ops/users/${userId}/assignment`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? 'Failed to load history.');
      setHistory(data.history ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load history.',
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function openStore(key: string) {
    setSelectedStoreKey(key);
    setSelectedUserId('');
  }

  function openUser(user: ManagedUser) {
    setSelectedUserId(user.id);
    setSelectedStoreId(user.homeStoreId ? String(user.homeStoreId) : '');
    setSelectedEmployeeTypeId(
      user.employeeTypeId ? String(user.employeeTypeId) : '',
    );
    setNotes('');
    setSuccess('');
    setError('');
    void loadHistory(user.id);
  }

  function resetForm() {
    if (!selectedUser) return;
    setSelectedStoreId(
      selectedUser.homeStoreId ? String(selectedUser.homeStoreId) : '',
    );
    setSelectedEmployeeTypeId(
      selectedUser.employeeTypeId
        ? String(selectedUser.employeeTypeId)
        : '',
    );
    setNotes('');
  }

  async function saveAssignment() {
    if (!selectedUser || !employeeRoleId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(
        `/api/ops/users/${selectedUser.id}/assignment`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: Number(selectedStoreId),
            roleId: employeeRoleId,
            employeeTypeId: selectedEmployeeTypeId
              ? Number(selectedEmployeeTypeId)
              : null,
            notes,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? 'Failed to update assignment.');
      setSuccess(`${selectedUser.name} berhasil ditransfer.`);
      setNotes('');

      if (String(selectedUser.homeStoreId ?? '') !== selectedStoreId) {
        setSelectedStoreKey(selectedStoreId || UNASSIGNED_KEY);
      }

      await loadUsers();
      await loadHistory(selectedUser.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update assignment.',
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      void loadUsers(query);
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (selectedStoreKey) return;
    const firstWithUsers = storeGroups.find(g => g.users.length > 0);
    if (firstWithUsers) setSelectedStoreKey(firstWithUsers.key);
  }, [storeGroups, selectedStoreKey]);

  // ── Stats ───────────────────────────────────────────────────────────────────

  const totalEmployees = employeeUsers.length;
  const activeEmployees = employeeUsers.filter(u => u.isActive).length;
  const totalStores = payload.stores.length;
  const filledSlots = totalEmployees;
  const totalSlots = totalStores * MAX_SLOTS;
  const vacantSlots = Math.max(0, totalSlots - filledSlots);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* ── Header ── */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Users className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">
                Manajemen Karyawan
              </h1>
              <p className="text-xs text-slate-500">
                Atur penempatan karyawan per toko
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HeaderStat label="Karyawan" value={totalEmployees} />
            <HeaderStat label="Aktif" value={activeEmployees} tone="emerald" />
            <HeaderStat label="Toko" value={totalStores} />
            {vacantSlots > 0 && (
              <HeaderStat label="Slot kosong" value={vacantSlots} tone="amber" />
            )}
          </div>
        </div>
      </header>

      {/* ── Alerts ── */}
      {(error || success) && (
        <div className="mx-auto max-w-[1400px] space-y-2 px-4 pt-3 sm:px-6">
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1 text-xs font-semibold">{error}</p>
              <button
                onClick={() => setError('')}
                className="text-rose-400 hover:text-rose-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1 text-xs font-semibold">{success}</p>
              <button
                onClick={() => setSuccess('')}
                className="text-emerald-400 hover:text-emerald-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Two-pane layout: Stores | Grid + Detail ── */}
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
        <div className="flex h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-[280px_1fr]">
          {/* ── Left: Store panel with search ── */}
          <section className="flex min-h-0 max-h-[40vh] flex-col border-b border-slate-200 lg:max-h-none lg:border-b-0 lg:border-r">
            {/* Search — inside store panel */}
            <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-3 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Cari toko atau karyawan…"
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Store list header */}
            <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <StoreIcon className="h-3 w-3" />
                  Toko
                </h2>
                <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                  {storeGroups.length}
                </span>
              </div>
            </div>

            {/* Store list */}
            <div className="flex-1 overflow-y-auto p-1.5">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="mb-1 h-14 animate-pulse rounded-xl bg-slate-100"
                    />
                  ))
                : storeGroups.length === 0
                  ? (
                      <EmptyMini
                        icon={StoreIcon}
                        title="Tidak ada toko"
                        hint="Tidak cocok dengan pencarian."
                      />
                    )
                  : storeGroups.map(group => {
                      const active = group.key === selectedStoreKey;
                      const isUnassigned = group.key === UNASSIGNED_KEY;
                      const count = group.users.length;
                      const isFull = count >= MAX_SLOTS;
                      const isEmpty = count === 0;

                      return (
                        <button
                          key={group.key}
                          type="button"
                          onClick={() => openStore(group.key)}
                          className={cn(
                            'mb-1 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition',
                            active
                              ? 'border-indigo-200 bg-indigo-50/70'
                              : 'border-transparent hover:border-slate-100 hover:bg-slate-50',
                          )}
                        >
                          <div
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black tabular-nums',
                              active
                                ? 'bg-indigo-600 text-white'
                                : isUnassigned
                                  ? 'bg-amber-50 text-amber-600'
                                  : isFull
                                    ? 'bg-emerald-50 text-emerald-600'
                                    : isEmpty
                                      ? 'bg-slate-100 text-slate-400'
                                      : 'bg-sky-50 text-sky-600',
                            )}
                          >
                            {isUnassigned ? (
                              <UserMinus className="h-3.5 w-3.5" />
                            ) : (
                              `${count}`
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                'truncate text-[13px] font-bold',
                                active
                                  ? 'text-indigo-900'
                                  : 'text-slate-800',
                              )}
                            >
                              {group.name}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
                              {group.areaName ??
                                (isUnassigned
                                  ? 'Belum ada toko'
                                  : 'Tanpa area')}
                              <span className="mx-1 text-slate-300">·</span>
                              <span
                                className={cn(
                                  isFull && !active
                                    ? 'text-emerald-500'
                                    : isEmpty && !active
                                      ? 'text-slate-400'
                                      : '',
                                )}
                              >
                                {count}/{MAX_SLOTS}
                              </span>{' '}
                              karyawan
                            </p>
                          </div>
                          {active && (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                          )}
                        </button>
                      );
                    })}
            </div>
          </section>

          {/* ── Right: Employee grid + detail ── */}
          <section className="flex min-h-0 flex-col">
            {/* Employee grid — fixed at top of right pane */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4">
              {activeGroup ? (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">
                        {activeGroup.name}
                      </h3>
                      {activeGroup.areaName && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                          <MapPin className="h-3 w-3" />
                          {activeGroup.areaName}
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                        activeGroup.users.length >= MAX_SLOTS
                          ? 'bg-emerald-50 text-emerald-600'
                          : activeGroup.users.length === 0
                            ? 'bg-slate-100 text-slate-500'
                            : 'bg-sky-50 text-sky-600',
                      )}
                    >
                      {activeGroup.users.length}/{MAX_SLOTS} terisi
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {employeeSlots.map((user, idx) =>
                      user ? (
                        <EmployeeSlotCard
                          key={user.id}
                          user={user}
                          selected={user.id === selectedUserId}
                          onClick={() => openUser(user)}
                        />
                      ) : (
                        <VacantSlotCard
                          key={`vacant-${idx}`}
                          onClick={() => {
                            setSelectedUserId('');
                          }}
                        />
                      ),
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                    <StoreIcon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-bold text-slate-600">
                    Pilih toko di sebelah kiri
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Untuk melihat slot karyawan
                  </p>
                </div>
              )}
            </div>

            {/* Detail — scrollable */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedUser ? (
                <div className="space-y-5 p-4">
                  {/* ── Detail header ── */}
                  <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-start gap-4">
                      <Avatar name={selectedUser.name} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-bold tracking-tight text-slate-900">
                            {selectedUser.name}
                          </h2>
                          {!selectedUser.isActive && (
                            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                              Inaktif
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs font-semibold text-slate-400">
                          NIK {selectedUser.nik}
                        </p>

                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                          <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                            Karyawan
                          </span>
                          {selectedUser.employeeTypeLabel && (
                            <span
                              className={cn(
                                'rounded-md border px-2 py-0.5 text-[11px] font-bold',
                                employeeTypeChipClass(
                                  selectedUser.employeeTypeCode,
                                ),
                              )}
                            >
                              {selectedUser.employeeTypeLabel}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Building2 className="h-3.5 w-3.5 text-slate-400" />
                            <span className="font-semibold">
                              {selectedUser.storeName ?? 'Tanpa toko'}
                            </span>
                          </span>
                          {selectedUser.areaName && (
                            <span className="flex items-center gap-1.5 text-slate-600">
                              <MapPin className="h-3.5 w-3.5 text-slate-400" />
                              <span className="font-semibold">
                                {selectedUser.areaName}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Transfer card ── */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-100 text-indigo-600">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Transfer Penempatan
                        </h3>
                      </div>
                      {hasChanges && (
                        <button
                          type="button"
                          onClick={resetForm}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100"
                        >
                          <Undo2 className="h-3 w-3" /> Reset
                        </button>
                      )}
                    </div>

                    <div className="grid gap-4 p-4 sm:grid-cols-2">
                      {/* Store select */}
                      <FieldShell
                        icon={Building2}
                        label="Toko Tujuan"
                        changed={
                          String(selectedUser.homeStoreId ?? '') !==
                          selectedStoreId
                        }
                      >
                        <Select
                          value={selectedStoreId}
                          onValueChange={setSelectedStoreId}
                        >
                          <SelectTrigger className="h-10 w-full">
                            <SelectValue placeholder="Pilih toko" />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            <SelectGroup>
                              <SelectLabel>Daftar Toko</SelectLabel>
                              {payload.stores.map(s => (
                                <SelectItem
                                  key={s.id}
                                  value={String(s.id)}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-semibold">
                                      {s.name}
                                    </span>
                                    {s.areaName && (
                                      <span className="text-[10px] text-slate-400">
                                        {s.areaName}
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FieldShell>

                      {/* Employee type select */}
                      <FieldShell
                        icon={UserRound}
                        label="Tipe Karyawan"
                        changed={
                          String(selectedUser.employeeTypeId ?? '') !==
                          selectedEmployeeTypeId
                        }
                      >
                        <Select
                          value={selectedEmployeeTypeId}
                          onValueChange={setSelectedEmployeeTypeId}
                        >
                          <SelectTrigger className="h-10 w-full">
                            <SelectValue placeholder="Pilih tipe" />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            {payload.employeeTypes.map(t => (
                              <SelectItem
                                key={t.id}
                                value={String(t.id)}
                              >
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldShell>
                    </div>

                    {/* Diff preview */}
                    {hasChanges && (
                      <div className="border-t border-amber-200 bg-amber-50/60 px-4 py-3">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                          Preview perubahan
                        </p>
                        <div className="space-y-1.5">
                          <DiffRow
                            label="Toko"
                            from={selectedUser.storeName ?? '—'}
                            to={selectedStoreOption?.name ?? '—'}
                            changed={
                              String(selectedUser.homeStoreId ?? '') !==
                              selectedStoreId
                            }
                          />
                          <DiffRow
                            label="Tipe"
                            from={selectedUser.employeeTypeLabel ?? '—'}
                            to={selectedEmpType?.label ?? '—'}
                            changed={
                              String(selectedUser.employeeTypeId ?? '') !==
                              selectedEmployeeTypeId
                            }
                          />
                        </div>
                      </div>
                    )}

                    {/* Notes + action */}
                    <div className="border-t border-slate-100 p-4">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          Catatan{' '}
                          <span className="font-medium text-slate-400">
                            (opsional)
                          </span>
                        </span>
                        <textarea
                          value={notes}
                          onChange={e => setNotes(e.target.value)}
                          placeholder="Alasan transfer, mis. rotasi bulanan ke Store Gambir."
                          className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                      </label>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="text-[11px] text-slate-400">
                          {hasChanges
                            ? 'Klik simpan untuk catat penempatan baru.'
                            : 'Belum ada perubahan.'}
                        </p>
                        <button
                          type="button"
                          onClick={saveAssignment}
                          disabled={
                            saving ||
                            !selectedStoreId ||
                            !hasChanges
                          }
                          className={cn(
                            'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold transition',
                            hasChanges &&
                              !saving &&
                              selectedStoreId
                              ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                              : 'cursor-not-allowed bg-slate-100 text-slate-400',
                          )}
                        >
                          {saving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          {saving ? 'Menyimpan…' : 'Simpan'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── History ── */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                          <History className="h-3.5 w-3.5" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Riwayat Penempatan
                        </h3>
                      </div>
                      {history.length > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                          {history.length}
                        </span>
                      )}
                    </div>

                    <div className="p-4">
                      {historyLoading ? (
                        <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
                          <Loader2 className="h-4 w-4 animate-spin" /> Memuat
                          riwayat…
                        </div>
                      ) : history.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
                          <Clock className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                          <p className="text-xs font-semibold text-slate-500">
                            Belum ada riwayat.
                          </p>
                        </div>
                      ) : (
                        <Timeline items={history} />
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyDetail />
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HeaderStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'emerald' | 'amber';
}) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-600'
      : tone === 'amber'
        ? 'text-amber-600'
        : 'text-slate-700';
  return (
    <div className="flex items-baseline gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <span className={cn('text-sm font-black tabular-nums', cls)}>
        {value}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </span>
    </div>
  );
}

/**
 * Wraps a form field with label + icon.
 * Uses border-color change for "changed" state instead of ring,
 * to avoid conflicting with Select's own focus-visible ring.
 */
function FieldShell({
  icon: Icon,
  label,
  children,
  changed,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  changed?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {label}
        </span>
        {changed && (
          <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0 text-[9px] font-bold text-amber-700">
            Berubah
          </span>
        )}
      </div>
      <div
        className={cn(
          'rounded-md transition-colors',
          changed && 'border-2 border-amber-300 bg-amber-50/30',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DiffRow({
  label,
  from,
  to,
  changed,
}: {
  label: string;
  from: string;
  to: string;
  changed: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-700/70">
        {label}
      </span>
      <span
        className={cn(
          'truncate rounded px-1.5 py-0.5 font-semibold',
          changed
            ? 'bg-white text-slate-500 line-through ring-1 ring-slate-200'
            : 'text-slate-700',
        )}
      >
        {from}
      </span>
      {changed && (
        <>
          <ArrowRight className="h-3 w-3 shrink-0 text-amber-500" />
          <span className="truncate rounded bg-amber-200/70 px-1.5 py-0.5 font-bold text-amber-900">
            {to}
          </span>
        </>
      )}
    </div>
  );
}

function EmployeeSlotCard({
  user,
  selected,
  onClick,
}: {
  user: ManagedUser;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all',
        selected
          ? 'border-indigo-300 bg-indigo-50 shadow-sm ring-2 ring-indigo-100'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm',
      )}
    >
      <Avatar name={user.name} size={36} />
      <div className="min-w-0 w-full">
        <p
          className={cn(
            'truncate text-xs font-bold',
            selected ? 'text-indigo-900' : 'text-slate-800',
          )}
        >
          {user.name}
        </p>
        <p className="truncate text-[10px] text-slate-400">{user.nik}</p>
      </div>
      {user.employeeTypeLabel && (
        <span
          className={cn(
            'rounded border px-1.5 py-0 text-[9px] font-bold',
            employeeTypeChipClass(user.employeeTypeCode),
          )}
        >
          {user.employeeTypeLabel}
        </span>
      )}
      {!user.isActive && (
        <span className="rounded bg-slate-200 px-1 py-0 text-[8px] font-bold uppercase text-slate-500">
          Inaktif
        </span>
      )}
    </button>
  );
}

function VacantSlotCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 p-3 text-center transition hover:border-slate-300 hover:bg-slate-50/50"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100">
        <UserMinus className="h-4 w-4 text-slate-400" />
      </div>
      <p className="text-[10px] font-bold text-slate-400">Slot kosong</p>
    </button>
  );
}

function Timeline({ items }: { items: AssignmentHistory[] }) {
  return (
    <ol className="relative space-y-3 border-l-2 border-slate-100 pl-5">
      {items.map((item, idx) => (
        <li key={item.id} className="relative">
          <div
            className={cn(
              'absolute -left-[27px] top-2 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white',
              item.isActive ? 'bg-indigo-600' : 'bg-slate-300',
            )}
          >
            {item.isActive && (
              <div className="h-1.5 w-1.5 rounded-full bg-white" />
            )}
          </div>

          <div
            className={cn(
              'rounded-xl border px-3 py-2.5',
              item.isActive
                ? 'border-indigo-200 bg-indigo-50/40'
                : 'border-slate-100 bg-slate-50/50',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900">
                  {item.storeName ?? 'Tanpa toko'}
                  {item.areaName && (
                    <span className="ml-1.5 font-semibold text-slate-400">
                      · {item.areaName}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">
                    {item.roleLabel ?? '—'}
                  </span>
                  {item.employeeTypeLabel && (
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                      {item.employeeTypeLabel}
                    </span>
                  )}
                </div>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  item.isActive
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-600',
                )}
              >
                {item.isActive ? 'Aktif' : `#${idx + 1}`}
              </span>
            </div>

            <p className="mt-2 text-[11px] font-semibold text-slate-500">
              {formatDate(item.effectiveFrom)}
              <span className="mx-1 text-slate-300">→</span>
              {formatDate(item.effectiveTo)}
            </p>

            {(item.assignedByName || item.notes) && (
              <div className="mt-2 border-t border-slate-200/60 pt-2">
                {item.assignedByName && (
                  <p className="text-[11px] font-semibold text-slate-500">
                    Oleh{' '}
                    <span className="text-slate-700">
                      {item.assignedByName}
                    </span>
                  </p>
                )}
                {item.notes && (
                  <p className="mt-0.5 text-[11px] italic text-slate-500">
                    &ldquo;{item.notes}&rdquo;
                  </p>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function EmptyMini({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ElementType;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xs font-bold text-slate-700">{title}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-500">
          <UserRound className="h-6 w-6" />
        </div>
        <p className="font-bold text-slate-700">
          Pilih karyawan untuk mulai
        </p>
        <p className="mt-1 max-w-xs text-xs text-slate-400">
          Klik salah satu karyawan di grid atas untuk mengubah toko, tipe
          karyawan, atau melihat riwayat penempatan.
        </p>
      </div>
    </div>
  );
}
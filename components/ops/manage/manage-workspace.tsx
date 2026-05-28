// components/ops/manage/manage-workspace.tsx
'use client';

import { useMemo, useState } from 'react';
import {
  Building2,
  ChevronRight,
  Globe2,
  MapPin,
  Search,
  UserMinus,
  Users,
  CalendarClock,
  ArrowLeftRight,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

import type { WorkspaceData, ManageEmployee } from './types';
import { EmployeeDetailSheet } from './employee-detail-sheet';

interface Props {
  data: WorkspaceData;
  onReload: () => Promise<void>;
}

const UNASSIGNED = -999;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const h = hueFromString(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm ring-2 ring-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${h} 65% 55%), hsl(${(h + 45) % 360} 70% 45%))`,
      }}
    >
      {initials(name)}
    </div>
  );
}

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

function formatRelativeEnd(iso: string | null): string {
  const d = daysFromNow(iso);
  if (d == null) return '';
  if (d < 0) return 'expired';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 7) return `in ${d} days`;
  if (d < 30) return `in ${Math.ceil(d / 7)}w`;
  return `${Math.ceil(d / 30)}mo`;
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export function ManageWorkspace({ data, onReload }: Props) {
  const [query, setQuery] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(() => data.stores[0]?.id ?? null);
  const [selectedEmployee, setSelectedEmployee] = useState<ManageEmployee | null>(null);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byArea = new Map<number, { area: { id: number; name: string }; stores: typeof data.stores }>();
    for (const a of data.areas) byArea.set(a.id, { area: { id: a.id, name: a.name }, stores: [] });
    for (const s of data.stores) {
      if (q && !s.name.toLowerCase().includes(q) && !s.areaName.toLowerCase().includes(q)) {
        const hasMatchingEmp = data.employees.some(
          (e) => e.homeStoreId === s.id && (e.name.toLowerCase().includes(q) || e.nik.toLowerCase().includes(q)),
        );
        if (!hasMatchingEmp) continue;
      }
      byArea.get(s.areaId)?.stores.push(s);
    }
    return [...byArea.values()].filter((g) => g.stores.length > 0);
  }, [data.areas, data.stores, data.employees, query]);

  const unassignedEmployees = useMemo(() => data.employees.filter((e) => !e.homeStoreId), [data.employees]);

  const employeesInSelectedStore = useMemo(() => {
    if (selectedStoreId == null) return [];
    if (selectedStoreId === UNASSIGNED) {
      const q = query.trim().toLowerCase();
      return q ? unassignedEmployees.filter((e) => e.name.toLowerCase().includes(q) || e.nik.toLowerCase().includes(q)) : unassignedEmployees;
    }
    const q = query.trim().toLowerCase();
    const list = data.employees.filter((e) => e.homeStoreId === selectedStoreId);
    return q ? list.filter((e) => e.name.toLowerCase().includes(q) || e.nik.toLowerCase().includes(q)) : list;
  }, [data.employees, selectedStoreId, query, unassignedEmployees]);

  const selectedStore = useMemo(
    () => (selectedStoreId === UNASSIGNED ? null : data.stores.find((s) => s.id === selectedStoreId) ?? null),
    [data.stores, selectedStoreId],
  );

  const totalEmployees = data.employees.length;
  const tempCount = data.employees.filter((e) => e.isTemporary).length;
  const unassignedCount = unassignedEmployees.length;

  async function handleTransferComplete(toStoreId: number) {
    setSelectedEmployee(null);
    setSelectedStoreId(toStoreId);
    await onReload();
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* ── Top bar ── */}
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Manajemen</p>
              <h1 className="text-base font-bold tracking-tight text-slate-900">Penempatan Karyawan</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {data.actor.isHO && (
              <Badge variant="outline" className="gap-1.5 border-violet-200 bg-violet-50 text-violet-700 font-semibold">
                <Globe2 className="h-3 w-3" />
                Head Office
              </Badge>
            )}
            <Stat label="Karyawan" value={totalEmployees} />
            {tempCount > 0 && <Stat label="Periode aktif" value={tempCount} tone="amber" />}
            {unassignedCount > 0 && <Stat label="Belum ditempatkan" value={unassignedCount} tone="rose" />}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* ─── Left rail ─── */}
        <aside className="w-72 shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari toko atau karyawan…"
                className="h-9 pl-9 pr-8 text-sm focus-visible:ring-violet-400 focus-visible:border-violet-400"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <Building2 className="h-3 w-3" />
                Toko
              </h2>
              <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                {grouped.reduce((n, g) => n + g.stores.length, 0)}
              </span>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-1.5">
              {grouped.length === 0 && unassignedCount === 0 ? (
                <div className="px-3 py-8 text-center">
                  <p className="text-xs text-slate-400">Tidak ada toko sesuai pencarian.</p>
                </div>
              ) : (
                <>
                  {grouped.map((g) => (
                    <AreaGroup
                      key={g.area.id}
                      areaName={g.area.name}
                      isHO={data.actor.isHO}
                      stores={g.stores}
                      employees={data.employees}
                      selectedStoreId={selectedStoreId}
                      onSelect={(id) => setSelectedStoreId(id)}
                    />
                  ))}

                  {unassignedCount > 0 && (
                    <button
                      onClick={() => setSelectedStoreId(UNASSIGNED)}
                      className={cn(
                        'mt-1 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition',
                        selectedStoreId === UNASSIGNED
                          ? 'border-rose-200 bg-rose-50/70'
                          : 'border-transparent hover:border-slate-100 hover:bg-slate-50',
                      )}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                        <UserMinus className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-slate-800">Belum ditempatkan</p>
                        <p className="text-[10px] font-semibold text-slate-400">{unassignedCount} karyawan</p>
                      </div>
                    </button>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* ─── Center: employee roster ─── */}
        <main className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-5xl px-8 py-7">
              {selectedStore ? (
                <div className="mb-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{selectedStore.areaName}</p>
                  <div className="mt-1 flex items-baseline justify-between gap-4">
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">{selectedStore.name}</h2>
                    <p className="text-xs font-semibold text-slate-400">{employeesInSelectedStore.length} karyawan</p>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    {selectedStore.address}
                  </p>
                </div>
              ) : selectedStoreId === UNASSIGNED ? (
                <div className="mb-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Untuk ditangani</p>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">Karyawan belum ditempatkan</h2>
                  <p className="mt-1 text-xs text-slate-500">Klik salah satu untuk menempatkan ke toko.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">Pilih toko di sebelah kiri</p>
                  <p className="mt-1 max-w-xs text-xs text-slate-400">Untuk melihat dan mengelola karyawan di toko tersebut.</p>
                </div>
              )}

              {(selectedStore || selectedStoreId === UNASSIGNED) && (
                <>
                  {employeesInSelectedStore.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <Users className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-bold text-slate-700">Belum ada karyawan di sini</p>
                      <p className="mt-1 max-w-xs text-xs text-slate-400">
                        {query ? 'Tidak cocok dengan pencarian.' : 'Tarik karyawan dari toko lain melalui menu transfer.'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {employeesInSelectedStore.map((e) => (
                        <EmployeeCard key={e.id} employee={e} onClick={() => setSelectedEmployee(e)} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </main>
      </div>

      {selectedEmployee && (
        <EmployeeDetailSheet
          employee={selectedEmployee}
          stores={data.stores}
          employeeTypes={data.lookups.employeeTypes}
          employeeRoleId={data.lookups.employeeRoleId}
          isHO={data.actor.isHO}
          onClose={() => setSelectedEmployee(null)}
          onTransferComplete={handleTransferComplete}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'rose' }) {
  const cls =
    tone === 'amber' ? 'text-amber-700 bg-amber-50 border-amber-200'
    : tone === 'rose' ? 'text-rose-700 bg-rose-50 border-rose-200'
    : 'text-slate-700 bg-slate-50 border-slate-200';
  return (
    <div className={cn('flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1.5', cls)}>
      <span className="text-sm font-black tabular-nums">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </div>
  );
}

function AreaGroup({
  areaName,
  isHO,
  stores,
  employees,
  selectedStoreId,
  onSelect,
}: {
  areaName: string;
  isHO: boolean;
  stores: Array<{ id: number; name: string; areaName: string; employeeCount: number }>;
  employees: ManageEmployee[];
  selectedStoreId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="mb-3">
      {isHO && (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <Globe2 className="h-3 w-3 text-slate-400" />
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">{areaName}</p>
        </div>
      )}
      <div className="space-y-0.5">
        {stores.map((s) => {
          const active = s.id === selectedStoreId;
          const tempInStore = employees.filter((e) => e.homeStoreId === s.id && e.isTemporary).length;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                'group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition',
                active
                  ? 'border-violet-200 bg-violet-50/70'
                  : 'border-transparent hover:border-slate-100 hover:bg-slate-50',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black tabular-nums',
                  active ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600',
                )}
              >
                {s.employeeCount}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-[13px] font-bold', active ? 'text-violet-900' : 'text-slate-800')}>{s.name}</p>
                {tempInStore > 0 && (
                  <p className={cn('flex items-center gap-1 text-[10px] font-semibold', active ? 'text-amber-500' : 'text-amber-600')}>
                    <CalendarClock className="h-2.5 w-2.5" />
                    {tempInStore} periode
                  </p>
                )}
              </div>
              {active && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-500" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmployeeCard({ employee, onClick }: { employee: ManageEmployee; onClick: () => void }) {
  const tempDays = employee.isTemporary ? daysFromNow(employee.effectiveTo) : null;
  const tempEnding = tempDays != null && tempDays <= 7;

  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3.5 rounded-xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-violet-200 hover:shadow-sm hover:bg-violet-50/20"
    >
      <Avatar name={employee.name} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-slate-900">{employee.name}</p>
          {!employee.isActive && (
            <span className="rounded border border-slate-300 bg-slate-100 px-1 py-0 text-[9px] font-bold uppercase tracking-wider text-slate-500">
              Inaktif
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">
          NIK {employee.nik}
          {employee.employeeTypeLabel && (
            <>
              {' · '}
              <span className="text-slate-500">{employee.employeeTypeLabel}</span>
            </>
          )}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {employee.isTemporary ? (
            <>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold',
                  tempEnding
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700',
                )}
              >
                <CalendarClock className="h-2.5 w-2.5" />
                Periode · berakhir {formatRelativeEnd(employee.effectiveTo)}
              </span>
              {employee.previousStoreName && (
                <span className="text-[10px] font-semibold text-slate-400">← {employee.previousStoreName}</span>
              )}
            </>
          ) : employee.homeStoreId ? (
            <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
              Permanen
            </span>
          ) : (
            <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
              Tidak ada toko
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-400" />
    </button>
  );
}
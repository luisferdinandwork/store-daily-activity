// components/ops/manage/manage-workspace.tsx
'use client';

// Two panes: the store rail (search + stores grouped by area) and the selected
// store's roster. From `lg` up the workspace fills the page height and each
// pane scrolls on its own; below `lg` the rail is a capped, scrollable box
// above the roster and the page scrolls normally — nothing is sized to the
// viewport, so a long store list can never spill out of its container.

import { useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Globe2,
  MapPin,
  Search,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { OpsList, OpsListRow } from '@/components/ops/layout/OpsList';

import type { WorkspaceData, ManageEmployee, ManageStore } from './types';
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

function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white"
        style={{ width: size, height: size }}
      />
    );
  }
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

function matches(q: string, ...fields: (string | null | undefined)[]) {
  return fields.some((f) => f?.toLowerCase().includes(q));
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export function ManageWorkspace({ data, onReload }: Props) {
  const [query, setQuery] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(() => data.stores[0]?.id ?? null);
  const [selectedEmployee, setSelectedEmployee] = useState<ManageEmployee | null>(null);
  const rosterRef = useRef<HTMLElement>(null);

  const q = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    const byArea = new Map<number, { area: { id: number; name: string }; stores: ManageStore[] }>();
    for (const a of data.areas) byArea.set(a.id, { area: { id: a.id, name: a.name }, stores: [] });
    for (const s of data.stores) {
      if (q && !matches(q, s.name, s.storeNo, s.areaName)) {
        const hasMatchingEmp = data.employees.some(
          (e) => e.homeStoreId === s.id && matches(q, e.name, e.nik),
        );
        if (!hasMatchingEmp) continue;
      }
      byArea.get(s.areaId)?.stores.push(s);
    }
    return [...byArea.values()].filter((g) => g.stores.length > 0);
  }, [data.areas, data.stores, data.employees, q]);

  const tempCountByStore = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of data.employees) {
      if (e.homeStoreId && e.isTemporary) m.set(e.homeStoreId, (m.get(e.homeStoreId) ?? 0) + 1);
    }
    return m;
  }, [data.employees]);

  const unassignedEmployees = useMemo(() => data.employees.filter((e) => !e.homeStoreId), [data.employees]);

  const employeesInSelectedStore = useMemo(() => {
    if (selectedStoreId == null) return [];
    const list = selectedStoreId === UNASSIGNED
      ? unassignedEmployees
      : data.employees.filter((e) => e.homeStoreId === selectedStoreId);
    return q ? list.filter((e) => matches(q, e.name, e.nik)) : list;
  }, [data.employees, selectedStoreId, q, unassignedEmployees]);

  const selectedStore = useMemo(
    () => (selectedStoreId === UNASSIGNED ? null : data.stores.find((s) => s.id === selectedStoreId) ?? null),
    [data.stores, selectedStoreId],
  );

  const shownStoreCount = grouped.reduce((n, g) => n + g.stores.length, 0);
  const totalEmployees = data.employees.length;
  const tempCount = data.employees.filter((e) => e.isTemporary).length;
  const unassignedCount = unassignedEmployees.length;

  function selectStore(id: number) {
    setSelectedStoreId(id);
    // Stacked layout: the roster sits below the rail — bring it into view.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => rosterRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  async function handleTransferComplete(toStoreId: number) {
    setSelectedEmployee(null);
    setSelectedStoreId(toStoreId);
    await onReload();
  }

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      {/* ── Summary ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {data.actor.isHO && (
          <Badge variant="outline" className="gap-1.5 border-violet-200 bg-violet-50 font-semibold text-violet-700">
            <Globe2 className="h-3 w-3" />
            Head Office
          </Badge>
        )}
        <Stat label="Toko" value={data.stores.length} />
        <Stat label="Karyawan" value={totalEmployees} />
        {tempCount > 0 && <Stat label="Periode aktif" value={tempCount} tone="amber" />}
        {unassignedCount > 0 && <Stat label="Belum ditempatkan" value={unassignedCount} tone="rose" />}
      </div>

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        {/* ─── Store rail ─── */}
        <aside className="flex max-h-[26rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:max-h-none lg:w-80 lg:shrink-0">
          <div className="shrink-0 border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari toko, kode, atau karyawan…"
                className="h-9 pl-9 pr-8 text-sm focus-visible:border-violet-400 focus-visible:ring-violet-400"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Hapus pencarian"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2">
            <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <Building2 className="h-3 w-3" />
              Toko
            </h2>
            <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 ring-1 ring-slate-200">
              {q ? `${shownStoreCount}/${data.stores.length}` : data.stores.length}
            </span>
          </div>

          {/* The only scrolling part of the rail. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {unassignedCount > 0 && (
              <div className="p-1.5 pb-0">
                <button
                  type="button"
                  onClick={() => selectStore(UNASSIGNED)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition',
                    selectedStoreId === UNASSIGNED
                      ? 'border-rose-200 bg-rose-50/70'
                      : 'border-transparent hover:border-slate-100 hover:bg-slate-50',
                  )}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                    <UserMinus className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-slate-800">Belum ditempatkan</p>
                    <p className="text-[10px] font-semibold text-slate-400">{unassignedCount} karyawan</p>
                  </div>
                </button>
              </div>
            )}

            {grouped.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-slate-400">Tidak ada toko sesuai pencarian.</p>
            ) : (
              grouped.map((g) => (
                <AreaGroup
                  key={g.area.id}
                  areaName={g.area.name}
                  showHeader={data.actor.isHO}
                  stores={g.stores}
                  tempCountByStore={tempCountByStore}
                  selectedStoreId={selectedStoreId}
                  onSelect={selectStore}
                />
              ))
            )}
          </div>
        </aside>

        {/* ─── Roster ─── */}
        <section
          ref={rosterRef}
          className="min-w-0 scroll-mt-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1"
        >
          {selectedStore ? (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                {selectedStore.storeNo ? `${selectedStore.storeNo} · ` : ''}{selectedStore.areaName}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="min-w-0 break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  {selectedStore.name}
                </h2>
                <p className="shrink-0 text-xs font-semibold text-slate-400">{employeesInSelectedStore.length} karyawan</p>
              </div>
              {selectedStore.address && (
                <p className="mt-1 flex min-w-0 items-start gap-1.5 text-xs text-slate-500">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="min-w-0 break-words">{selectedStore.address}</span>
                </p>
              )}
            </div>
          ) : selectedStoreId === UNASSIGNED ? (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Untuk ditangani</p>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Karyawan belum ditempatkan</h2>
              <p className="mt-1 text-xs text-slate-500">Klik salah satu untuk menempatkan ke toko.</p>
            </div>
          ) : (
            <EmptyPanel
              icon={Building2}
              title="Pilih toko"
              description="Pilih toko dari daftar untuk melihat dan mengelola karyawannya."
            />
          )}

          {(selectedStore || selectedStoreId === UNASSIGNED) && (
            employeesInSelectedStore.length === 0 ? (
              <EmptyPanel
                icon={Users}
                title="Belum ada karyawan di sini"
                description={query ? 'Tidak cocok dengan pencarian.' : 'Tarik karyawan dari toko lain melalui menu transfer.'}
              />
            ) : (
              <OpsList>
                {employeesInSelectedStore.map((e) => (
                  <EmployeeRow key={e.id} employee={e} onClick={() => setSelectedEmployee(e)} />
                ))}
              </OpsList>
            )
          )}
        </section>
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
          onEditSaved={onReload}
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
    : 'text-slate-700 bg-white border-slate-200';
  return (
    <div className={cn('flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1.5', cls)}>
      <span className="text-sm font-black tabular-nums">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </div>
  );
}

function EmptyPanel({
  icon: Icon, title, description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-bold text-slate-700">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-slate-400">{description}</p>
    </div>
  );
}

function AreaGroup({
  areaName,
  showHeader,
  stores,
  tempCountByStore,
  selectedStoreId,
  onSelect,
}: {
  areaName: string;
  showHeader: boolean;
  stores: ManageStore[];
  tempCountByStore: Map<number, number>;
  selectedStoreId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="pb-1.5">
      {showHeader && (
        // Sticks to the top of the rail while scrolling through the area.
        <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-slate-100 bg-white/95 px-3.5 py-1.5 backdrop-blur">
          <Globe2 className="h-3 w-3 shrink-0 text-slate-400" />
          <p className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
            {areaName}
          </p>
          <span className="text-[10px] font-bold tabular-nums text-slate-300">{stores.length}</span>
        </div>
      )}
      <div className="space-y-0.5 px-1.5 pt-1.5">
        {stores.map((s) => {
          const active = s.id === selectedStoreId;
          const tempInStore = tempCountByStore.get(s.id) ?? 0;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex w-full min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition',
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
                title={`${s.employeeCount} karyawan`}
              >
                {s.employeeCount}
              </div>
              <div className="min-w-0 flex-1">
                {s.storeNo && (
                  <p className={cn(
                    'truncate text-[10px] font-bold leading-none tracking-wide',
                    active ? 'text-violet-500' : 'text-slate-400',
                  )}>
                    {s.storeNo}
                  </p>
                )}
                <p
                  className={cn(
                    'line-clamp-2 break-words text-[12px] font-bold leading-snug',
                    s.storeNo && 'mt-0.5',
                    active ? 'text-violet-900' : 'text-slate-800',
                  )}
                  title={s.name}
                >
                  {s.name}
                </p>
                {tempInStore > 0 && (
                  <p className={cn('mt-0.5 flex items-center gap-1 text-[10px] font-semibold', active ? 'text-amber-500' : 'text-amber-600')}>
                    <CalendarClock className="h-2.5 w-2.5 shrink-0" />
                    {tempInStore} periode
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmployeeRow({ employee, onClick }: { employee: ManageEmployee; onClick: () => void }) {
  const tempDays = employee.isTemporary ? daysFromNow(employee.effectiveTo) : null;
  const tempEnding = tempDays != null && tempDays <= 7;

  return (
    <OpsListRow onClick={onClick} ariaLabel={`Kelola ${employee.name}`}>
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <Avatar name={employee.name} src={employee.avatarUrl} size={40} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-bold text-slate-900">{employee.name}</p>
            {!employee.isActive && (
              <span className="shrink-0 rounded border border-slate-300 bg-slate-100 px-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
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
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-[52px] md:justify-end md:pl-0">
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
              <span className="truncate text-[10px] font-semibold text-slate-400">← {employee.previousStoreName}</span>
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
    </OpsListRow>
  );
}

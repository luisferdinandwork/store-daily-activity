'use client';
// components/ops/areas/AreaManagementView.tsx
//
// Shared body of "Area Management": the org-chart layer above individual
// stores. Self-fetching — mounted by both app/ops/areas/page.tsx (OPS HO)
// and app/it/areas/page.tsx (IT); each page supplies its own auth guard and
// header chrome, this component owns everything below that.
//
// Monitoring and settings are one thing here:
//   • a sketch map of Indonesia, each area in its own colour (lib/area-map.ts)
//   • one table — Area · Ops Area · Toko · Task · Attendance · Detail
//   • the Detail modal: rename the area, assign its one OPS Area user (1:1),
//     and see every store with its PIC, today's numbers and a "move" action.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MapPinned, ClipboardCheck, UserCheck, Store, Loader2, Plus, Pencil, Check, X,
  UserX, ChevronsUpDown, ArrowRightLeft, Eye, UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { AreaGroup } from '@/app/api/ops/stores/route';
import type { AreaSettingsRow, AreaStoreRow, OpsAreaUserRow, StorePic } from '@/app/api/ops/areas/route';
import { AttendanceCountsLine } from '@/components/ops/AttendanceStatus';
import { OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import IndonesiaAreaMap, { type MapArea } from '@/components/ops/areas/IndonesiaAreaMap';
import { EMPTY_COUNTS, addCounts, showedUp, type AttendanceCounts } from '@/lib/attendance-health';
import { areaColor, regionsForAreaName } from '@/lib/area-map';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ─── Shared bits ──────────────────────────────────────────────────────────────

function rateColor(rate: number, total: number) {
  if (total === 0) return { text: 'text-slate-400', bar: 'bg-slate-300' };
  if (rate >= 80) return { text: 'text-emerald-600', bar: 'bg-emerald-500' };
  if (rate >= 50) return { text: 'text-amber-600', bar: 'bg-amber-400' };
  return { text: 'text-rose-600', bar: 'bg-rose-500' };
}

function MiniBar({ pct, total }: { pct: number; total: number }) {
  const c = rateColor(pct, total);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn('h-full rounded-full transition-all', c.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ─── Merged row: settings + today's monitoring ───────────────────────────────

type MonitorStore = AreaGroup['stores'][number];

interface AreaRow {
  id: number;
  name: string;
  color: string;
  regions: MapArea['regions'];
  opsUser: AreaSettingsRow['opsUser'];
  stores: AreaStoreRow[];
  monitor: Map<number, MonitorStore>;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  /** Today's attendance across the area's stores (`total` = scheduled). */
  attendance: AttendanceCounts;
  attendanceRate: number;
}

function buildRows(areas: AreaSettingsRow[], groups: AreaGroup[]): AreaRow[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  return areas.map((a, index) => {
    const monitor = new Map<number, MonitorStore>((groupById.get(a.id)?.stores ?? []).map((s) => [s.id, s]));
    let totalTasks = 0, completedTasks = 0;
    let attendance = EMPTY_COUNTS;
    for (const s of monitor.values()) {
      totalTasks += s.taskStats.total;
      completedTasks += s.taskStats.completed;
      attendance = addCounts(attendance, s.attendanceSummary);
    }
    return {
      id: a.id,
      name: a.name,
      color: areaColor(index),
      regions: regionsForAreaName(a.name),
      opsUser: a.opsUser,
      stores: a.stores,
      monitor,
      totalTasks,
      completedTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      attendance,
      attendanceRate: attendance.total > 0 ? Math.round((showedUp(attendance) / attendance.total) * 100) : 0,
    };
  });
}

// ─── Searchable picker (Popover + Command) ───────────────────────────────────
// Replaces the native <select>s: long labels truncate instead of stretching the
// layout, the list scrolls inside the popover, and it is searchable.

interface PickerOption {
  value: string;
  label: string;
  hint?: string;
  /** Text matched by the search box. */
  search: string;
}

function SearchPicker({
  options, value, onPick, placeholder, searchPlaceholder, emptyText, disabled, saving, icon, trigger, align = 'start',
}: {
  options: PickerOption[];
  value: string | null;
  onPick: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  saving?: boolean;
  icon?: ReactNode;
  /** Custom trigger content; default is a full-width select-like button. */
  trigger?: ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            disabled={disabled || saving}
            className={cn(
              'group flex h-10 w-full items-center gap-2 rounded-xl border bg-white px-3 text-left text-sm shadow-xs transition',
              'hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60',
              open ? 'border-indigo-400 ring-4 ring-indigo-100' : 'border-slate-200',
            )}
          >
            {icon}
            <span className="min-w-0 flex-1 truncate">
              {selected ? (
                <span className="font-semibold text-slate-900">{selected.label}</span>
              ) : (
                <span className="text-slate-400">{placeholder}</span>
              )}
            </span>
            {saving ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
            ) : (
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-500" />
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className="w-(--radix-popover-trigger-width) min-w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-slate-200 p-0 shadow-lg"
      >
        <Command
          className="bg-white"
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder={searchPlaceholder} className="h-11 text-base md:text-sm" />
          <CommandList className="max-h-64 p-1.5">
            <CommandEmpty><span className="text-slate-500">{emptyText}</span></CommandEmpty>
            <CommandGroup className="p-0">
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.search}
                  onSelect={() => { setOpen(false); onPick(o.value); }}
                  className="gap-2 rounded-lg px-2.5 py-2 data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{o.label}</span>
                    {o.hint && <span className="block truncate text-[11px] text-slate-400">{o.hint}</span>}
                  </span>
                  {o.value === value && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const NO_OPS = '__none__';

function OpsUserPicker({
  area, opsUsers, saving, onAssign,
}: {
  area: AreaRow;
  opsUsers: OpsAreaUserRow[];
  saving: boolean;
  onAssign: (userId: string | null) => void;
}) {
  const options: PickerOption[] = [
    { value: NO_OPS, label: 'Belum ditugaskan', search: 'belum ditugaskan kosong' },
    ...opsUsers.map((u) => ({
      value: u.id,
      label: u.name,
      hint: `${u.nik}${u.areaId != null && u.areaId !== area.id ? ` · saat ini: ${u.areaName}` : ''}`,
      search: `${u.name} ${u.nik} ${u.areaName ?? ''}`,
    })),
  ];
  return (
    <SearchPicker
      options={options}
      value={area.opsUser?.id ?? NO_OPS}
      onPick={(v) => onAssign(v === NO_OPS ? null : v)}
      placeholder="Pilih Ops Area…"
      searchPlaceholder="Cari nama atau NIK…"
      emptyText="Ops Area tidak ditemukan"
      saving={saving}
      icon={<UserCheck className="h-4 w-4 shrink-0 text-slate-400" />}
    />
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function PicLine({ label, pics }: { label: string; pics: StorePic[] }) {
  return (
    <div className="flex items-baseline gap-1.5 text-xs">
      <span className="w-9 shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      {pics.length === 0 ? (
        <span className="text-slate-300">—</span>
      ) : (
        <span className={cn('min-w-0 truncate font-semibold', pics.length > 1 ? 'text-rose-600' : 'text-slate-700')} title={pics.map((p) => `${p.name} (${p.nik})`).join(', ')}>
          {pics.map((p) => p.name).join(', ')}
        </span>
      )}
    </div>
  );
}

function StoreRowInModal({
  store, live, areas, currentAreaId, moving, onMove,
}: {
  store: AreaStoreRow;
  live: MonitorStore | undefined;
  areas: AreaRow[];
  currentAreaId: number;
  moving: boolean;
  onMove: (newAreaId: number) => void;
}) {
  const options: PickerOption[] = areas
    .filter((a) => a.id !== currentAreaId)
    .map((a) => ({ value: String(a.id), label: a.name, search: a.name }));

  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Store className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-800">{store.name}</p>
          <p className="font-mono text-[11px] text-slate-400">{store.storeNo}</p>
          {live && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className={cn('text-[11px] font-bold tabular-nums', rateColor(live.taskStats.completionRate, live.taskStats.total).text)}>
                Task {live.taskStats.completionRate}%
              </span>
              <AttendanceCountsLine counts={live.attendanceSummary} />
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-0.5 pl-6.5 sm:w-52 sm:shrink-0 sm:pl-0">
        <PicLine label="PIC 1" pics={store.pic1} />
        <PicLine label="PIC 2" pics={store.pic2} />
      </div>

      <div className="pl-6.5 sm:pl-0">
        <SearchPicker
          options={options}
          value={null}
          onPick={(v) => onMove(Number(v))}
          placeholder=""
          searchPlaceholder="Pindahkan ke area…"
          emptyText="Area tidak ditemukan"
          align="end"
          trigger={
            <button
              type="button"
              disabled={moving || options.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
            >
              {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
              Pindah
            </button>
          }
        />
      </div>
    </li>
  );
}

function AreaDetailDialog({
  area, allAreas, opsUsers, busy, onClose, onRename, onAssign, onMoveStore,
}: {
  area: AreaRow | null;
  allAreas: AreaRow[];
  opsUsers: OpsAreaUserRow[];
  busy: Set<string>;
  onClose: () => void;
  onRename: (id: number, name: string) => void;
  onAssign: (id: number, userId: string | null) => void;
  onMoveStore: (storeId: number, newAreaId: number) => void;
}) {
  // Which area's name is being edited — keyed by id so every area opens with a closed editor.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const editing = area != null && editingId === area.id;
  const setEditing = (on: boolean) => setEditingId(on && area ? area.id : null);

  function commitRename() {
    if (!area) return;
    const next = draft.trim();
    if (next && next !== area.name) onRename(area.id, next);
    setEditing(false);
  }

  const taskColor = area ? rateColor(area.completionRate, area.totalTasks) : null;
  const attColor = area ? rateColor(area.attendanceRate, area.attendance.total) : null;

  return (
    <Dialog open={!!area} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {area && taskColor && attColor && (
          <>
            <DialogHeader className="border-b border-slate-100 px-5 py-4 pr-12 text-left">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: area.color }}>
                  <MapPinned className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setEditing(false);
                        }}
                        aria-label="Nama area"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-indigo-300 bg-white px-2.5 text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      />
                      <button type="button" onClick={commitRename} aria-label="Simpan nama" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setEditing(false)} aria-label="Batal" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <DialogTitle className="truncate text-base font-bold text-slate-900">{area.name}</DialogTitle>
                      <button
                        type="button"
                        onClick={() => { setDraft(area.name); setEditing(true); }}
                        aria-label="Ubah nama area"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                      >
                        {busy.has(`rename:${area.id}`) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}
                  <DialogDescription className="mt-0.5 text-xs text-slate-400">
                    {area.stores.length} toko
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <section>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Ops Area bertanggung jawab</p>
                  <OpsUserPicker
                    area={area}
                    opsUsers={opsUsers}
                    saving={busy.has(`assign:${area.id}`)}
                    onAssign={(userId) => onAssign(area.id, userId)}
                  />
                  {!area.opsUser && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-amber-600">
                      <UserX className="h-3 w-3" /> Belum ada Ops Area yang bertanggung jawab
                    </p>
                  )}
                </section>

                <section>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Hari ini</p>
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        <span className="flex items-center gap-1"><ClipboardCheck className="h-3 w-3" /> Task</span>
                        <span className={taskColor.text}>{area.completionRate}%</span>
                      </div>
                      <div className="mt-1"><MiniBar pct={area.completionRate} total={area.totalTasks} /></div>
                      <p className="mt-0.5 text-[10px] text-slate-400">{area.completedTasks}/{area.totalTasks} selesai</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" /> Attendance</span>
                        <span className={attColor.text}>{area.attendanceRate}%</span>
                      </div>
                      <div className="mt-1"><MiniBar pct={area.attendanceRate} total={area.attendance.total} /></div>
                      <AttendanceCountsLine counts={area.attendance} className="mt-0.5" />
                    </div>
                  </div>
                </section>
              </div>

              <section>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Toko di area ini</p>
                {area.stores.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">Belum ada toko di area ini.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {area.stores.map((s) => (
                      <StoreRowInModal
                        key={s.id}
                        store={s}
                        live={area.monitor.get(s.id)}
                        areas={allAreas}
                        currentAreaId={area.id}
                        moving={busy.has(`store:${s.id}`)}
                        onMove={(newAreaId) => onMoveStore(s.id, newAreaId)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── New area ────────────────────────────────────────────────────────────────

function NewAreaDialog({
  open, creating, onOpenChange, onCreate,
}: {
  open: boolean;
  creating: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const submit = () => { if (name.trim()) { onCreate(name.trim()); setName(''); onOpenChange(false); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Area baru</DialogTitle>
          <DialogDescription>
            Sebut wilayahnya di nama area (mis. “Jawa Tengah”, “Kalimantan”) agar area tampil di peta.
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Nama area"
          aria-label="Nama area"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 md:text-sm"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Batal
          </button>
          <button
            type="button"
            disabled={!name.trim() || creating}
            onClick={submit}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />} Buat area
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

const TH = 'px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400';

function AreaTable({
  rows, hoveredId, onHover, onOpen,
}: {
  rows: AreaRow[];
  hoveredId: number | null;
  onHover: (id: number | null) => void;
  onOpen: (id: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/70">
            <tr>
              <th className={TH}>Area</th>
              <th className={TH}>Ops Area</th>
              <th className={cn(TH, 'hidden md:table-cell')}>Toko</th>
              <th className={cn(TH, 'hidden w-44 lg:table-cell')}>Task hari ini</th>
              <th className={cn(TH, 'hidden w-56 lg:table-cell')}>Attendance hari ini</th>
              <th className={cn(TH, 'w-px text-right')}><span className="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((a) => {
              const taskColor = rateColor(a.completionRate, a.totalTasks);
              const attColor = rateColor(a.attendanceRate, a.attendance.total);
              return (
                <tr
                  key={a.id}
                  onMouseEnter={() => onHover(a.id)}
                  onMouseLeave={() => onHover(null)}
                  className={cn('transition-colors', hoveredId === a.id ? 'bg-indigo-50/50' : 'hover:bg-slate-50')}
                >
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: a.color }} aria-hidden />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900">{a.name}</p>
                        <p className="text-[11px] text-slate-400 md:hidden">{a.stores.length} toko</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    {a.opsUser ? (
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-700">{a.opsUser.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">{a.opsUser.nik}</p>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        <UserX className="h-3 w-3" /> Belum ditugaskan
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 align-middle font-semibold tabular-nums text-slate-700 md:table-cell">
                    {a.stores.length}
                  </td>
                  <td className="hidden px-4 py-3 align-middle lg:table-cell">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">{a.completedTasks}/{a.totalTasks}</span>
                      <span className={cn('font-bold tabular-nums', taskColor.text)}>{a.completionRate}%</span>
                    </div>
                    <div className="mt-1"><MiniBar pct={a.completionRate} total={a.totalTasks} /></div>
                  </td>
                  <td className="hidden px-4 py-3 align-middle lg:table-cell">
                    <div className="flex items-center justify-end text-[11px]">
                      <span className={cn('font-bold tabular-nums', attColor.text)}>{a.attendanceRate}%</span>
                    </div>
                    <div className="mt-1"><MiniBar pct={a.attendanceRate} total={a.attendance.total} /></div>
                    <AttendanceCountsLine counts={a.attendance} className="mt-1" />
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <button
                      type="button"
                      onClick={() => onOpen(a.id)}
                      aria-label={`Lihat detail ${a.name}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Detail</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export interface AreaManagementViewHandle {
  reload: () => void;
  loading: boolean;
  areaCount: number;
  storeCount: number;
}

export default function AreaManagementView({
  onReady,
}: {
  /** Called on every load with a small snapshot the host page's header may want to show. */
  onReady?: (info: { loading: boolean; areaCount: number; storeCount: number; reload: () => void }) => void;
}) {
  const [monitorGroups, setMonitorGroups] = useState<AreaGroup[]>([]);
  const [settingsAreas, setSettingsAreas] = useState<AreaSettingsRow[]>([]);
  const [opsUsers, setOpsUsers] = useState<OpsAreaUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [creatingArea, setCreatingArea] = useState(false);
  const [newAreaOpen, setNewAreaOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

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

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    onReady?.({
      loading,
      areaCount: settingsAreas.length,
      storeCount: settingsAreas.reduce((n, a) => n + a.storeCount, 0),
      reload: () => void load(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, settingsAreas]);

  const rows = useMemo(() => buildRows(settingsAreas, monitorGroups), [settingsAreas, monitorGroups]);
  const mapAreas = useMemo<MapArea[]>(
    () => rows.map((r) => ({ id: r.id, name: r.name, color: r.color, regions: r.regions })),
    [rows],
  );
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.opsUser?.name.toLowerCase().includes(q) ||
      a.opsUser?.nik.toLowerCase().includes(q) ||
      a.stores.some((s) =>
        s.name.toLowerCase().includes(q) ||
        s.storeNo.toLowerCase().includes(q) ||
        [...s.pic1, ...s.pic2].some((p) => p.name.toLowerCase().includes(q)),
      ),
    );
  }, [rows, search]);

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
    await withBusy(`assign:${areaId}`, async () => {
      try {
        const res = await fetch(`/api/ops/areas/${areaId}/assign`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to assign');
        toast.success(userId ? 'Ops Area ditugaskan' : 'Penugasan dihapus');
        await load(); // simplest correct way to reflect the 1:1 displacement everywhere
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menugaskan Ops Area');
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <OpsSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Cari area, toko, PIC, atau Ops Area…"
          className="max-w-md"
        />
        <button
          type="button"
          onClick={() => setNewAreaOpen(true)}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> Area baru
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-3">
          <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <MapPinned className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada area</p>
          <p className="mt-1 text-xs text-slate-400">Klik “Area baru” untuk membuat area pertama.</p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Peta area</p>
              <p className="text-[11px] text-slate-400">Klik wilayah untuk membuka detail</p>
            </div>
            <IndonesiaAreaMap areas={mapAreas} hoveredId={hoveredId} onHover={setHoveredId} onSelect={setSelectedId} />
          </section>

          {visibleRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
              <UserRound className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">Tidak ada hasil</p>
              <p className="mt-1 text-xs text-slate-400">Coba kata kunci lain.</p>
            </div>
          ) : (
            <AreaTable rows={visibleRows} hoveredId={hoveredId} onHover={setHoveredId} onOpen={setSelectedId} />
          )}
        </>
      )}

      <AreaDetailDialog
        area={selected}
        allAreas={rows}
        opsUsers={opsUsers}
        busy={busy}
        onClose={() => setSelectedId(null)}
        onRename={handleRename}
        onAssign={handleAssign}
        onMoveStore={handleMoveStore}
      />

      <NewAreaDialog
        open={newAreaOpen}
        creating={creatingArea}
        onOpenChange={setNewAreaOpen}
        onCreate={handleCreateArea}
      />
    </div>
  );
}

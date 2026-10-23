'use client';
// components/it/task-progress/TaskProgressTable.tsx
//
// The store table of one task: grouped bands (needs attention → running → done →
// not scheduled), one row per store. A store with several slots (briefing per
// shift, grooming per employee…) folds them under its row.

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES, type Tone } from '@/lib/status-theme';
import { jakartaTime } from '@/lib/day-bucket';
import { statusBadgeClass, statusLabel } from '@/app/ops/tasks/progress/task-detail';
import {
  GROUP_LABELS,
  nameList,
  shiftLabel,
  storeProgressBadgeClass,
  storeProgressLabel,
  type StoreGroup,
  type StoreProgress,
  type TaskProgressSlot,
  type TaskProgressStore,
} from '@/lib/task-progress';

export interface TableRow {
  store: TaskProgressStore;
  progress: StoreProgress;
}

export interface TableGroup {
  group: StoreGroup;
  rows: TableRow[];
}

const GROUP_TONE: Record<StoreGroup, Tone> = { attention: 'warning', running: 'active', done: 'success', none: 'muted' };
const GROUP_STYLE: Record<StoreGroup, { dot: string; text: string }> = Object.fromEntries(
  (Object.keys(GROUP_TONE) as StoreGroup[]).map((g) => [g, { dot: TONES[GROUP_TONE[g]].dot, text: TONES[GROUP_TONE[g]].strong }]),
) as Record<StoreGroup, { dot: string; text: string }>;

const GRID = 'md:grid md:grid-cols-[minmax(0,1.7fr)_minmax(0,9.5rem)_minmax(0,1.4fr)_minmax(0,7rem)_4.5rem_1.25rem] md:items-center md:gap-4';

/** "3 jam lalu" / "2 hari lalu" for an ISO instant. */
function ageLabel(iso: string | null): string {
  if (!iso) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} mnt`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} jam`;
  return `${Math.floor(mins / 1440)} hari`;
}

function latestTime(slots: TaskProgressSlot[]): string {
  const times = slots.map((s) => s.completedAt).filter((t): t is string => !!t).sort();
  return times.length ? jakartaTime(times[times.length - 1]) : '—';
}

export default function TaskProgressTable({
  groups,
  isPast,
  board,
  onOpen,
}: {
  groups: TableGroup[];
  isPast: boolean;
  board: boolean;
  onOpen: (store: TaskProgressStore, slot: TaskProgressSlot | null) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className={cn('hidden border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400', GRID)}>
        <span>Toko</span>
        <span>Status</span>
        <span>{board ? 'Dibuat oleh' : 'Dikerjakan oleh'}</span>
        <span>{board ? 'Catatan' : 'Shift'}</span>
        <span className="text-right">{board ? 'Menunggu' : 'Jam'}</span>
        <span />
      </div>

      {groups.map(({ group, rows }) => (
        <section key={group} aria-label={GROUP_LABELS[group]}>
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 sm:px-5">
            <span className={cn('h-2 w-2 rounded-full', GROUP_STYLE[group].dot)} />
            <h3 className={cn('text-[11px] font-bold uppercase tracking-widest', GROUP_STYLE[group].text)}>{GROUP_LABELS[group]}</h3>
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">{rows.length}</span>
          </div>
          <ul className="divide-y divide-slate-100 border-b border-slate-100 last:border-b-0">
            {rows.map((row) => (
              <StoreRow key={row.store.storeId} row={row} isPast={isPast} board={board} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StoreRow({
  row: { store, progress },
  isPast,
  board,
  onOpen,
}: {
  row: TableRow;
  isPast: boolean;
  board: boolean;
  onOpen: (store: TaskProgressStore, slot: TaskProgressSlot | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { slots } = store;
  const multi = slots.length > 1;
  const touched = slots.filter((s) => !s.isPlaceholder && s.status !== 'not_started');

  const doers = board ? slots.map((s) => s.doneBy) : touched.map((s) => s.doneBy);
  const shifts = [...new Set(slots.map((s) => s.shift).filter((s): s is string => !!s))].map(shiftLabel);
  const note = board ? slots[0]?.note ?? '' : '';

  const onActivate = () => (multi ? setOpen((v) => !v) : onOpen(store, slots[0] ?? null));
  const ChevronIcon = multi ? (open ? ChevronDown : ChevronRight) : ChevronRight;

  const scheduled = slots.every((s) => s.isPlaceholder) ? nameList(slots.flatMap((s) => s.scheduledNames)) : null;
  // On a finished day, a slot nobody started was missed rather than "not started yet".
  const missed = (slot: TaskProgressSlot) => isPast && !board && slot.status === 'not_started';

  return (
    <li>
      <button
        type="button"
        onClick={onActivate}
        aria-expanded={multi ? open : undefined}
        className={cn('group relative flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 sm:px-5', GRID)}
      >
        {progress.group === 'attention' && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', TONES[progress.key === 'pending' ? 'warning' : isPast ? 'danger' : 'warning'].dot)} />}

        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{store.name}</p>
          <p className="truncate text-[11px] text-slate-400">
            <span className="font-mono font-semibold text-slate-500">{store.storeNo}</span>
            {store.areaName && ` · ${store.areaName}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={cn('whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold', storeProgressBadgeClass(progress.key, isPast))}>
            {storeProgressLabel(progress, isPast, board)}
          </span>
          {multi && !board && <span className="text-[11px] font-semibold tabular-nums text-slate-400">{progress.done}/{progress.total}</span>}
          {board && slots.length > 0 && <span className="text-[11px] font-semibold tabular-nums text-slate-400">{slots.length} item</span>}
        </div>

        <p className={cn('min-w-0 truncate text-xs', doers.some(Boolean) ? 'font-semibold text-slate-700' : 'text-slate-400')}>
          {doers.some(Boolean)
            ? nameList(doers)
            : scheduled && scheduled !== '—'
              ? <>Belum ada · <span className="text-slate-400">terjadwal {scheduled}</span></>
              : '—'}
        </p>

        <p className="min-w-0 truncate text-xs text-slate-500">{board ? note || '—' : shifts.length ? shifts.join(' · ') : '—'}</p>

        <p className="text-xs tabular-nums text-slate-500 md:text-right">
          {board ? ageLabel(slots[0]?.completedAt ?? null) : latestTime(slots)}
        </p>

        <ChevronIcon className="absolute right-4 top-4 h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500 md:static" />
      </button>

      {multi && open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60">
          {slots.map((slot) => (
            <li key={slot.key}>
              <button
                type="button"
                onClick={() => onOpen(store, slot)}
                className={cn('flex w-full flex-col gap-1 py-2.5 pl-8 pr-4 text-left transition-colors hover:bg-white focus:outline-none focus-visible:bg-white sm:pl-10 sm:pr-5', GRID)}
              >
                <p className="truncate text-xs font-semibold text-slate-600">
                  {board ? 'Item serah terima' : shiftLabel(slot.shift)}
                </p>
                <div>
                  <span className={cn('whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold', missed(slot) ? TONES.danger.chip : statusBadgeClass(slot.status))}>
                    {board ? (slot.status === 'pending' ? 'Tertahan' : 'Menunggu') : missed(slot) ? 'Tidak dikerjakan' : statusLabel(slot.status)}
                  </span>
                </div>
                <p className={cn('min-w-0 truncate text-xs', slot.doneBy ? 'font-semibold text-slate-700' : 'text-slate-400')}>
                  {slot.doneBy ?? (slot.scheduledNames.length ? `Belum ada · terjadwal ${nameList(slot.scheduledNames)}` : '—')}
                </p>
                <p className="min-w-0 truncate text-xs text-slate-500">{board ? slot.note ?? '—' : ''}</p>
                <p className="text-xs tabular-nums text-slate-500 md:text-right">{board ? ageLabel(slot.completedAt) : slot.completedAt ? jakartaTime(slot.completedAt) : '—'}</p>
                <ChevronRight className="hidden h-4 w-4 text-slate-300 md:block" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

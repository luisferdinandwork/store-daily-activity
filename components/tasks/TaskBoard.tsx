'use client';
// components/tasks/TaskBoard.tsx
//
// The task board: one row per store, one column per task, one status square per
// cell — the whole day's operation on one screen. Rows and the header stick
// while the board scrolls. Hovering / focusing a square reads who did it and
// when; clicking it opens the task, clicking a store opens its day.
// Used by Ops Task Progress (/ops/tasks/progress) and IT Task Progress (/it/task-progress).

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { jakartaTime } from '@/lib/day-bucket';
import type { TaskCatalogEntry } from '@/lib/shift-tasks';
import {
  BOARD_TASK,
  nameList,
  shiftLabel,
  summariseStore,
  type BoardStore,
  type StoreProgress,
  type TaskProgressSlot,
} from '@/lib/task-progress';
import { CELL_META, CellGlyph, cellStateOf, type CellState } from './TaskCell';

/** Short headers so eleven columns fit; the full name is in the tooltip. */
const SHORT_LABEL: Record<string, string> = {
  store_front: 'Store Front',
  setoran: 'Setoran',
  store_opening: 'Opening',
  cek_uang_modal: 'Uang Modal',
  cek_bin: 'Cek Bin',
  grooming: 'Grooming',
  vm_checklist: 'VM',
  marketing_check: 'Marketing',
  briefing: 'Briefing',
  serah_terima: 'Serah Terima',
  store_closing: 'Closing',
};

export interface BoardRowSummary {
  done: number;
  total: number;
  rate: number;
}

/** Tasks done / tasks scheduled for one store (Serah Terima is a board, not a task, so it doesn't count). */
export function boardRowSummary(store: BoardStore, isPast: boolean): BoardRowSummary {
  let done = 0;
  let total = 0;
  for (const [type, slots] of Object.entries(store.tasks)) {
    if (type === BOARD_TASK) continue;
    const p = summariseStore(slots, isPast);
    if (p.key === 'none') continue;
    total++;
    if (p.key === 'completed') done++;
  }
  return { done, total, rate: total ? Math.round((done / total) * 100) : 0 };
}

function rateColor(rate: number): string {
  if (rate >= 80) return 'bg-emerald-500';
  if (rate >= 50) return 'bg-amber-400';
  return 'bg-rose-500';
}

function slotLine(slot: TaskProgressSlot, isPast: boolean): string {
  const where = slot.shift ? `${shiftLabel(slot.shift)} · ` : '';
  if (slot.status === 'completed' || slot.status === 'verified') {
    return `${where}Selesai oleh ${slot.doneBy ?? '—'}${slot.completedAt ? ` · ${jakartaTime(slot.completedAt)}` : ''}`;
  }
  if (slot.status === 'in_progress') return `${where}Sedang dikerjakan ${slot.doneBy ?? ''}`.trim();
  if (slot.status === 'pending' || slot.status === 'rejected') return `${where}Pending · ${slot.doneBy ?? '—'}`;
  const who = slot.scheduledNames.length ? ` · terjadwal ${nameList(slot.scheduledNames, 3)}` : '';
  return `${where}${isPast ? 'Tidak dikerjakan' : 'Belum dikerjakan'}${who}`;
}

type Hover = { left: number; top: number; title: string; lines: string[] };

export default function TaskBoard({
  stores,
  columns,
  isPast,
  onOpenCell,
  onOpenStore,
  onColumnClick,
  columnHref,
  activeColumn,
  className,
}: {
  stores: BoardStore[];
  columns: TaskCatalogEntry[];
  isPast: boolean;
  onOpenCell: (store: BoardStore, type: string, slots: TaskProgressSlot[]) => void;
  onOpenStore: (store: BoardStore) => void;
  /** Ops: sort by this task. */
  onColumnClick?: (type: string) => void;
  /** IT: the task's own page. */
  columnHref?: (type: string) => string;
  activeColumn?: string | null;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const cells = useMemo(
    () => stores.map((store) => ({
      store,
      summary: boardRowSummary(store, isPast),
      progress: Object.fromEntries(
        columns.map((c) => [c.code, summariseStore(store.tasks[c.code] ?? [], isPast, c.code === BOARD_TASK)] as const),
      ) as Record<string, StoreProgress>,
    })),
    [stores, columns, isPast],
  );

  // Per task: stores done / stores where it was scheduled.
  const columnSummary = useMemo(() => Object.fromEntries(columns.map((c) => {
    let done = 0;
    let total = 0;
    for (const row of cells) {
      const p = row.progress[c.code];
      if (c.code === BOARD_TASK) { total++; if (p.key === 'completed' || p.key === 'none') done++; continue; }
      if (p.key === 'none') continue;
      total++;
      if (p.key === 'completed') done++;
    }
    return [c.code, { done, total }];
  })), [cells, columns]);

  const showTip = (el: HTMLElement, title: string, lines: string[]) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!wrap) return;
    // Keep the 272px card inside the board.
    const left = Math.max(136, Math.min(r.left - wrap.left + r.width / 2, wrap.width - 136));
    setHover({ left, top: r.bottom - wrap.top + 6, title, lines });
  };

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div
        className="max-h-[calc(100vh-15rem)] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm"
        onScroll={() => setHover(null)}
      >
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-[240px] min-w-[200px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Toko
              </th>
              <th className="sticky top-0 z-20 w-[120px] min-w-[112px] border-b border-slate-200 bg-slate-50 px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Progress
              </th>
              {columns.map((c) => {
                const sum = columnSummary[c.code];
                const head = (
                  <>
                    <span className="block text-[11px] font-semibold leading-tight text-slate-700">{SHORT_LABEL[c.code] ?? c.label}</span>
                    <span className="mt-1 block text-[10px] font-medium tabular-nums text-slate-400">
                      {c.code === BOARD_TASK ? `${sum.done}/${sum.total} bersih` : `${sum.done}/${sum.total}`}
                    </span>
                  </>
                );
                const cls = cn(
                  'block w-full rounded-lg px-1 py-1 text-center transition-colors',
                  (onColumnClick || columnHref) && 'hover:bg-white hover:shadow-sm',
                  activeColumn === c.code && 'bg-white shadow-sm ring-1 ring-indigo-200',
                );
                return (
                  <th key={c.code} title={c.label} className="sticky top-0 z-20 min-w-[64px] border-b border-slate-200 bg-slate-50 px-1 py-2 align-bottom">
                    {columnHref ? (
                      <Link href={columnHref(c.code)} className={cls}>{head}</Link>
                    ) : onColumnClick ? (
                      <button type="button" onClick={() => onColumnClick(c.code)} aria-pressed={activeColumn === c.code} className={cls}>{head}</button>
                    ) : (
                      <span className={cls}>{head}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {cells.map(({ store, summary, progress }) => (
              <tr key={store.storeId} className="group">
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-0 py-0 font-normal group-hover:bg-slate-50">
                  <button
                    type="button"
                    onClick={() => onOpenStore(store)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left focus:outline-none focus-visible:bg-indigo-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{store.name}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        <span className="font-mono font-semibold text-slate-500">{store.storeNo}</span>
                        {store.areaName && ` · ${store.areaName}`}
                      </span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
                  </button>
                </th>
                <td className="border-b border-slate-100 px-3 py-2 group-hover:bg-slate-50">
                  {summary.total ? (
                    <div>
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-semibold tabular-nums text-slate-900">{summary.rate}%</span>
                        <span className="tabular-nums text-slate-400">{summary.done}/{summary.total}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn('h-full rounded-full', rateColor(summary.rate))} style={{ width: `${summary.rate}%` }} />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">Tidak ada task</span>
                  )}
                </td>
                {columns.map((c) => {
                  const slots = store.tasks[c.code] ?? [];
                  const board = c.code === BOARD_TASK;
                  const p = progress[c.code];
                  const state: CellState = cellStateOf(p.key, isPast, board);
                  const title = `${c.label} · ${CELL_META[state].label}`;
                  const lines = board
                    ? slots.slice(0, 3).map((s) => `${s.doneBy ?? '—'}: ${s.note ?? ''}`)
                    : slots.slice(0, 4).map((s) => slotLine(s, isPast));
                  if (slots.length > (board ? 3 : 4)) lines.push(`+${slots.length - (board ? 3 : 4)} lagi`);
                  return (
                    <td key={c.code} className={cn('border-b border-slate-100 px-1 py-1.5 text-center group-hover:bg-slate-50', activeColumn === c.code && 'bg-indigo-50/40')}>
                      {state === 'none' ? (
                        <span className="inline-flex h-8 w-8 items-center justify-center text-slate-200" aria-label={`${c.label}: tidak terjadwal`}>·</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenCell(store, c.code, slots)}
                          onPointerEnter={(e) => showTip(e.currentTarget, title, lines)}
                          onPointerLeave={() => setHover(null)}
                          onFocus={(e) => showTip(e.currentTarget, title, lines)}
                          onBlur={() => setHover(null)}
                          aria-label={`${store.name} — ${title}${lines.length ? `. ${lines.join('. ')}` : ''}`}
                          className="rounded-lg p-0.5 transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        >
                          <CellGlyph state={state} progress={p} count={board ? slots.length : undefined} />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-40 w-64 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg"
          style={{ left: hover.left, top: hover.top }}
        >
          <p className="font-semibold text-slate-900">{hover.title}</p>
          {hover.lines.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-slate-600">
              {hover.lines.map((l, i) => <li key={i} className="leading-snug">{l}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

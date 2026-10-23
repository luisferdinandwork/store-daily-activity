'use client';
// components/tasks/TaskCell.tsx
//
// One status square, shared by the task board (stores × tasks) and the per-task
// week/month grids (stores × days). Every state has its own glyph AND colour, so
// the grid never relies on colour alone; the words live in CELL_META (legend,
// tooltip, aria-label).

import { AlertTriangle, Check, Clock3, Minus, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { StoreProgress, StoreProgressKey } from '@/lib/task-progress';
import { CELL_BOX, type CellState } from '@/lib/status-theme';

export type { CellState };

// Words here; the colours of every state are in lib/status-theme.ts (CELL_BOX).
export const CELL_META: Record<CellState, { label: string; box: string }> = {
  done: { label: 'Selesai', box: CELL_BOX.done },
  partial: { label: 'Sebagian', box: CELL_BOX.partial },
  active: { label: 'Sedang dikerjakan', box: CELL_BOX.active },
  flagged: { label: 'Pending', box: CELL_BOX.flagged },
  todo: { label: 'Belum dikerjakan', box: CELL_BOX.todo },
  missed: { label: 'Tidak dikerjakan', box: CELL_BOX.missed },
  none: { label: 'Tidak terjadwal', box: CELL_BOX.none },
  clear: { label: 'Tidak ada yang menunggu', box: CELL_BOX.clear },
  waiting: { label: 'Serah terima menunggu', box: CELL_BOX.waiting },
};

/** Legend order for the board and the grids. */
export const LEGEND_STATES: CellState[] = ['done', 'partial', 'active', 'flagged', 'todo', 'missed', 'none'];

export function cellStateOf(key: StoreProgressKey, isPast: boolean, board = false): CellState {
  if (board) {
    if (key === 'completed' || key === 'none') return 'clear';
    return 'waiting';
  }
  switch (key) {
    case 'completed': return 'done';
    case 'partial': return isPast ? 'missed' : 'partial';
    case 'in_progress': return 'active';
    case 'pending': return 'flagged';
    case 'not_started': return isPast ? 'missed' : 'todo';
    default: return 'none';
  }
}

export function CellGlyph({ state, progress, count, size = 'md' }: {
  state: CellState;
  progress?: Pick<StoreProgress, 'done' | 'total'>;
  /** Serah Terima: how many items are waiting. */
  count?: number;
  size?: 'sm' | 'md';
}) {
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const multi = progress && progress.total > 1;
  let inner: React.ReactNode;
  if (state === 'waiting') inner = <span className="text-[11px] font-bold tabular-nums">{count ?? ''}</span>;
  else if (multi && state !== 'done' && state !== 'none') inner = <span className="text-[10px] font-bold tabular-nums">{progress.done}/{progress.total}</span>;
  else if (state === 'done' || state === 'clear') inner = <Check className={icon} strokeWidth={3} />;
  else if (state === 'active') inner = <Clock3 className={icon} strokeWidth={2.5} />;
  else if (state === 'flagged') inner = <AlertTriangle className={icon} strokeWidth={2.5} />;
  else if (state === 'missed') inner = <X className={icon} strokeWidth={3} />;
  else if (state === 'none') inner = <Minus className={icon} />;
  else inner = null;

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-transform',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        CELL_META[state].box,
      )}
    >
      {inner}
    </span>
  );
}

export function CellLegend({ states = LEGEND_STATES, className }: { states?: CellState[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500', className)}>
      {states.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <CellGlyph state={s} size="sm" />
          {CELL_META[s].label}
        </span>
      ))}
    </div>
  );
}

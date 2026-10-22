'use client';
// components/tasks/HeatGrid.tsx
//
// Rows × days for a week or a month: one square per row per day, either a
// completion % (banded like the rest of Ops: ≥ 80 / ≥ 50 / below) or a task
// status glyph. The first column and the day header stick while it scrolls;
// hovering / focusing a square reads it out, clicking opens that day.

import { useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { CELL_META, CellGlyph, type CellState } from './TaskCell';

export interface HeatRow {
  key: string;
  label: string;
  sublabel?: string;
  /** The whole period for this row (shown beside the label); null = nothing scheduled. */
  summary: { done: number; total: number } | null;
}

export type HeatCell =
  | { kind: 'pct'; done: number; total: number; title: string; lines?: string[] }
  | { kind: 'state'; state: CellState; progress?: { done: number; total: number }; title: string; lines?: string[] };

const WEEKDAY = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function pctBox(pct: number): string {
  if (pct >= 100) return 'bg-emerald-500 text-white';
  if (pct >= 80) return 'bg-emerald-200 text-emerald-900';
  if (pct >= 50) return 'bg-amber-300 text-amber-950';
  if (pct > 0) return 'bg-rose-300 text-rose-950';
  return 'bg-rose-500 text-white';
}

export function PctLegend({ className }: { className?: string }) {
  const items = [
    { box: 'bg-emerald-500', label: '100%' },
    { box: 'bg-emerald-200', label: '80–99%' },
    { box: 'bg-amber-300', label: '50–79%' },
    { box: 'bg-rose-300', label: '1–49%' },
    { box: 'bg-rose-500', label: '0%' },
  ];
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500', className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className={cn('h-3.5 w-3.5 rounded', i.box)} />
          {i.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="text-slate-300">·</span>Tidak ada task</span>
    </div>
  );
}

type Hover = { left: number; top: number; title: string; lines: string[] };

export default function HeatGrid({
  rows,
  days,
  today,
  rowHeader,
  cell,
  onCellClick,
  onRowClick,
  className,
}: {
  rows: HeatRow[];
  days: string[];
  today: string;
  rowHeader: string;
  cell: (row: HeatRow, day: string) => HeatCell | null;
  onCellClick?: (row: HeatRow, day: string) => void;
  onRowClick?: (row: HeatRow) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const showTip = (el: HTMLElement, title: string, lines: string[]) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!wrap) return;
    // Keep the 248px card inside the board.
    const left = Math.max(124, Math.min(r.left - wrap.left + r.width / 2, wrap.width - 124));
    setHover({ left, top: r.bottom - wrap.top + 6, title, lines });
  };

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm" onScroll={() => setHover(null)}>
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-[240px] min-w-[200px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {rowHeader}
              </th>
              <th className="sticky top-0 z-20 w-[120px] min-w-[96px] border-b border-slate-200 bg-slate-50 px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Periode
              </th>
              {days.map((day) => {
                const d = new Date(`${day}T00:00:00Z`);
                const dow = d.getUTCDay();
                const isToday = day === today;
                return (
                  <th
                    key={day}
                    className={cn(
                      'sticky top-0 z-20 min-w-[40px] border-b border-slate-200 bg-slate-50 px-0.5 py-2 text-center',
                      dow === 1 && days.length > 7 && 'border-l border-l-slate-200',
                    )}
                  >
                    <span className={cn('block text-[10px] font-medium', dow === 0 || dow === 6 ? 'text-slate-400' : 'text-slate-500')}>{WEEKDAY[dow]}</span>
                    <span className={cn(
                      'mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      isToday ? 'bg-slate-900 text-white' : 'text-slate-700',
                    )}>
                      {d.getUTCDate()}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rate = row.summary && row.summary.total ? Math.round((row.summary.done / row.summary.total) * 100) : null;
              return (
                <tr key={row.key} className="group">
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white p-0 font-normal group-hover:bg-slate-50">
                    {onRowClick ? (
                      <button type="button" onClick={() => onRowClick(row)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left focus:outline-none focus-visible:bg-indigo-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{row.label}</span>
                          {row.sublabel && <span className="block truncate text-[11px] text-slate-400">{row.sublabel}</span>}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
                      </button>
                    ) : (
                      <div className="px-4 py-2.5">
                        <span className="block truncate text-sm font-semibold text-slate-900">{row.label}</span>
                        {row.sublabel && <span className="block truncate text-[11px] text-slate-400">{row.sublabel}</span>}
                      </div>
                    )}
                  </th>
                  <td className="border-b border-slate-100 px-3 py-2 group-hover:bg-slate-50">
                    {rate === null ? (
                      <span className="text-xs text-slate-300">—</span>
                    ) : (
                      <div>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-semibold tabular-nums text-slate-900">{rate}%</span>
                          <span className="tabular-nums text-slate-400">{row.summary!.done}/{row.summary!.total}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full', rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-400' : 'bg-rose-500')} style={{ width: `${rate}%` }} />
                        </div>
                      </div>
                    )}
                  </td>
                  {days.map((day) => {
                    const c = day > today ? null : cell(row, day);
                    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
                    const tdCls = cn(
                      'border-b border-slate-100 px-0.5 py-1.5 text-center group-hover:bg-slate-50',
                      dow === 1 && days.length > 7 && 'border-l border-l-slate-100',
                      day === today && 'bg-slate-50/80',
                    );
                    if (!c) {
                      return <td key={day} className={tdCls}><span className="inline-flex h-8 w-8 items-center justify-center text-slate-200">·</span></td>;
                    }
                    const lines = c.lines ?? [];
                    const pct = c.kind === 'pct' && c.total ? Math.round((c.done / c.total) * 100) : null;
                    const label = c.kind === 'pct' ? (pct === null ? 'Tidak ada task' : `${pct}% · ${c.done}/${c.total}`) : CELL_META[c.state].label;
                    return (
                      <td key={day} className={tdCls}>
                        <button
                          type="button"
                          disabled={!onCellClick}
                          onClick={() => onCellClick?.(row, day)}
                          onPointerEnter={(e) => showTip(e.currentTarget, c.title, [label, ...lines])}
                          onPointerLeave={() => setHover(null)}
                          onFocus={(e) => showTip(e.currentTarget, c.title, [label, ...lines])}
                          onBlur={() => setHover(null)}
                          aria-label={`${c.title}: ${label}`}
                          className="rounded-lg p-0.5 transition enabled:hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        >
                          {c.kind === 'pct' ? (
                            pct === null ? (
                              <span className="inline-flex h-8 w-8 items-center justify-center text-slate-200">·</span>
                            ) : (
                              <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold tabular-nums', pctBox(pct))}>
                                {pct}
                              </span>
                            )
                          ) : (
                            <CellGlyph state={c.state} progress={c.progress} />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-40 w-60 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg"
          style={{ left: hover.left, top: hover.top }}
        >
          <p className="font-semibold text-slate-900">{hover.title}</p>
          <ul className="mt-1.5 space-y-1 text-slate-600">
            {hover.lines.map((l, i) => <li key={i} className={cn('leading-snug', i === 0 && 'font-semibold text-slate-800')}>{l}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

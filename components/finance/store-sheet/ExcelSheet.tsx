'use client';
// components/finance/store-sheet/ExcelSheet.tsx
//
// "Daily Report All Store" drawn like the Excel Finance keeps it — lettered columns and numbered rows,
// thin gridlines, bold headers, accounting numbers, `d-mmm-yy` dates and freeze panes — but
// neutral: white cells, grey headers, the Finance emerald only for the active row. The header row
// stays put when scrolling down and Kode · Store · Total Sales · Tanggal Sales stay put when
// scrolling right. A row that has data opens its detail (setoran, store closing, photos) in the
// panel the page shows; a day without data is a plain blank line.
//
// Columns, widths and number formats come from lib/store-money-sheet.ts; this file is only the
// look. One border-separate table with sticky cells — every cell owns a right + bottom border so
// the lines stay 1px while the sticky parts scroll.

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  SHEET_COLUMNS,
  SHEET_FROZEN_COLUMNS,
  cellText,
  colLetter,
  columnTotal,
  type SheetColumn,
  type SheetRow,
} from '@/lib/store-money-sheet';

const FONT = '"Aptos Narrow", Calibri, "Segoe UI", Arial, sans-serif';

const GUTTER = 48; // row-number column
const H_LETTERS = 22; // column-letter bar
const H_HEAD = 26; // the header row
const ROW_H = 24;
const FIRST_DATA_ROW = 2; // row 1 is the header, like in Excel

/** Left offset of every frozen column: the gutter, then the widths before it. */
const LEFTS = SHEET_COLUMNS.slice(0, SHEET_FROZEN_COLUMNS).reduce<number[]>((acc, col, i) => {
  acc.push(i === 0 ? GUTTER : acc[i - 1] + SHEET_COLUMNS[i - 1].width);
  return acc;
}, []);

const TABLE_WIDTH = GUTTER + SHEET_COLUMNS.reduce((sum, col) => sum + col.width, 0);

const frozen = (i: number) => i < SHEET_FROZEN_COLUMNS;
const lastFrozen = (i: number) => i === SHEET_FROZEN_COLUMNS - 1;
const leftOf = (i: number) => (frozen(i) ? { left: LEFTS[i] } : undefined);

const GRID = 'border-b border-r border-slate-200';
const FREEZE_RIGHT = 'border-r-slate-400';
const FREEZE_BOTTOM = 'border-b-slate-400';
const BAR = 'bg-slate-50 text-slate-400';
const BAR_ACTIVE = 'bg-emerald-100 text-emerald-800';

// ─── Header ──────────────────────────────────────────────────────────────────

function SheetHead() {
  return (
    <thead>
      {/* A B C … */}
      <tr style={{ height: H_LETTERS }}>
        <th style={{ left: 0, top: 0 }} className={cn(GRID, BAR, 'sticky z-30 border-r-slate-300')} />
        {SHEET_COLUMNS.map((col, i) => (
          <th
            key={col.id}
            style={{ top: 0, ...leftOf(i) }}
            className={cn(
              GRID,
              BAR,
              'sticky text-center text-[11px] font-normal',
              frozen(i) ? 'z-30' : 'z-20',
              lastFrozen(i) && FREEZE_RIGHT,
            )}
          >
            {colLetter(i)}
          </th>
        ))}
      </tr>

      {/* Row 1: the headers — a bank is one column, its total */}
      <tr style={{ height: H_HEAD }}>
        <th
          style={{ left: 0, top: H_LETTERS }}
          className={cn(GRID, BAR, 'sticky z-30 border-r-slate-300 text-center text-[11px] font-normal', FREEZE_BOTTOM)}
        >
          1
        </th>
        {SHEET_COLUMNS.map((col, i) => (
          <th
            key={col.id}
            title={col.title}
            style={{ top: H_LETTERS, ...leftOf(i) }}
            className={cn(
              GRID,
              'bg-slate-100 px-1.5 text-center text-[13px] font-bold leading-tight text-slate-800',
              frozen(i) ? 'sticky z-30' : 'sticky z-20',
              lastFrozen(i) && FREEZE_RIGHT,
              'whitespace-nowrap',
              FREEZE_BOTTOM,
            )}
          >
            {col.head}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// ─── Body ────────────────────────────────────────────────────────────────────

function SheetBodyRow({
  row,
  index,
  active,
  onOpen,
}: {
  row: SheetRow;
  index: number;
  active: boolean;
  onOpen: (date: string) => void;
}) {
  const clickable = row.data !== null;

  return (
    <tr
      style={{ height: ROW_H }}
      className={cn('group', clickable && 'cursor-pointer outline-none')}
      tabIndex={clickable ? 0 : undefined}
      aria-selected={clickable ? active : undefined}
      onClick={clickable ? () => onOpen(row.salesDate) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(row.salesDate);
              }
            }
          : undefined
      }
    >
      <th
        style={{ left: 0 }}
        className={cn(
          GRID,
          'sticky z-10 border-r-slate-300 text-center text-[11px] font-normal tabular-nums',
          active ? BAR_ACTIVE : BAR,
        )}
      >
        {index + FIRST_DATA_ROW}
      </th>
      {SHEET_COLUMNS.map((col, i) => {
        const text = cellText(col, col.value(row));
        const carried = col.derived?.(row) ?? false;
        return (
          <td
            key={col.id}
            title={carried ? 'Sisa yang masih dibawa — belum ada setoran' : col.kind === 'text' ? text : undefined}
            style={leftOf(i)}
            className={cn(
              GRID,
              'overflow-hidden text-ellipsis whitespace-nowrap px-1.5 text-[13px] leading-[23px]',
              col.kind === 'text' ? 'text-left' : 'text-right tabular-nums',
              active ? 'bg-emerald-50' : cn('bg-white', clickable && 'group-hover:bg-slate-50 group-focus-visible:bg-slate-50'),
              carried ? 'italic text-slate-400' : 'text-slate-900',
              col.strong && !carried && 'font-bold',
              frozen(i) && 'sticky z-10',
              lastFrozen(i) && FREEZE_RIGHT,
            )}
          >
            {text}
          </td>
        );
      })}
    </tr>
  );
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

export default function ExcelSheet({
  rows,
  sheetName,
  activeDate,
  onOpen,
}: {
  rows: SheetRow[];
  sheetName: string;
  /** Sales day whose detail is open. */
  activeDate: string | null;
  onOpen: (date: string) => void;
}) {
  const totals = useMemo(() => SHEET_COLUMNS.map((col: SheetColumn) => columnTotal(col, rows)), [rows]);
  const filledDays = useMemo(() => rows.filter((r) => r.data).length, [rows]);

  return (
    <div className="overflow-hidden rounded-sm border border-slate-300 bg-white shadow-sm" style={{ fontFamily: FONT }}>
      <div className="max-h-[calc(100vh-17rem)] min-h-[300px] overflow-auto [scrollbar-gutter:stable]">
        <table
          className="border-separate border-spacing-0"
          style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, tableLayout: 'fixed' }}
        >
          <colgroup>
            <col style={{ width: GUTTER }} />
            {SHEET_COLUMNS.map((col) => (
              <col key={col.id} style={{ width: col.width }} />
            ))}
          </colgroup>

          <SheetHead />

          <tbody>
            {rows.map((row, i) => (
              <SheetBodyRow key={row.salesDate} row={row} index={i} active={row.salesDate === activeDate} onOpen={onOpen} />
            ))}
          </tbody>

          {/* Total line, pinned to the bottom */}
          <tfoot>
            <tr style={{ height: ROW_H + 2 }}>
              <th
                style={{ left: 0, bottom: 0 }}
                className={cn(BAR, 'sticky z-30 border-r border-t-2 border-r-slate-300 border-t-slate-400 text-center text-[11px] font-normal')}
              >
                Σ
              </th>
              {SHEET_COLUMNS.map((col, i) => {
                const total = totals[i];
                return (
                  <td
                    key={col.id}
                    style={{ bottom: 0, ...leftOf(i) }}
                    className={cn(
                      'sticky overflow-hidden whitespace-nowrap border-b border-r border-t-2 border-slate-200 border-t-slate-400 bg-slate-100 px-1.5 text-[13px] font-bold text-slate-900',
                      frozen(i) ? 'z-30' : 'z-20',
                      lastFrozen(i) && FREEZE_RIGHT,
                      col.kind === 'money' ? 'text-right tabular-nums' : 'text-left',
                    )}
                  >
                    {i === 1 ? 'Total' : total === null ? '' : cellText(col, total)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Sheet tab + status */}
      <div className="flex items-stretch justify-between border-t border-slate-300 bg-slate-50 text-xs text-slate-500">
        <span className="border-r border-slate-300 bg-white px-5 py-1.5 font-semibold text-emerald-700 shadow-[inset_0_-2px_0_var(--color-emerald-600)]">
          {sheetName}
        </span>
        <span className="px-4 py-1.5">
          {filledDays} dari {rows.length} hari ada datanya
        </span>
      </div>
    </div>
  );
}

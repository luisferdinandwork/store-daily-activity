// lib/store-money-sheet-xlsx.ts
//
// The "Daily Report All Store" workbook (server-only — pulls in xlsx-js-style): the same sheet as on
// /finance/store-sheet, for the store and period on screen. Same columns (lib/store-money-sheet.ts),
// same look — white cells, grey bold headers, thin grey gridlines, accounting numbers, `d-mmm-yy`
// dates, a carried Sisa in muted italics, a grey Total line — and the same freeze panes: the header
// row, and Kode · Store · Total Sales · Tanggal Sales on the left.

import XlsxStyle from 'xlsx-js-style';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  SHEET_COLUMNS,
  SHEET_FROZEN_COLUMNS,
  colLetter,
  columnTotal,
  type SheetColumn,
  type SheetRow,
} from '@/lib/store-money-sheet';

const FONT = { name: 'Calibri', sz: 11 };
const GRID = { style: 'thin', color: { rgb: 'CBD5E1' } };
const FREEZE = { style: 'thin', color: { rgb: '64748B' } };
const TOTAL_TOP = { style: 'medium', color: { rgb: '64748B' } };
const HEAD_FILL = { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } };

/** The sheet's accounting format: thousands separated, zero as a dash, negatives in brackets. */
const MONEY_FORMAT = '#,##0;(#,##0);"-"';
const DATE_FORMAT = 'd-mmm-yy';

type Border = Partial<Record<'top' | 'bottom' | 'left' | 'right', typeof GRID>>;

/** Gridlines on every side; the line under the header and right of the frozen block is darker. */
const borderOf = (colIndex: number, opts: { header?: boolean; total?: boolean } = {}): Border => ({
  top: opts.total ? TOTAL_TOP : GRID,
  bottom: opts.header ? FREEZE : GRID,
  left: GRID,
  right: colIndex === SHEET_FROZEN_COLUMNS - 1 ? FREEZE : GRID,
});

/** "2026-10-27" → Excel's day serial (1900 date system). */
function excelSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25_569;
}

type Cell = XlsxStyle.CellObject;

function cellFor(col: SheetColumn, row: SheetRow, colIndex: number): Cell | null {
  const value = col.value(row);
  const carried = col.derived?.(row) ?? false;
  const style = {
    font: {
      ...FONT,
      bold: Boolean(col.strong) && !carried,
      italic: carried,
      color: { rgb: carried ? '94A3B8' : '0F172A' },
    },
    alignment: { horizontal: col.kind === 'text' ? 'left' : 'right', vertical: 'center' },
    border: borderOf(colIndex),
  };

  if (value === null) return { t: 's', v: '', s: style };
  if (col.kind === 'money') return { t: 'n', v: Number(value), z: MONEY_FORMAT, s: style };
  if (col.kind === 'date') return { t: 'n', v: excelSerial(String(value)), z: DATE_FORMAT, s: style };
  return { t: 's', v: String(value), s: style };
}

/** Sheet names: at most 31 characters, none of  [ ] : * ? / \ */
const sheetNameOf = (storeNo: string, storeName: string) =>
  `${storeNo} - ${storeName}`.replace(/[[\]:*?/\\]/g, '').slice(0, 31).trim();

/**
 * SheetJS can't write freeze panes, so the pane is added to the finished file: the sheet's view
 * gets a frozen split below the header row and right of the frozen columns.
 */
function freezePanes(file: Uint8Array, columns: number, rows: number): Uint8Array {
  const parts = unzipSync(file);
  const path = 'xl/worksheets/sheet1.xml';
  const entry = parts[path];
  if (!entry) return file;

  const topLeft = `${colLetter(columns)}${rows + 1}`;
  const view =
    `<pane xSplit="${columns}" ySplit="${rows}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>` +
    `<selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`;

  const xml = strFromU8(entry);
  const patched = /<sheetView\b[^>]*\/>/.test(xml)
    ? xml.replace(/<sheetView\b([^>]*)\/>/, `<sheetView$1>${view}</sheetView>`)
    : xml.replace(/(<sheetView\b[^>]*>)/, `$1${view}`);
  if (patched === xml) return file;

  parts[path] = strToU8(patched);
  return zipSync(parts);
}

export function buildStoreSheetWorkbook(input: {
  store: { storeNo: string; name: string };
  rows: SheetRow[];
}): { buffer: Buffer } {
  const { store, rows } = input;
  const ws: XlsxStyle.WorkSheet = {};
  const lastRow = rows.length + 1; // 0-based index of the Total line: header + the days

  // Row 1: headers.
  SHEET_COLUMNS.forEach((col, ci) => {
    ws[XlsxStyle.utils.encode_cell({ r: 0, c: ci })] = {
      t: 's',
      v: col.head,
      s: {
        font: { ...FONT, bold: true, color: { rgb: '1E293B' } },
        fill: HEAD_FILL,
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: borderOf(ci, { header: true }),
      },
    };
  });

  // One line per day of the period, blank ones included — like the page.
  rows.forEach((row, ri) => {
    SHEET_COLUMNS.forEach((col, ci) => {
      const cell = cellFor(col, row, ci);
      if (cell) ws[XlsxStyle.utils.encode_cell({ r: ri + 1, c: ci })] = cell;
    });
  });

  // Total line: SUM() over the days for the columns that add up, with the figure cached.
  const first = 2;
  const last = rows.length + 1;
  SHEET_COLUMNS.forEach((col, ci) => {
    const total = columnTotal(col, rows);
    const style = {
      font: { ...FONT, bold: true, color: { rgb: '0F172A' } },
      fill: HEAD_FILL,
      alignment: { horizontal: col.kind === 'money' ? 'right' : 'left', vertical: 'center' },
      border: borderOf(ci, { total: true }),
    };
    const ref = XlsxStyle.utils.encode_cell({ r: lastRow, c: ci });
    if (ci === 1) ws[ref] = { t: 's', v: 'Total', s: style };
    else if (total === null) ws[ref] = { t: 's', v: '', s: style };
    else {
      ws[ref] = {
        t: 'n',
        v: total,
        f: rows.length > 0 ? `SUM(${colLetter(ci)}${first}:${colLetter(ci)}${last})` : undefined,
        z: MONEY_FORMAT,
        s: style,
      };
    }
  });

  ws['!cols'] = SHEET_COLUMNS.map((col) => ({ wpx: col.width }));
  ws['!rows'] = [{ hpt: 20 }, ...rows.map(() => ({ hpt: 18 })), { hpt: 20 }];
  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: SHEET_COLUMNS.length - 1 } });

  const wb = XlsxStyle.utils.book_new();
  XlsxStyle.utils.book_append_sheet(wb, ws, sheetNameOf(store.storeNo, store.name));

  const raw = XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
  return { buffer: Buffer.from(freezePanes(new Uint8Array(raw), SHEET_FROZEN_COLUMNS, 1)) };
}

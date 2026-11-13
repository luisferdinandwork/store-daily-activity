// lib/petty-cash-transactions-xlsx.ts
//
// Builds the "Petty cash transaction" workbook (server-only — pulls in xlsx-js-style) for
// app/api/finance/petty-cash/transactions/export: ONE sheet laid out exactly like Finance's Business Central
// Purchase Invoice lines sheet ("Purchase Invoice_PPH 21 PRI.xlsx") — same 15 columns, header text, fonts,
// borders, number formats, column widths and row heights, all on the template's grey (the yellow it had on the
// cost columns was dropped by request) — one line per request the page's filters select, in the page's order, then
// a TOTAL line (SUM of the three cost columns). No title, no extra sheets.
//
// What we have per request vs. the fixed values the template carries:
//   Type                       always "Item"
//   No.                        the category's IS (blank when the category has none)
//   Variant Code               blank
//   Description/Comment        the request's Keterangan only, cut to 50 characters
//   VAT Prod. Posting Group    always "NO VAT"
//   Location Code              always "DM"
//   Brand Code                 blank
//   Department Code            the store's BC dept code
//   Quantity                   always 1
//   Unit of Measure Code       always "PCS"
//   Direct Unit Cost Excl. VAT the price the employee reported (actual amount, else the amount asked for)
//   Line Discount %            blank
//   Unit Cost                  the same price
//   Line Discount Amount       0
//   Line Amount Excl. VAT      the same price

import XlsxStyle from 'xlsx-js-style';
import type { TransactionRow } from '@/lib/petty-cash-transactions';

export const PETTY_CASH_EXPORT_NAME = 'Petty cash transaction';

/** The Description/Comment column holds at most this many characters (by request). */
export const EXPORT_DESCRIPTION_MAX = 50;

const HEADERS = [
  'Type',
  'No.',
  'Variant Code',
  'Description/Comment',
  'VAT Prod. Posting Group',
  'Location Code',
  'Brand Code',
  'Department Code',
  'Quantity',
  'Unit of Measure Code',
  'Direct Unit Cost Excl. VAT',
  'Line Discount %',
  'Unit Cost',
  'Line Discount Amount',
  'Line Amount Excl. VAT',
] as const;

// ─── Styles (copied from the template's styles.xml) ──────────────────────────

const GREY = 'F6F7F8';
const HEADER_FONT = { name: 'Segoe UI', sz: 9, color: { rgb: '666666' } };
const BODY_FONT = { name: 'Segoe UI', sz: 10.5, color: { rgb: '212121' } };
const ROW_RULE = { top: { style: 'medium', color: { rgb: 'D3D6DA' } } };
const MONEY = '#,##0';

const fill = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });

const S = {
  header: { font: HEADER_FONT, fill: fill(GREY), alignment: { horizontal: 'left', wrapText: true } },
  text: { font: BODY_FONT, fill: fill(GREY), border: ROW_RULE, alignment: { horizontal: 'left', vertical: 'center' } },
  number: { font: BODY_FONT, fill: fill(GREY), border: ROW_RULE, alignment: { horizontal: 'right', vertical: 'center' } },
  money: {
    font: BODY_FONT,
    fill: fill(GREY),
    border: ROW_RULE,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: MONEY,
  },
  totalLabel: {
    font: { ...BODY_FONT, bold: true },
    fill: fill(GREY),
    border: ROW_RULE,
    alignment: { horizontal: 'left', vertical: 'center' },
  },
  totalMoney: {
    font: { ...BODY_FONT, bold: true },
    fill: fill(GREY),
    border: ROW_RULE,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: MONEY,
  },
};

type Style = (typeof S)[keyof typeof S];

function put(ws: XlsxStyle.WorkSheet, r: number, c: number, value: string | number | null, style: Style) {
  const ref = XlsxStyle.utils.encode_cell({ r, c });
  // A blank cell still carries the template's fill + rule, so it is written as an empty string.
  const v = value ?? '';
  ws[ref] = typeof v === 'number' ? { t: 'n', v, s: style, z: 'numFmt' in style ? style.numFmt : undefined } : { t: 's', v, s: style };
}

// ─── Values ──────────────────────────────────────────────────────────────────

/** The request's Keterangan, on one line and cut to 50 characters. */
export function exportDescription(description: string): string {
  return description.replace(/\s+/g, ' ').trim().slice(0, EXPORT_DESCRIPTION_MAX).trim();
}

/** The price the employee reported: what was really spent, else the amount asked for. */
export const exportPrice = (tx: TransactionRow): number => tx.actualAmount ?? tx.amount;

// ─── Workbook ────────────────────────────────────────────────────────────────

export function buildTransactionsWorkbook(rows: TransactionRow[]): Buffer {
  const ws: XlsxStyle.WorkSheet = {};
  const lastCol = HEADERS.length - 1; // O

  // Header — the grey band runs on to column Z, as in the template.
  for (let c = 0; c <= 25; c++) put(ws, 0, c, c <= lastCol ? HEADERS[c] : null, S.header);

  rows.forEach((tx, i) => {
    const r = i + 1;
    const price = exportPrice(tx);
    put(ws, r, 0, 'Item', S.text);
    put(ws, r, 1, tx.isCode, S.text);
    put(ws, r, 2, null, S.text);
    put(ws, r, 3, exportDescription(tx.description), S.text);
    put(ws, r, 4, 'NO VAT', S.text);
    put(ws, r, 5, 'DM', S.text);
    put(ws, r, 6, null, S.text);
    put(ws, r, 7, tx.deptCode, S.text);
    put(ws, r, 8, 1, S.number);
    put(ws, r, 9, 'PCS', S.text);
    put(ws, r, 10, price, S.money);
    put(ws, r, 11, null, S.money);
    put(ws, r, 12, price, S.money);
    put(ws, r, 13, 0, S.number);
    put(ws, r, 14, price, S.money);
    // The grey band continues to column Y on every line, as in the template.
    for (let c = 15; c <= 24; c++) put(ws, r, c, null, c === 15 || c === 18 ? S.number : S.text);
  });

  // TOTAL line: the three cost columns added up (live SUM formulas over the lines above).
  const totalRow = rows.length + 1;
  const sum = rows.reduce((acc, tx) => acc + exportPrice(tx), 0);
  for (let c = 0; c <= lastCol; c++) put(ws, totalRow, c, null, S.totalLabel);
  put(ws, totalRow, 3, `TOTAL (${rows.length} transaksi)`, S.totalLabel);
  for (const c of [10, 12, 14]) {
    const col = XlsxStyle.utils.encode_col(c);
    put(ws, totalRow, c, sum, S.totalMoney);
    if (rows.length > 0) ws[XlsxStyle.utils.encode_cell({ r: totalRow, c })].f = `SUM(${col}2:${col}${totalRow})`;
  }

  // Column widths + row heights from the template (default width 9).
  const widths: Record<number, number> = { 3: 42.89, 4: 13.78, 7: 18.89, 10: 10.78, 12: 10.78, 13: 15.22, 14: 10.78, 19: 10.22 };
  ws['!cols'] = Array.from({ length: 26 }, (_, c) => ({ width: widths[c] ?? 9 }));
  ws['!rows'] = [{ hpt: 39.6 }, ...rows.map(() => ({ hpt: 17.55 })), { hpt: 17.55 }];
  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: 25 } });

  const wb = XlsxStyle.utils.book_new();
  XlsxStyle.utils.book_append_sheet(wb, ws, PETTY_CASH_EXPORT_NAME);
  return XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
}

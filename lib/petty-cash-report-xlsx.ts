// lib/petty-cash-report-xlsx.ts
//
// Builds the Petty Cash Report workbook (server-only — pulls in xlsx-js-style):
// "Semua Toko" (every store), "Per Kode Toko" (subtotal per store code) and one
// sheet per code. Used by app/api/finance/petty-cash/report/export.

import XlsxStyle from 'xlsx-js-style';
import {
  groupByStoreCode,
  reportMonthLabel,
  storeCodeBrand,
  type PettyCashReportRow,
  type StoreCodeGroup,
} from '@/lib/petty-cash-report';

// ─── Styles ──────────────────────────────────────────────────────────────────

type CellStyle = {
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
  numFmt?: string;
};

const THIN = { style: 'thin', color: { rgb: 'D1D5DB' } };
const THIN_DARK = { style: 'thin', color: { rgb: '475569' } };
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const solid = (hex: string) => ({ patternType: 'solid', fgColor: { rgb: hex } });
const FONT = { name: 'Arial', sz: 10 };

const S = {
  title: { font: { name: 'Arial', sz: 14, bold: true, color: { rgb: '0F172A' } }, alignment: { vertical: 'center' } },
  subtitle: { font: { name: 'Arial', sz: 9, italic: true, color: { rgb: '64748B' } }, alignment: { vertical: 'center' } },
  header: {
    font: { ...FONT, bold: true, color: { rgb: 'FFFFFF' } },
    fill: solid('047857'),
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BOX,
  },
  text: { font: FONT, alignment: { horizontal: 'left', vertical: 'center' }, border: BOX },
  textCenter: { font: FONT, alignment: { horizontal: 'center', vertical: 'center' }, border: BOX },
  mono: { font: { name: 'Consolas', sz: 10 }, alignment: { horizontal: 'left', vertical: 'center' }, border: BOX },
  money: { font: FONT, alignment: { horizontal: 'right', vertical: 'center' }, border: BOX },
  missing: {
    font: { ...FONT, italic: true, color: { rgb: '92400E' } },
    fill: solid('FEF3C7'),
    alignment: { horizontal: 'left', vertical: 'center' },
    border: BOX,
  },
  totalLabel: {
    font: { ...FONT, bold: true },
    fill: solid('ECFDF5'),
    alignment: { horizontal: 'right', vertical: 'center' },
    border: { top: THIN_DARK, bottom: THIN_DARK, left: THIN, right: THIN },
  },
  totalMoney: {
    font: { ...FONT, bold: true },
    fill: solid('ECFDF5'),
    alignment: { horizontal: 'right', vertical: 'center' },
    border: { top: THIN_DARK, bottom: THIN_DARK, left: THIN, right: THIN },
  },
  totalBlank: {
    fill: solid('ECFDF5'),
    border: { top: THIN_DARK, bottom: THIN_DARK, left: THIN, right: THIN },
  },
} satisfies Record<string, CellStyle>;

const MONEY_FORMAT = '#,##0';

function put(
  ws: XlsxStyle.WorkSheet,
  r: number,
  c: number,
  value: string | number,
  style: CellStyle,
  numFmt?: string,
) {
  ws[XlsxStyle.utils.encode_cell({ r, c })] = {
    v: value,
    t: typeof value === 'number' ? 'n' : 's',
    s: numFmt ? { ...style, numFmt } : style,
  };
}

// ─── Sheets ──────────────────────────────────────────────────────────────────

function sheetTitle(ws: XlsxStyle.WorkSheet, lastCol: number, title: string, subtitle: string) {
  put(ws, 0, 0, title, S.title);
  put(ws, 1, 0, subtitle, S.subtitle);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ];
  ws['!rows'] = [{ hpt: 26 }, { hpt: 16 }, { hpt: 6 }, { hpt: 24 }];
}

const HEADER_ROW = 3;

/** One row per store: the "simple Excel" layout Finance works from. */
function buildStoreSheet(title: string, subtitle: string, rows: PettyCashReportRow[]) {
  const ws: XlsxStyle.WorkSheet = {};
  const headers = ['No', 'Kode Toko', 'Nama Toko', 'Total Terpakai (Rp)', 'No. Rekening', 'PIC 1', 'Bank', 'Atas Nama'];
  const lastCol = headers.length - 1;

  ws['!cols'] = [{ wch: 5 }, { wch: 11 }, { wch: 38 }, { wch: 20 }, { wch: 24 }, { wch: 24 }, { wch: 16 }, { wch: 28 }];
  sheetTitle(ws, lastCol, title, subtitle);
  headers.forEach((h, c) => put(ws, HEADER_ROW, c, h, S.header));

  rows.forEach((row, i) => {
    const r = HEADER_ROW + 1 + i;
    put(ws, r, 0, i + 1, S.textCenter);
    put(ws, r, 1, row.storeNo, S.mono);
    put(ws, r, 2, row.storeName, S.text);
    put(ws, r, 3, row.totalUsed, S.money, MONEY_FORMAT);
    // Account numbers go in as text so Excel never turns them into 1.23E+15.
    if (row.accountNumber) put(ws, r, 4, row.accountNumber, S.mono);
    else put(ws, r, 4, 'Belum diisi', S.missing);
    put(ws, r, 5, row.pic1Name ?? '-', S.text);
    put(ws, r, 6, row.bankName ?? '-', row.bankName ? S.text : S.missing);
    put(ws, r, 7, row.accountHolderName ?? '-', row.accountHolderName ? S.text : S.missing);
    ws['!rows']![r] = { hpt: 18 };
  });

  const totalRow = HEADER_ROW + 1 + rows.length;
  const total = rows.reduce((sum, row) => sum + row.totalUsed, 0);
  put(ws, totalRow, 0, '', S.totalBlank);
  put(ws, totalRow, 1, '', S.totalBlank);
  put(ws, totalRow, 2, 'TOTAL', S.totalLabel);
  put(ws, totalRow, 3, total, S.totalMoney, MONEY_FORMAT);
  for (let c = 4; c <= lastCol; c++) put(ws, totalRow, c, '', S.totalBlank);
  ws['!rows']![totalRow] = { hpt: 20 };

  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: lastCol } });
  ws['!autofilter'] = {
    ref: XlsxStyle.utils.encode_range({ s: { r: HEADER_ROW, c: 0 }, e: { r: HEADER_ROW + rows.length, c: lastCol } }),
  };
  return ws;
}

/** One row per store code with its subtotal. */
function buildSummarySheet(title: string, subtitle: string, groups: StoreCodeGroup[]) {
  const ws: XlsxStyle.WorkSheet = {};
  const headers = ['Kode', 'Merek', 'Jumlah Toko', 'Total Terpakai (Rp)', 'Rekening Terisi'];
  const lastCol = headers.length - 1;

  ws['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 18 }];
  sheetTitle(ws, lastCol, title, subtitle);
  headers.forEach((h, c) => put(ws, HEADER_ROW, c, h, S.header));

  groups.forEach((g, i) => {
    const r = HEADER_ROW + 1 + i;
    put(ws, r, 0, g.display, S.mono);
    put(ws, r, 1, g.brand ?? '-', S.text);
    put(ws, r, 2, g.storeCount, S.textCenter);
    put(ws, r, 3, g.totalUsed, S.money, MONEY_FORMAT);
    put(ws, r, 4, `${g.withBankCount} / ${g.storeCount}`, g.withBankCount < g.storeCount ? S.missing : S.textCenter);
    ws['!rows']![r] = { hpt: 18 };
  });

  const totalRow = HEADER_ROW + 1 + groups.length;
  put(ws, totalRow, 0, '', S.totalBlank);
  put(ws, totalRow, 1, 'TOTAL', S.totalLabel);
  put(ws, totalRow, 2, groups.reduce((sum, g) => sum + g.storeCount, 0), S.totalMoney);
  put(ws, totalRow, 3, groups.reduce((sum, g) => sum + g.totalUsed, 0), S.totalMoney, MONEY_FORMAT);
  put(ws, totalRow, 4, '', S.totalBlank);
  ws['!rows']![totalRow] = { hpt: 20 };

  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: lastCol } });
  return ws;
}

export type ReportWorkbookResult =
  | { ok: true; buffer: Buffer; suffix: string }
  | { ok: false; error: string };

export function buildReportWorkbook(input: {
  month: string;
  rows: PettyCashReportRow[];
  /** Narrow to one store code — the raw code (OD) or what the UI shows (ODD). */
  code: string | null;
  onlyUsed: boolean;
  exportedBy: string;
}): ReportWorkbookResult {
  const { month, code, onlyUsed, exportedBy } = input;
  const rows = onlyUsed ? input.rows.filter((r) => r.totalUsed > 0) : input.rows;
  const groups = groupByStoreCode(rows);

  const stamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
  const subtitle = `Periode ${reportMonthLabel(month)}  ·  Diekspor ${stamp} oleh ${exportedBy}${onlyUsed ? '  ·  Hanya toko dengan pemakaian' : ''}`;

  const withBrand = (g: StoreCodeGroup) => {
    const brand = storeCodeBrand(g.code);
    return `LAPORAN PETTY CASH ${g.display}${brand && brand !== g.display ? ` — ${brand}` : ''}`;
  };

  const wb = XlsxStyle.utils.book_new();
  let suffix = '';

  if (code) {
    const group = groups.find((g) => g.code === code || g.display.toUpperCase() === code);
    if (!group) return { ok: false, error: `No stores with code "${code}".` };
    XlsxStyle.utils.book_append_sheet(wb, buildStoreSheet(withBrand(group), subtitle, group.rows), group.display);
    suffix = `_${group.display}`;
  } else {
    XlsxStyle.utils.book_append_sheet(wb, buildStoreSheet('LAPORAN PETTY CASH — SEMUA TOKO', subtitle, rows), 'Semua Toko');
    XlsxStyle.utils.book_append_sheet(wb, buildSummarySheet('RINGKASAN PER KODE TOKO', subtitle, groups), 'Per Kode Toko');
    for (const g of groups) {
      XlsxStyle.utils.book_append_sheet(wb, buildStoreSheet(withBrand(g), subtitle, g.rows), g.display);
    }
  }

  const buffer = XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
  return { ok: true, buffer, suffix };
}

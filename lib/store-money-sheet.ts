// lib/store-money-sheet.ts
// The model behind Finance's "Daily Report All Store" (/finance/store-sheet) — client-safe, no DB imports.
//
// One store, one row per SALES day, laid out like the Excel Finance keeps:
//   Kode · Store · Total Sales · Tanggal Sales · Tanggal Setoran
//   Jumlah Yang Harus Disetor · Jumlah Sales Cash· Jumlah Yang Tidak Disetor · Jumlah Setoran Tunai · Catatan
//   BCA · Mandiri · BRI · OCBC · Indodana — one column each, the bank's Total (QRIS + Debit + Credit
//   are added up; the split is not shown)
//   OP/ME/VOUCHER
// The cash columns come from the Setoran filed the morning after (lib/store-closing-money.ts):
//   Harus Disetor = Wajib disetor (Uang diterima + Sisa kemarin) · Sales Cash = Uang diterima ·
//   Tidak Disetor = Sisa (Wajib disetor − Disetor, carried to the next setoran) · Setoran Tunai = Disetor.
// A day without a setoran (a gap, or the days after the last one) is not empty: its Harus Disetor and
// Tidak Disetor show the Sisa still being carried, exactly like the Excel's running balance — shown
// muted so it is not mistaken for a submitted figure.

import { EDC_BANKS, OP_ME_VOUCHER_LABEL } from '@/lib/store-closing-edc';
import { shiftDate } from '@/lib/finance/dates';
import { hasSalesFigure, totalSales, type ClosingMoneyRow, type MoneyStoreOption } from '@/lib/store-closing-money';

export interface StoreMoneySheet {
  from: string;
  to: string;
  /** Every store, for the picker. */
  stores: MoneyStoreOption[];
  /** The chosen store; null until one is picked. */
  store: MoneyStoreOption | null;
  /** Only the days that have something — see `sheetRows` for the full calendar. */
  rows: ClosingMoneyRow[];
  /** The Sisa still unpaid when the period starts (the last setoran filed before it). */
  openingSisa: number;
}

/** One line of the sheet: a calendar day of the period, with its figures if anyone submitted any. */
export interface SheetRow {
  salesDate: string;
  setoranDate: string;
  store: MoneyStoreOption;
  data: ClosingMoneyRow | null;
  /** The Sisa carried into a day that has no setoran of its own; null on a day with one, or when nothing is owed. */
  carried: number | null;
}

/**
 * Every day from..to (inclusive), oldest first — a day without figures is a blank line, like in the
 * Excel. Walking the days in order also carries the Sisa: it stays what the last setoran left, until
 * the next one (which already counts it in its Wajib disetor).
 */
export function sheetRows(
  store: MoneyStoreOption,
  from: string,
  to: string,
  rows: readonly ClosingMoneyRow[],
  openingSisa = 0,
): SheetRow[] {
  const byDay = new Map(rows.map((r) => [r.salesDate, r]));
  const out: SheetRow[] = [];
  let sisa = openingSisa;
  for (let day = from; day <= to; day = shiftDate(day, 1)) {
    const data = byDay.get(day) ?? null;
    if (data?.setoran) sisa = data.setoran.unpaid;
    out.push({
      salesDate: day,
      setoranDate: shiftDate(day, 1),
      store,
      data,
      carried: data?.setoran || sisa <= 0 ? null : sisa,
    });
  }
  return out;
}

// ─── Columns ─────────────────────────────────────────────────────────────────

export type SheetValue = number | string | null;
export type SheetKind = 'text' | 'date' | 'money';

export interface SheetColumn {
  id: string;
  /** Header text. */
  head: string;
  /** Tooltip on the header: where the figure comes from. */
  title?: string;
  /** Pixels — the Excel's own widths where the column exists there. */
  width: number;
  kind: SheetKind;
  /** Bold figures (worked-out totals). */
  strong?: boolean;
  /** The total line adds this column up. Running balances (Harus Disetor, Tidak Disetor) are left out. */
  sum?: boolean;
  /** The row's value is a carried Sisa, not something submitted that day — drawn muted. */
  derived?: (row: SheetRow) => boolean;
  value: (row: SheetRow) => SheetValue;
}

const setoranOf = (r: SheetRow) => r.data?.setoran ?? null;
const carriedOnly = (r: SheetRow) => !setoranOf(r) && r.carried !== null;

const LEADING: SheetColumn[] = [
  {
    id: 'kode', head: 'Kode', width: 64, kind: 'text',
    value: (r) => r.store.storeNo,
  },
  {
    id: 'store', head: 'Store', width: 176, kind: 'text',
    value: (r) => r.store.name,
  },
  {
    id: 'totalSales', head: 'Total Sales', width: 132, kind: 'money', strong: true, sum: true,
    title: 'Sales Cash + semua bank + OP/ME/VOUCHER',
    value: (r) => (r.data && hasSalesFigure(r.data) ? totalSales(r.data) : null),
  },
  {
    id: 'tanggalSales', head: 'Tanggal Sales', width: 104, kind: 'date',
    value: (r) => r.salesDate,
  },
];

/** Columns frozen on the left (Excel's freeze panes): Kode, Store, Total Sales, Tanggal Sales. */
export const SHEET_FROZEN_COLUMNS = LEADING.length;

const CASH: SheetColumn[] = [
  {
    id: 'tanggalSetoran', head: 'Tanggal Setoran', width: 116, kind: 'date',
    title: 'Hari setoran: sehari setelah Tanggal Sales',
    value: (r) => r.setoranDate,
  },
  {
    id: 'harusDisetor', head: 'Jumlah Yang Harus Disetor', width: 196, kind: 'money',
    title: 'Wajib disetor = Uang diterima + Sisa kemarin (Setoran). Hari tanpa setoran: sisa terakhir yang masih dibawa.',
    derived: carriedOnly,
    value: (r) => setoranOf(r)?.required ?? r.carried,
  },
  {
    id: 'salesCash', head: 'Jumlah Sales Cash', width: 176, kind: 'money', sum: true,
    title: 'Uang aktual diterima toko hari itu (Setoran)',
    value: (r) => setoranOf(r)?.received ?? null,
  },
  {
    id: 'tidakDisetor', head: 'Jumlah Yang Tidak Disetor', width: 190, kind: 'money',
    title: 'Sisa = Wajib disetor − Disetor; dibawa ke setoran berikutnya. Hari tanpa setoran: sisa terakhir.',
    derived: carriedOnly,
    value: (r) => setoranOf(r)?.unpaid ?? r.carried,
  },
  {
    id: 'setoranTunai', head: 'Jumlah Setoran Tunai', width: 160, kind: 'money', sum: true,
    title: 'Uang yang disetor hari itu (Setoran)',
    value: (r) => setoranOf(r)?.stored ?? null,
  },
  {
    id: 'catatan', head: 'Catatan', width: 220, kind: 'text',
    value: (r) => setoranOf(r)?.notes ?? (setoranOf(r)?.isNoSetoran ? 'Tanpa setoran' : null),
  },
];

const BANKS: SheetColumn[] = EDC_BANKS.map<SheetColumn>((bank) => ({
  id: `bank:${bank.code}`,
  head: bank.label,
  title: `${bank.label}: QRIS + Debit + Credit`,
  width: 120,
  kind: 'money',
  sum: true,
  value: (r) => r.data?.banks[bank.code] ?? null,
}));

const OTHER: SheetColumn[] = [
  {
    id: 'opMeVoucher', head: OP_ME_VOUCHER_LABEL, width: 140, kind: 'money', sum: true,
    value: (r) => r.data?.opMeVoucher ?? null,
  },
];

export const SHEET_COLUMNS: readonly SheetColumn[] = [...LEADING, ...CASH, ...BANKS, ...OTHER];

// ─── Excel-style formatting ──────────────────────────────────────────────────

/** 0 → A, 25 → Z, 26 → AA. */
export function colLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-27" → "27-Sep-26" — the Excel's `d-mmm-yy` (always English month names, like its [$-409]). */
export function fmtExcelDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[m - 1]}-${String(y).slice(2)}`;
}

const IDR = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** The Excel's accounting format: thousands separated, zero as "-", negatives in brackets, empty stays empty. */
export function fmtAccounting(value: number | null): string {
  if (value === null) return '';
  if (value === 0) return '-';
  return value < 0 ? `(${IDR.format(-value)})` : IDR.format(value);
}

/** What the cell shows. */
export function cellText(col: SheetColumn, value: SheetValue): string {
  if (value === null) return '';
  if (col.kind === 'money') return fmtAccounting(Number(value));
  if (col.kind === 'date') return fmtExcelDate(String(value));
  return String(value);
}

/** The bottom total line: a sum for the columns that add up, null for the rest. */
export function columnTotal(col: SheetColumn, rows: readonly SheetRow[]): number | null {
  if (!col.sum) return null;
  return rows.reduce((sum, r) => {
    const v = col.value(r);
    return typeof v === 'number' ? sum + v : sum;
  }, 0);
}

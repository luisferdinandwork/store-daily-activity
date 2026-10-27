// lib/store-closing-money.ts
// Shapes and rules for Finance's Store Closing · Report (the daily money sheet) —
// client-safe, no DB imports. Shared by the page, its API and the Excel export.
//
// One row per store per SALES day D, the way Finance keeps it in Excel:
//   • the card side comes from the store's Store Closing of day D — money per
//     bank (all methods added up) plus OP/ME/VOUCHER (lib/store-closing-edc.ts);
//   • the cash side comes from the Setoran the store submitted the morning after
//     (day D + 1): that task asks for "uang aktual diterima kemarin", so it is
//     the cash of day D. Words follow Setoran: Uang diterima / Sisa kemarin /
//     Wajib disetor / Disetor / Sisa.
// Total Sales = cash received + every bank + OP/ME/VOUCHER.

import { EDC_BANKS, summariseEdc, type EdcBankCode, type EdcEntryLike, type EdcMethod } from '@/lib/store-closing-edc';

export { storeCodeOf } from '@/lib/petty-cash-report';
export { groupRowsByCode, type CodeGroup } from '@/lib/finance/code-groups';
export { fmtDateShort, fmtRange, shiftDate, todayJakarta } from '@/lib/finance/dates';

/** Longest period one request may cover (days) — keeps the sheet and the query sane. */
export const MONEY_MAX_DAYS = 93;

export interface ClosingMoneySetoran {
  taskId: number | null;
  /** Uang aktual diterima (the sales day's cash). */
  received: number;
  /** Sisa kemarin — unpaid balance carried in. */
  carryIn: number;
  /** Wajib disetor = received + carryIn. */
  required: number;
  /** Disetor. */
  stored: number;
  /** Sisa = required − stored. */
  unpaid: number;
  isNoSetoran: boolean;
  notes: string | null;
}

/** Per bank, the cells that were filled in by payment method (a blank cell has no key). */
export type BankCells = Record<EdcBankCode, Partial<Record<EdcMethod, number>>>;

export interface ClosingMoneyRow {
  /** `${storeId}:${salesDate}` */
  key: string;
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  /** Letters of the store code — FF001 → "FF". */
  code: string;

  /** YYYY-MM-DD — the day the sales were made (the closing's day). */
  salesDate: string;
  /** YYYY-MM-DD — the day after: when the cash was deposited. */
  setoranDate: string;

  /** The store has a Store Closing for the sales day. */
  hasClosing: boolean;
  /** Per bank: the day's total over all methods, null = the bank was left blank. */
  banks: Record<EdcBankCode, number | null>;
  /** Per bank × method — only present when the report was asked for detail (the per-store sheet). */
  cells?: BankCells;
  /** null = not filled in. */
  opMeVoucher: number | null;

  /** Null = no setoran submitted for the morning after (yet). */
  setoran: ClosingMoneySetoran | null;
}

// ─── Row maths ───────────────────────────────────────────────────────────────

/** Banks + OP/ME/VOUCHER (everything that is not cash). */
export function cardTotal(row: Pick<ClosingMoneyRow, 'banks' | 'opMeVoucher'>): number {
  return bankTotal(row) + (row.opMeVoucher ?? 0);
}

export function bankTotal(row: Pick<ClosingMoneyRow, 'banks'>): number {
  return Object.values(row.banks).reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

/** Cash received + banks + OP/ME/VOUCHER. */
export function totalSales(row: ClosingMoneyRow): number {
  return (row.setoran?.received ?? 0) + cardTotal(row);
}

/** The bank figures of a Store Closing's EDC entries — null for a bank nobody filled in. */
export function bankTotals(entries: readonly EdcEntryLike[]): Record<EdcBankCode, number | null> {
  const summary = summariseEdc(entries, null);
  return Object.fromEntries(summary.banks.map((b) => [b.code, b.filled ? b.total : null])) as Record<EdcBankCode, number | null>;
}

export const emptyBanks = (): Record<EdcBankCode, number | null> =>
  Object.fromEntries(EDC_BANKS.map((b) => [b.code, null])) as Record<EdcBankCode, number | null>;

/** The filled cells of a Store Closing's EDC entries, per bank and method. */
export function bankCells(entries: readonly EdcEntryLike[]): BankCells {
  const summary = summariseEdc(entries, null);
  return Object.fromEntries(summary.banks.map((b) => [b.code, b.cells])) as BankCells;
}

export const emptyCells = (): BankCells =>
  Object.fromEntries(EDC_BANKS.map((b) => [b.code, {}])) as BankCells;

/** Anything at all to show for the day — a setoran, or a Store Closing with a figure on it. */
export function hasSalesFigure(row: ClosingMoneyRow): boolean {
  return Boolean(row.setoran) || (row.hasClosing && (row.opMeVoucher !== null || Object.values(row.banks).some((v) => v !== null)));
}

// ─── Totals ──────────────────────────────────────────────────────────────────

export interface MoneyTotals {
  rows: number;
  totalSales: number;
  received: number;
  carryIn: number;
  required: number;
  stored: number;
  unpaid: number;
  banks: Record<EdcBankCode, number>;
  bankTotal: number;
  opMeVoucher: number;
  /** Banks + OP/ME/VOUCHER. */
  cardTotal: number;
  /** Rows that have no setoran for the morning after. */
  noSetoran: number;
  /** Rows without a Store Closing. */
  noClosing: number;
}

export function sumMoney(rows: readonly ClosingMoneyRow[]): MoneyTotals {
  const banks = Object.fromEntries(EDC_BANKS.map((b) => [b.code, 0])) as Record<EdcBankCode, number>;
  const t: MoneyTotals = {
    rows: rows.length, totalSales: 0, received: 0, carryIn: 0, required: 0, stored: 0, unpaid: 0,
    banks, bankTotal: 0, opMeVoucher: 0, cardTotal: 0, noSetoran: 0, noClosing: 0,
  };
  for (const r of rows) {
    t.totalSales += totalSales(r);
    t.received += r.setoran?.received ?? 0;
    t.carryIn += r.setoran?.carryIn ?? 0;
    t.required += r.setoran?.required ?? 0;
    t.stored += r.setoran?.stored ?? 0;
    t.unpaid += r.setoran?.unpaid ?? 0;
    for (const b of EDC_BANKS) banks[b.code] += r.banks[b.code] ?? 0;
    t.bankTotal += bankTotal(r);
    t.opMeVoucher += r.opMeVoucher ?? 0;
    t.cardTotal += cardTotal(r);
    if (!r.setoran) t.noSetoran += 1;
    if (!r.hasClosing) t.noClosing += 1;
  }
  return t;
}

// ─── Query ───────────────────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type MoneyQuery =
  | { ok: true; from: string; to: string; storeId: number | null }
  | { ok: false; error: string };

/** Reads ?from=&to=[&storeId=] — both days inclusive, `from` ≤ `to`, at most MONEY_MAX_DAYS apart. */
export function parseMoneyQuery(params: URLSearchParams, fallback: { from: string; to: string }): MoneyQuery {
  const from = params.get('from') ?? fallback.from;
  const to = params.get('to') ?? fallback.to;
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return { ok: false, error: 'Invalid period. Use from/to as YYYY-MM-DD.' };
  }
  if (from > to) return { ok: false, error: 'The start of the period is after its end.' };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MONEY_MAX_DAYS) return { ok: false, error: `Pilih periode maksimal ${MONEY_MAX_DAYS} hari.` };

  const rawStore = params.get('storeId');
  const storeId = rawStore ? Number(rawStore) : null;
  if (rawStore && (!Number.isInteger(storeId) || (storeId as number) <= 0)) {
    return { ok: false, error: 'Invalid storeId.' };
  }
  return { ok: true, from, to, storeId };
}

export interface MoneyStoreOption {
  id: number;
  storeNo: string;
  name: string;
}

export interface ClosingMoneyReport {
  from: string;
  to: string;
  rows: ClosingMoneyRow[];
  /** Every store that has a row in the period — feeds the store dropdown. */
  stores: MoneyStoreOption[];
}

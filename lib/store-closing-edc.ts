// lib/store-closing-edc.ts
// ─────────────────────────────────────────────────────────────────────────────
// The EDC summary of a Store Closing — client-safe (no DB imports), shared by
// the employee page, the server utils, Ops task progress and Finance.
//
// At closing the store reads the day's total off each bank's EDC, per payment
// method, and types it in: BCA, Mandiri, BRI, OCBC each split by QRIS / Debit /
// Credit, plus two single amounts, Indodana and OP/ME/VOUCHER. Every field is
// optional — a blank cell is simply "nothing counted". Indodana has no EDC slip
// and no method split; its one figure comes from the Indodana dashboard, whose
// photo is optional unless Indodana had a transaction (see indodanaPhotoRequired)
// — then it is a must. (Rows an earlier QRIS / Debit / Credit Indodana closing
// stored are folded into the single amount by migration 0042.)
//
// The day's Sales Cash is NOT part of this summary: it is its own number on the
// closing (store_closing_tasks.sales_cash_amount) that the next morning's Setoran
// picks up as "Jumlah Sales Cash".
//
// Rows are stored per (bank, method) in store_closing_edc_entries, so adding a
// bank or changing which methods a bank has is a one-line edit of EDC_BANKS
// below — no migration.
// ─────────────────────────────────────────────────────────────────────────────

/** The payment methods an EDC machine splits a bank's day by. */
export const EDC_METHODS = ['qris', 'debit', 'credit'] as const;
export type EdcCardMethod = (typeof EDC_METHODS)[number];

/**
 * A bank with no split (Indodana: one figure off its dashboard) has this single
 * "method" — one cell per day, like OP/ME/VOUCHER. Not a column of the QRIS /
 * Debit / Credit tables.
 */
export const EDC_TOTAL_METHOD = 'total' as const;
export type EdcMethod = EdcCardMethod | typeof EDC_TOTAL_METHOD;

export const EDC_METHOD_LABELS: Record<EdcMethod, string> = {
  qris: 'QRIS',
  debit: 'Debit',
  credit: 'Credit',
  total: 'Total',
};

const TOTAL_ONLY = [EDC_TOTAL_METHOD] as const;

/**
 * The banks a store counts at closing, in the order they are shown.
 * `dashboardPhoto` = needs a photo of the bank's dashboard when it has an amount.
 * Indodana has no EDC slip, so it is one amount, not split by method.
 */
export const EDC_BANKS = [
  { code: 'bca', label: 'BCA', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'mandiri', label: 'Mandiri', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'bri', label: 'BRI', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'ocbc', label: 'OCBC', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'indodana', label: 'Indodana', methods: TOTAL_ONLY, dashboardPhoto: true },
] as const;

/** A bank that is a single amount (no QRIS / Debit / Credit split). */
export function isSingleAmountBank(bank: { methods: readonly string[] }): boolean {
  return bank.methods.length === 1 && bank.methods[0] === EDC_TOTAL_METHOD;
}

export type EdcBank = (typeof EDC_BANKS)[number];
export type EdcBankCode = EdcBank['code'];

/** The one amount that is not a bank. */
export const OP_ME_VOUCHER_LABEL = 'OP/ME/VOUCHER';

/** Rp 99.999.999.999 per cell — far above any real day, far below the column's range. */
export const EDC_MAX_AMOUNT = 99_999_999_999;

export const INDODANA_PHOTO_LABEL = 'Foto Dashboard Indodana';

// ─── Entries ─────────────────────────────────────────────────────────────────

/** One filled-in cell. */
export interface EdcEntry {
  bank: EdcBankCode;
  method: EdcMethod;
  amount: number;
}

/** What the client sends: a cell with `amount: null` is blank (cleared). */
export interface EdcEntryInput {
  bank: string;
  method: string;
  amount: number | null;
}

/** Entry as read from the DB / an API (amount may still be a decimal string). */
export interface EdcEntryLike {
  bank: string;
  method: string;
  amount: number | string;
}

export type EdcParse<T> = { ok: true; value: T } | { ok: false; error: string };

export const edcCellKey = (bank: string, method: string) => `${bank}:${method}`;

const bankByCode = new Map<string, EdcBank>(EDC_BANKS.map((b) => [b.code, b]));

export function edcBankLabel(code: string): string {
  return bankByCode.get(code)?.label ?? code;
}

/** Rows from the DB / an API → typed entries; cells of a bank or method that is no longer configured are dropped. */
export function toEdcEntries(rows: readonly EdcEntryLike[]): EdcEntry[] {
  const out: EdcEntry[] = [];
  for (const row of rows) {
    const bank = bankByCode.get(row.bank);
    const amount = Number(row.amount);
    if (!bank || !Number.isFinite(amount) || !(bank.methods as readonly string[]).includes(row.method)) continue;
    out.push({ bank: bank.code, method: row.method as EdcMethod, amount });
  }
  return out;
}

/** Blank / null → null (not filled in); otherwise a whole, non-negative Rupiah amount. */
export function parseEdcAmount(raw: unknown): EdcParse<number | null> {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { ok: false, error: 'Nominal harus berupa angka bulat Rupiah dan tidak boleh negatif.' };
  }
  if (n > EDC_MAX_AMOUNT) {
    return { ok: false, error: `Nominal terlalu besar (maksimal Rp ${EDC_MAX_AMOUNT.toLocaleString('id-ID')}).` };
  }
  return { ok: true, value: n };
}

/** Validates the client's cells: known bank + one of its methods, sane amount, no cell twice. */
export function parseEdcEntries(raw: unknown): EdcParse<EdcEntryInput[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Data rekap EDC tidak valid.' };

  const seen = new Set<string>();
  const out: EdcEntryInput[] = [];
  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>;
    const bank = typeof row.bank === 'string' ? bankByCode.get(row.bank) : undefined;
    const method = typeof row.method === 'string' ? row.method : '';
    if (!bank || !(bank.methods as readonly string[]).includes(method)) {
      return { ok: false, error: 'Bank atau metode pembayaran EDC tidak dikenal.' };
    }

    const key = edcCellKey(bank.code, method);
    if (seen.has(key)) {
      return { ok: false, error: `${bank.label} ${EDC_METHOD_LABELS[method as EdcMethod]} dikirim lebih dari satu kali.` };
    }
    seen.add(key);

    const amount = parseEdcAmount(row.amount);
    if (!amount.ok) return amount;
    out.push({ bank: bank.code, method, amount: amount.value });
  }
  return { ok: true, value: out };
}

/**
 * Does this closing need the Indodana dashboard photo? Only when Indodana actually
 * had a transaction (its cells add up to more than Rp 0). Blank, "Tidak ada
 * transaksi" and typed zeros leave the photo optional.
 */
export function indodanaPhotoRequired(entries: readonly EdcEntryLike[] | null | undefined): boolean {
  return summariseEdc(entries, null).banks.some((b) => b.dashboardPhoto && b.total > 0);
}

export const INDODANA_PHOTO_REQUIRED_MESSAGE =
  `${INDODANA_PHOTO_LABEL} wajib diupload karena ada transaksi Indodana. Kosongkan/isi 0 nominal Indodana bila tidak ada transaksi.`;

// ─── Totals ──────────────────────────────────────────────────────────────────

export interface EdcBankSummary {
  code: EdcBankCode;
  label: string;
  methods: readonly EdcMethod[];
  /** Filled cells only — a blank cell has no key. */
  cells: Partial<Record<EdcMethod, number>>;
  total: number;
  /** At least one cell filled in (a typed 0 counts). */
  filled: boolean;
  dashboardPhoto: boolean;
}

export interface EdcSummary {
  banks: EdcBankSummary[];
  /** Per payment method across every bank. */
  byMethod: Record<EdcCardMethod, number>;
  /** Banks that are one plain amount (Indodana), all added up — not part of byMethod. */
  singleBanksTotal: number;
  /** All banks together, without OP/ME/VOUCHER. */
  banksTotal: number;
  /** null = not filled in. */
  opMeVoucher: number | null;
  /** Banks + OP/ME/VOUCHER. */
  total: number;
  /** Banks with nothing filled in yet. */
  missingBanks: EdcBankSummary[];
  /** Anything typed in at all — false for a closing made before this format existed. */
  hasData: boolean;
}

export function summariseEdc(
  entries: readonly EdcEntryLike[] | null | undefined,
  opMeVoucher: number | string | null | undefined,
): EdcSummary {
  const byCell = new Map<string, number>();
  for (const e of entries ?? []) {
    const amount = Number(e.amount);
    if (Number.isFinite(amount)) byCell.set(edcCellKey(e.bank, e.method), amount);
  }

  const byMethod = { qris: 0, debit: 0, credit: 0 } satisfies Record<EdcCardMethod, number>;
  let singleBanksTotal = 0;
  const banks: EdcBankSummary[] = EDC_BANKS.map((bank) => {
    const cells: Partial<Record<EdcMethod, number>> = {};
    let total = 0;
    for (const method of bank.methods as readonly EdcMethod[]) {
      const amount = byCell.get(edcCellKey(bank.code, method));
      if (amount === undefined) continue;
      cells[method] = amount;
      total += amount;
      if (method === EDC_TOTAL_METHOD) singleBanksTotal += amount;
      else byMethod[method] += amount;
    }
    return {
      code: bank.code,
      label: bank.label,
      methods: bank.methods as readonly EdcMethod[],
      cells,
      total,
      filled: Object.keys(cells).length > 0,
      dashboardPhoto: bank.dashboardPhoto,
    };
  });

  const op = opMeVoucher == null || opMeVoucher === '' ? null : Number(opMeVoucher);
  const opMe = op != null && Number.isFinite(op) ? op : null;
  const banksTotal = banks.reduce((sum, b) => sum + b.total, 0);

  return {
    banks,
    byMethod,
    singleBanksTotal,
    banksTotal,
    opMeVoucher: opMe,
    total: banksTotal + (opMe ?? 0),
    missingBanks: banks.filter((b) => !b.filled),
    hasData: opMe !== null || banks.some((b) => b.filled),
  };
}

/**
 * One number for the day's sales as a closing states them: Sales Cash + every
 * bank's EDC + OP/ME/VOUCHER. A part nobody filled in counts as 0 and is listed
 * in `missing`, so a partial closing shows a (lower) total with a note.
 */
export interface ClosingSalesTotal {
  /** null = not filled in. */
  salesCash: number | null;
  banksTotal: number;
  /** null = not filled in. */
  opMeVoucher: number | null;
  total: number;
  missing: string[];
  /** Anything at all to add up. */
  hasData: boolean;
}

export function closingSalesTotal(
  summary: EdcSummary,
  salesCash: number | string | null | undefined,
): ClosingSalesTotal {
  const cash = salesCash == null || salesCash === '' ? null : Number(salesCash);
  const salesCashAmount = cash != null && Number.isFinite(cash) ? cash : null;
  const missing: string[] = [];
  if (salesCashAmount === null) missing.push('Sales Cash');
  // A bank left blank is a bank with no sales (every money field is optional), so it isn't "missing".
  if (summary.opMeVoucher === null) missing.push(OP_ME_VOUCHER_LABEL);
  return {
    salesCash: salesCashAmount,
    banksTotal: summary.banksTotal,
    opMeVoucher: summary.opMeVoucher,
    total: (salesCashAmount ?? 0) + summary.total,
    missing,
    hasData: salesCashAmount !== null || summary.hasData,
  };
}


// lib/store-closing-edc.ts
// ─────────────────────────────────────────────────────────────────────────────
// The EDC summary of a Store Closing — client-safe (no DB imports), shared by
// the employee page, the server utils, Ops task progress and Finance.
//
// At closing the store reads the day's total off each bank's EDC, per payment
// method, and types it in: BCA, Mandiri, BRI, OCBC and Indodana, each split by
// QRIS / Debit / Credit, plus one extra amount, OP/ME/VOUCHER. Every field is
// optional — a blank cell is simply "nothing counted". Indodana has no EDC slip;
// its figure comes from the Indodana dashboard, whose photo is optional too.
//
// Rows are stored per (bank, method) in store_closing_edc_entries, so adding a
// bank or changing which methods a bank has is a one-line edit of EDC_BANKS
// below — no migration.
// ─────────────────────────────────────────────────────────────────────────────

export const EDC_METHODS = ['qris', 'debit', 'credit'] as const;
export type EdcMethod = (typeof EDC_METHODS)[number];

export const EDC_METHOD_LABELS: Record<EdcMethod, string> = {
  qris: 'QRIS',
  debit: 'Debit',
  credit: 'Credit',
};

/**
 * The banks a store counts at closing, in the order they are shown.
 * `dashboardPhoto` = needs a photo of the bank's dashboard when it has an amount.
 */
export const EDC_BANKS = [
  { code: 'bca', label: 'BCA', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'mandiri', label: 'Mandiri', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'bri', label: 'BRI', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'ocbc', label: 'OCBC', methods: EDC_METHODS, dashboardPhoto: false },
  { code: 'indodana', label: 'Indodana', methods: EDC_METHODS, dashboardPhoto: true },
] as const;

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
  byMethod: Record<EdcMethod, number>;
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

  const byMethod = { qris: 0, debit: 0, credit: 0 } satisfies Record<EdcMethod, number>;
  const banks: EdcBankSummary[] = EDC_BANKS.map((bank) => {
    const cells: Partial<Record<EdcMethod, number>> = {};
    let total = 0;
    for (const method of bank.methods) {
      const amount = byCell.get(edcCellKey(bank.code, method));
      if (amount === undefined) continue;
      cells[method] = amount;
      total += amount;
      byMethod[method] += amount;
    }
    return {
      code: bank.code,
      label: bank.label,
      methods: bank.methods,
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
    banksTotal,
    opMeVoucher: opMe,
    total: banksTotal + (opMe ?? 0),
    missingBanks: banks.filter((b) => !b.filled),
    hasData: opMe !== null || banks.some((b) => b.filled),
  };
}


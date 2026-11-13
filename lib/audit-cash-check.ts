// lib/audit-cash-check.ts
//
// Audit "Pemeriksaan Kas" — client-safe rules, shapes and formats (no DB imports). Shared by the Audit pages
// (Cek Modal, Cek Petty Cash, Berita Acara), their APIs and the printed Berita Acara Pemeriksaan Kas, which copies
// the "CO" sheet of the audit team's Excel (format stock opname audit.xlsx) cell for cell.
//
// One record per store per Jakarta day (`audit_cash_checks`). Cek Modal fills the MODAL half, Cek Petty Cash the
// PETTY CASH half; the Berita Acara prints whatever is there. Every number on the print is worked out here, from
// the stored inputs, so the screen and the paper can never disagree:
//
//   MODAL                         = the float the store should hold (default UANG_MODAL_MAX_TOTAL)
//   Jumlah Modal + Penjualan      = modal + cash + debit + credit + voucher        (Excel: L7+L12+L11+L10+L9)
//   Jumlah uang tunai KAS Modal   = Σ count × denomination                          (Excel: SUM(L17:L30))
//   Selisih modal                 = fisik − (modal + penjualan)                     (Excel: L31−L13)
//   PETTY CASH                    = the fund (PETTY_CASH_FUND)
//   TOTAL CASHOUT                 = Σ ticked requests + Σ extra lines (qty × price) (Excel: SUM(L38:L47))
//   Sisa petty cash menurut buku  = fund − cashout − refill not received yet        (Excel: L35−L48−L51)
//   Jumlah fisik KAS Petty Cash   = Σ count × denomination                          (Excel: SUM(L55:L68))
//   Selisih petty cash            = fisik − buku                                    (Excel: L69−L52)
//   Selisih Akhir                 = selisih petty cash + selisih modal              (Excel: L71+L33)

import { UANG_MODAL_MAX_TOTAL } from '@/lib/uang-modal-review';

export { UANG_MODAL_MAX_TOTAL };

/** The petty cash fund a store holds — mirrors PETTY_CASH_MAX_BALANCE (schema), kept here so this file stays client-safe. */
export const PETTY_CASH_FUND = 1_000_000;

// ─── Denominations ───────────────────────────────────────────────────────────

export type DenominationKind = 'kertas' | 'koin';

export interface Denomination {
  /** Stable key in the stored counts (`k100000`, `c500`). */
  id: string;
  value: number;
  kind: DenominationKind;
}

/**
 * The money the system knows (Cek Uang Modal's UANG_MODAL_DENOMINATIONS), split the way the Berita Acara lists it:
 * paper Rp 100.000 → Rp 1.000, then coins Rp 1.000 → Rp 100 (Rp 1.000 exists as both).
 */
export const AUDIT_DENOMINATIONS: readonly Denomination[] = [
  { id: 'k100000', value: 100_000, kind: 'kertas' },
  { id: 'k50000', value: 50_000, kind: 'kertas' },
  { id: 'k20000', value: 20_000, kind: 'kertas' },
  { id: 'k10000', value: 10_000, kind: 'kertas' },
  { id: 'k5000', value: 5_000, kind: 'kertas' },
  { id: 'k2000', value: 2_000, kind: 'kertas' },
  { id: 'k1000', value: 1_000, kind: 'kertas' },
  { id: 'c1000', value: 1_000, kind: 'koin' },
  { id: 'c500', value: 500, kind: 'koin' },
  { id: 'c200', value: 200, kind: 'koin' },
  { id: 'c100', value: 100, kind: 'koin' },
];

export const DENOMINATION_KIND_LABEL: Record<DenominationKind, string> = {
  kertas: 'Uang tunai KERTAS',
  koin: 'Uang tunai KOIN',
};

/** The unit word the Excel prints after each count. */
export const DENOMINATION_UNIT: Record<DenominationKind, string> = {
  kertas: 'lembar/pcs',
  koin: 'lembar/coin',
};

/** Pieces counted per denomination id. Missing = 0. */
export type DenominationCounts = Record<string, number>;

/** Largest believable pile of one denomination — stops a typo like 1000000 lembar. */
export const MAX_PIECES = 9_999;

/** Biggest amount a money field takes (Rp 999.999.999). */
export const MAX_MONEY = 999_999_999;

export function normalizeCounts(input: unknown): DenominationCounts {
  const out: DenominationCounts = {};
  if (!input || typeof input !== 'object') return out;
  const raw = input as Record<string, unknown>;
  for (const d of AUDIT_DENOMINATIONS) {
    const n = Math.floor(Number(raw[d.id] ?? 0));
    if (Number.isFinite(n) && n > 0) out[d.id] = Math.min(n, MAX_PIECES);
  }
  return out;
}

export function countsTotal(counts: DenominationCounts | null | undefined): number {
  if (!counts) return 0;
  return AUDIT_DENOMINATIONS.reduce((sum, d) => sum + d.value * (counts[d.id] ?? 0), 0);
}

export function countsPieces(counts: DenominationCounts | null | undefined): number {
  if (!counts) return 0;
  return AUDIT_DENOMINATIONS.reduce((sum, d) => sum + (counts[d.id] ?? 0), 0);
}

/** A whole, non-negative Rupiah amount, clamped; anything unreadable is 0. */
export function toMoney(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_MONEY);
}

// ─── Petty cash checklist ────────────────────────────────────────────────────

/** Where a period's refill stands, seen from Finance ("FA"). */
export type PeriodRefillState =
  | 'none' // nobody asked for it yet
  | 'waiting_ops' // sent, OPS has not approved
  | 'waiting_finance' // OPS approved, Finance has not verified (sent the cash)
  | 'rejected' // OPS turned it down — waiting again
  | 'verified' // Finance verified; the store has not confirmed receiving it
  | 'received'; // the store has both proof photos in

export const PERIOD_REFILL_STATE_LABEL: Record<PeriodRefillState, string> = {
  none: 'Belum diajukan Refill',
  waiting_ops: 'Refill menunggu OPS',
  waiting_finance: 'Refill menunggu Finance',
  rejected: 'Refill ditolak OPS',
  verified: 'Refill dikirim Finance, belum diterima',
  received: 'Refill sudah diterima',
};

/** A completed petty cash request Finance has not covered with a verified refill yet — one checklist line. */
export interface PettyCheckItem {
  txId: number;
  /** Jakarta day the request was filed (YYYY-MM-DD). */
  date: string;
  /** The period (YYYY-MM) it was counted in. */
  periodMonth: string;
  category: string | null;
  /** Keterangan, upper-cased like everywhere else. */
  description: string;
  amount: number;
  imageUrl: string | null;
  isReRequest: boolean;
  requestedBy: string | null;
  /** Ticked by the auditor = the receipt matches; only ticked lines are printed under PENGELUARAN. */
  checked: boolean;
  /** Short auditor note on this line (e.g. "struk tidak ada"). */
  note: string | null;
}

/** A cash-out the system does not have (typed by the auditor) — printed after the system lines. */
export interface PettyExtraItem {
  /** Client key, only for editing. */
  key: string;
  date: string;
  description: string;
  qty: number;
  price: number;
}

export const PETTY_ITEM_NOTE_MAX = 120;
export const PETTY_EXTRA_DESCRIPTION_MAX = 100;
export const PETTY_EXTRA_MAX = 30;
export const NOTES_MAX = 1_000;

export const extraTotal = (e: Pick<PettyExtraItem, 'qty' | 'price'>): number => Math.max(0, e.qty) * Math.max(0, e.price);

// ─── The record ──────────────────────────────────────────────────────────────

export interface Signatory {
  name: string;
  title: string;
}

/** What the Berita Acara prints in its header and signature block. */
export interface BeritaAcaraHeader {
  docNumber: string;
  signCity: string;
  /** YYYY-MM-DD */
  signDate: string;
  holderName: string;
  /** Caption under the holder's name ("Store FS PMF"). */
  holderCaption: string;
  auditorName: string;
  auditorCaption: string;
  known: Signatory;
  approved: Signatory;
}

export interface CashCheckRecord extends BeritaAcaraHeader {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  /** YYYY-MM-DD */
  checkDate: string;
  holderUserId: string | null;

  modalBook: number;
  salesCash: number;
  salesDebit: number;
  salesCredit: number;
  salesVoucher: number;
  modalCounts: DenominationCounts;
  modalNotes: string | null;
  /** ISO time + who — null while Cek Modal was never saved. */
  modalCheckedAt: string | null;
  modalCheckedBy: string | null;

  pettyFund: number;
  pettyItems: PettyCheckItem[];
  pettyExtras: PettyExtraItem[];
  pettyPendingRefill: number;
  pettyCounts: DenominationCounts;
  pettyNotes: string | null;
  /** What PRISM said the box should hold when the check was saved (getSpendable) — a reference only. */
  pettySystemBalance: number | null;
  pettyCheckedAt: string | null;
  pettyCheckedBy: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface CashCheckTotals {
  sales: number;
  modalPlusSales: number;
  modalPhysical: number;
  modalDiff: number;
  cashout: number;
  pettyBook: number;
  pettyPhysical: number;
  pettyDiff: number;
  finalDiff: number;
  checkedCount: number;
  itemCount: number;
}

export function cashCheckTotals(
  r: Pick<
    CashCheckRecord,
    | 'modalBook'
    | 'salesCash'
    | 'salesDebit'
    | 'salesCredit'
    | 'salesVoucher'
    | 'modalCounts'
    | 'pettyFund'
    | 'pettyItems'
    | 'pettyExtras'
    | 'pettyPendingRefill'
    | 'pettyCounts'
  >,
): CashCheckTotals {
  const sales = r.salesCash + r.salesDebit + r.salesCredit + r.salesVoucher;
  const modalPlusSales = r.modalBook + sales;
  const modalPhysical = countsTotal(r.modalCounts);
  const ticked = r.pettyItems.filter((i) => i.checked);
  const cashout = ticked.reduce((s, i) => s + i.amount, 0) + r.pettyExtras.reduce((s, e) => s + extraTotal(e), 0);
  const pettyBook = r.pettyFund - cashout - r.pettyPendingRefill;
  const pettyPhysical = countsTotal(r.pettyCounts);
  const modalDiff = modalPhysical - modalPlusSales;
  const pettyDiff = pettyPhysical - pettyBook;
  return {
    sales,
    modalPlusSales,
    modalPhysical,
    modalDiff,
    cashout,
    pettyBook,
    pettyPhysical,
    pettyDiff,
    finalDiff: pettyDiff + modalDiff,
    checkedCount: ticked.length,
    itemCount: r.pettyItems.length,
  };
}

// ─── Selisih wording ─────────────────────────────────────────────────────────

export type DiffState = 'match' | 'short' | 'over';

export const diffState = (diff: number): DiffState => (diff === 0 ? 'match' : diff < 0 ? 'short' : 'over');

export const DIFF_LABEL: Record<DiffState, string> = {
  match: 'Sesuai',
  short: 'Kurang',
  over: 'Lebih',
};

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SIGN_CITY = 'Jakarta';
export const DEFAULT_AUDITOR_CAPTION = 'Tim Audit';
/** The two names the audit team prints today; IT/Audit can change them per Berita Acara (they carry forward). */
export const DEFAULT_KNOWN: Signatory = { name: 'Verawaty Katrina', title: 'F&A General Manager' };
export const DEFAULT_APPROVED: Signatory = { name: 'Iqbal Taufik / Prihatini Jayanti', title: 'Dept Ops' };

export const SIGNATORY_MAX = 80;
export const DOC_NUMBER_MAX = 60;

export const holderCaptionFor = (storeNo: string): string => `Store ${storeNo}`;

// ─── Document number ─────────────────────────────────────────────────────────

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** "71/IC-SO-FS020/INT/IX/26" — running number of the year / store code / Roman month / 2-digit year. */
export function buildDocNumber(seq: number, storeNo: string, checkDate: string): string {
  const [y, m] = checkDate.split('-');
  return `${seq}/IC-SO-${storeNo}/INT/${ROMAN[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const MONTHS_EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** "16 September 2026" */
export function longDateId(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_ID[m - 1] ?? ''} ${y}`;
}

/** "28-Sep-26" — the Excel's d-mmm-yy. */
export function excelShortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d}-${MONTHS_EN_SHORT[m - 1] ?? ''}-${String(y).slice(2)}`;
}

/** "November 2026" */
export function monthLabelId(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_ID[m - 1] ?? ''} ${y}`;
}

// ─── Number formats ──────────────────────────────────────────────────────────

/** Screen: "Rp 1.250.000" (minus sign kept). */
export const rupiah = (n: number): string => `${n < 0 ? '−' : ''}Rp ${Math.abs(Math.round(n)).toLocaleString('id-ID')}`;

/** Screen, signed for a selisih: "+Rp 18" / "−Rp 5.000" / "Rp 0". */
export const signedRupiah = (n: number): string => (n > 0 ? `+${rupiah(n)}` : rupiah(n));

const US2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const US0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Print, Excel `#,##0.00`: "500,000.00", "-18.00". */
export const xlNumber = (n: number): string => US2.format(n);

/** Print, Excel accounting with 2 decimals: zero shows "-". */
export const xlAccounting = (n: number): string => (n === 0 ? '-' : n < 0 ? `(${US2.format(-n)})` : US2.format(n));

/** Print, Excel accounting without decimals (the PENGELUARAN prices): "6,000", zero "-". */
export const xlAccounting0 = (n: number): string => (n === 0 ? '-' : n < 0 ? `(${US0.format(-n)})` : US0.format(n));

// ─── List row (Berita Acara list) ────────────────────────────────────────────

export interface CashCheckListRow {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  checkDate: string;
  docNumber: string;
  holderName: string;
  auditorName: string;
  modalDone: boolean;
  pettyDone: boolean;
  modalDiff: number | null;
  pettyDiff: number | null;
  finalDiff: number;
  updatedAt: string;
}

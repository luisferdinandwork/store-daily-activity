// lib/audit-stock-opname.ts
// ─────────────────────────────────────────────────────────────────────────────
// Audit "Stock Opname" — client-safe rules, shapes and formats (no DB / BC imports). Shared by the Audit pages
// (/audit/stock-opname, /audit/berita-acara-so), their APIs and the printed documents, which copy the audit
// team's files:
//   • Berita Acara Stock Opname  = the "BA" sheet of format stock opname audit.xlsx (cell for cell);
//   • Surat Pernyataan Hasil SO Store = "Surat Pernyataan SO.doc";
//   • Super Reward = the "Super Reward" sheet of the same workbook (rules: lib/audit-super-reward.ts).
//
// One record per store per Jakarta day (`audit_stock_opnames`). The auditor scans the store's bins in Business
// Central (full or ~50 %, it doesn't matter), then picks the store + day here: the numbers are PRE-FILLED from BC
// (summarizeSoLines) and stay editable; what is saved is a snapshot, so a printed BA never changes when BC does.
//
//   Qty BC  · SOH BC <tgl>              = sohBc                          (Excel E9; E10–E12 are 0)
//   Hasil Scan · Scan All Fisik Barang  = scanQty                        (G10)
//               ShoppingBag             = shoppingBagQty                 (G11)
//               Trans Sales <tgl>       = transSalesQty                  (G12)
//   TOTAL                               = E: sohBc · G: scan + bag + sales   (E14 / G14 = SUM)
//   SELISIH PLUS / (MINUS)              = G14 − E14                      (H16)
//   Selisih all artikel lebih (+)       = valuePlus  (Rp)                (H19)
//   Selisih all artikel kurang (-)      = −valueMinus (Rp)               (H20)
//   SELISIH PLUS / (MINUS) Rp           = H19 + H20                      (H22) — also the "Total Harga Selisih" box
//
// The Rp values need item prices, which BC does not send yet: the first of SO_PRICE_FIELDS found on a Cek Bin line is
// used (Σ per SKU of net qty difference × price). Until then the auditor may type them, or leave them "-".
// ─────────────────────────────────────────────────────────────────────────────

import { isDayKey } from '@/lib/day-bucket';
import { isBcBinCheckHeader, judgeStatus, type BcBinCheckLine } from '@/lib/bin-check';
import type { Signatory } from '@/lib/audit-cash-check';
import type { SoRewardRow } from '@/lib/audit-super-reward';

export type { Signatory };
export { DEFAULT_APPROVED, DEFAULT_KNOWN, DEFAULT_SIGN_CITY, DEFAULT_AUDITOR_CAPTION, longDateId, isDay, isMonth, monthLabelId } from '@/lib/audit-cash-check';

// ─── Limits ──────────────────────────────────────────────────────────────────

export const SO_QTY_MAX = 9_999_999;
export const SO_VALUE_MAX = 99_999_999_999;
export const SO_FINDING_MAX = 200;
export const SO_FINDINGS_MAX = 15;
/** The Surat's "Temuan stock opname" table always shows at least this many rows (the .doc has 5). */
export const SO_FINDING_ROWS = 5;
export const SO_TEXT_MAX = 80;
export const SO_NOTES_MAX = 1_000;

export const DEFAULT_HOLDER_TITLE = 'Head Store';
export const holderCaptionForSo = (storeNo: string): string => `Store ${storeNo}`;
export const personilCaption = (storeNo: string): string => `Personil Store ${storeNo}`;

// ─── Brands (Surat Pernyataan) ───────────────────────────────────────────────

/** The five lines of the Surat, in the .doc's order; the store's own line carries its location, the rest "-". */
export const SO_BRANDS = [
  { key: 'FF', label: 'FISIK FOOTBALL' },
  { key: 'FS', label: 'FISIK SPORT' },
  { key: 'OD', label: 'OUR DAILY DOSE' },
  { key: 'FO', label: 'FACTORY OUTLET' },
  { key: 'SS', label: 'SPECS STORE' },
] as const;

export type SoBrandKey = (typeof SO_BRANDS)[number]['key'] | '';

export const isSoBrandKey = (v: unknown): v is SoBrandKey => v === '' || SO_BRANDS.some((b) => b.key === v);

/** FF001 → FF, FS020 → FS, OD002 → OD … (store codes start with the brand). Unknown prefix → ''. */
export function brandOfStore(storeNo: string): SoBrandKey {
  const prefix = storeNo.trim().slice(0, 2).toUpperCase();
  return SO_BRANDS.find((b) => b.key === prefix)?.key ?? '';
}

/** "Fisik Sport - Plaza Medan Fair" → "PLAZA MEDAN FAIR"; "Factory Outlet-Daan Mogot" → "DAAN MOGOT". */
export function locationOfStore(name: string): string {
  const i = name.indexOf('-');
  const tail = i >= 0 ? name.slice(i + 1) : name;
  return tail.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** The BA's second title line: "Fisik Sport - Plaza Medan Fair" → "FISIK SPORT PLAZA MEDAN FAIR". */
export function defaultStoreTitle(name: string): string {
  return name.replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** "FISIK SPORT PLAZA MEDAN FAIR" → "Fisik Sport Plaza Medan Fair" (the BA's sentence). */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

// ─── BC → suggestion ─────────────────────────────────────────────────────────

/**
 * Where a Cek Bin line's unit price will be, once BC sends one — the FIRST field present wins. Adding the real name
 * here (if BC calls it something else) is the only change needed.
 */
export const SO_PRICE_FIELDS = [
  'unitPrice',
  'unitPriceInclVAT',
  'unitPriceInclVat',
  'salesPrice',
  'retailPrice',
  'price',
  'unitCost',
] as const;

export function linePrice(line: Record<string, unknown>): { field: string; price: number } | null {
  for (const field of SO_PRICE_FIELDS) {
    const raw = line[field];
    if (raw == null || raw === '') continue;
    const price = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(price) && price > 0) return { field, price };
  }
  return null;
}

export type SoFeedState = 'ok' | 'not_configured' | 'unavailable';

/** What BC said for the SO's store + day, as worked out when it was read. Saved with the record as a reference. */
export interface SoBcSnapshot {
  /** The Cek Bin feed. */
  state: SoFeedState;
  fetchedAt: string | null;
  checkedBins: number;
  /** Bins on BC's list for that day that nobody scanned. */
  uncheckedBins: number;
  lines: number;
  correctLines: number;
  wrongLines: number;
  /** Σ binQuantity / Σ scanQuantity over the scanned bins. */
  binQty: number;
  scanQty: number;
  /** Per SKU (item + variant + unit) over all scanned bins: Σ scan − Σ bin; plus / minus as magnitudes. */
  plusQty: number;
  minusQty: number;
  diffSkus: number;
  /** SKUs with a difference that carry a price. */
  pricedDiffSkus: number;
  priceField: string | null;
  /** Rp (magnitudes); null when no difference could be priced at all. */
  plusValue: number | null;
  minusValue: number | null;
  /** Scanned bins whose every line is right / that have at least one wrong line. */
  binsMatch: number;
  binsMismatch: number;
  /** ppQueryBinContents NOW: bins holding stock + quantity in them. */
  storeBinsState: SoFeedState;
  storeBins: number | null;
  storeQty: number | null;
  /** POS sales of the day (pcs), from BC's trans sales entries; null when unavailable. */
  salesQty: number | null;
}

export type SoLineSummary = Pick<
  SoBcSnapshot,
  | 'checkedBins'
  | 'uncheckedBins'
  | 'lines'
  | 'correctLines'
  | 'wrongLines'
  | 'binQty'
  | 'scanQty'
  | 'plusQty'
  | 'minusQty'
  | 'diffSkus'
  | 'pricedDiffSkus'
  | 'priceField'
  | 'plusValue'
  | 'minusValue'
  | 'binsMatch'
  | 'binsMismatch'
>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Raw BC headers (+ every line field) of one store-day → the numbers the Stock Opname starts from. */
export function summarizeSoLines(headers: unknown[], location: string, day: string): SoLineSummary {
  const want = location.trim().toUpperCase();
  const skus = new Map<string, { diff: number; price: { field: string; price: number } | null }>();
  const checked = new Set<string>();
  const unchecked = new Set<string>();
  const badBins = new Set<string>();
  let lines = 0;
  let correctLines = 0;
  let binQty = 0;
  let scanQty = 0;

  for (const raw of headers) {
    if (!isBcBinCheckHeader(raw)) continue;
    if (raw.location && raw.location.trim().toUpperCase() !== want) continue;
    if (raw.date && raw.date.slice(0, 10) !== day) continue;
    const bin = raw.binCode.trim().toUpperCase();
    if (raw.checked === false) {
      unchecked.add(bin);
      continue;
    }
    checked.add(bin);
    const items = Array.isArray(raw.ppBinContentCheckLines) ? raw.ppBinContentCheckLines : [];
    for (const rawLine of items) {
      if (!isRecord(rawLine)) continue;
      const line = rawLine as BcBinCheckLine & Record<string, unknown>;
      if (typeof line.itemNo !== 'string' || !line.itemNo.trim()) continue;
      const scan = num(line.scanQuantity);
      const inBin = num(line.binQuantity);
      lines += 1;
      binQty += inBin;
      scanQty += scan;
      if (judgeStatus(line.binContentCheckStatus, scan, inBin).wrong) badBins.add(bin);
      else correctLines += 1;

      const key = `${line.itemNo.trim().toUpperCase()}|${(line.variantCode ?? '').trim().toUpperCase()}|${(line.unitOfMeasureCode ?? '').trim().toUpperCase()}`;
      const sku = skus.get(key) ?? { diff: 0, price: null };
      sku.diff += scan - inBin;
      sku.price ??= linePrice(line);
      skus.set(key, sku);
    }
  }
  for (const bin of checked) unchecked.delete(bin);

  let plusQty = 0;
  let minusQty = 0;
  let diffSkus = 0;
  let pricedDiffSkus = 0;
  let plusValue = 0;
  let minusValue = 0;
  let priceField: string | null = null;
  for (const sku of skus.values()) {
    if (sku.diff === 0) continue;
    diffSkus += 1;
    if (sku.diff > 0) plusQty += sku.diff;
    else minusQty += -sku.diff;
    if (!sku.price) continue;
    pricedDiffSkus += 1;
    priceField ??= sku.price.field;
    if (sku.diff > 0) plusValue += sku.diff * sku.price.price;
    else minusValue += -sku.diff * sku.price.price;
  }

  return {
    checkedBins: checked.size,
    uncheckedBins: unchecked.size,
    lines,
    correctLines,
    wrongLines: lines - correctLines,
    binQty: Math.round(binQty),
    scanQty: Math.round(scanQty),
    plusQty: Math.round(plusQty),
    minusQty: Math.round(minusQty),
    diffSkus,
    pricedDiffSkus,
    priceField,
    plusValue: pricedDiffSkus > 0 ? Math.round(plusValue) : null,
    minusValue: pricedDiffSkus > 0 ? Math.round(minusValue) : null,
    binsMatch: checked.size - badBins.size,
    binsMismatch: badBins.size,
  };
}

/** The numbers a NEW Stock Opname starts with (the auditor can change every one). */
export interface SoNumbers {
  sohBc: number;
  scanQty: number;
  shoppingBagQty: number;
  transSalesQty: number;
  valuePlus: number | null;
  valueMinus: number | null;
  binsTotal: number;
  binsMatch: number;
  binsMismatch: number;
}

export function suggestFromBc(s: SoBcSnapshot | null): SoNumbers {
  if (!s) {
    return { sohBc: 0, scanQty: 0, shoppingBagQty: 0, transSalesQty: 0, valuePlus: null, valueMinus: null, binsTotal: 0, binsMatch: 0, binsMismatch: 0 };
  }
  return {
    sohBc: s.binQty,
    scanQty: s.scanQty,
    shoppingBagQty: 0,
    transSalesQty: Math.max(0, s.salesQty ?? 0),
    valuePlus: s.plusValue,
    valueMinus: s.minusValue,
    binsTotal: Math.max(s.storeBins ?? 0, s.checkedBins),
    binsMatch: s.binsMatch,
    binsMismatch: s.binsMismatch,
  };
}

// ─── The record ──────────────────────────────────────────────────────────────

export type SoValueSource = 'bc' | 'manual';

export interface StockOpnameRecord extends SoNumbers {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  /** YYYY-MM-DD — the day the bins were scanned. */
  soDate: string;

  docNumber: string;
  signCity: string;
  signDate: string;
  /** BA title line 2 (upper-case); the BA sentence uses it in Title Case. */
  storeTitle: string;

  valueSource: SoValueSource | null;
  findings: string[];
  bcSnapshot: SoBcSnapshot | null;

  suratCity: string;
  suratBrand: SoBrandKey;
  suratLocation: string;

  /** Head Store (normally the store's PIC 1). */
  holderUserId: string | null;
  holderName: string;
  holderCaption: string;
  holderTitle: string;
  auditorName: string;
  auditorCaption: string;
  known: Signatory;
  approved: Signatory;
  /** Dept IR — signs the Super Reward only. */
  ir: Signatory;

  /** Super Reward (Lampiran Regular Reward, lib/audit-super-reward.ts); null until it is first saved. */
  reward: SoRewardRow[] | null;
  rewardCheckedAt: string | null;
  rewardCheckedBy: string | null;

  notes: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SoTotals {
  /** E14 */
  bcTotal: number;
  /** G14 */
  scanTotal: number;
  /** H16 = G14 − E14 (pcs) */
  qtyDiff: number;
  /** H19 / H20 (Rp, H20 negative) */
  valuePlus: number;
  valueMinus: number;
  /** H22 = H19 + H20; null while neither is filled. */
  valueTotal: number | null;
}

export function soTotals(r: Pick<SoNumbers, 'sohBc' | 'scanQty' | 'shoppingBagQty' | 'transSalesQty' | 'valuePlus' | 'valueMinus'>): SoTotals {
  const bcTotal = r.sohBc;
  const scanTotal = r.scanQty + r.shoppingBagQty + r.transSalesQty;
  const valuePlus = r.valuePlus ?? 0;
  const valueMinus = -(r.valueMinus ?? 0);
  return {
    bcTotal,
    scanTotal,
    qtyDiff: scanTotal - bcTotal,
    valuePlus,
    valueMinus,
    valueTotal: r.valuePlus == null && r.valueMinus == null ? null : valuePlus + valueMinus,
  };
}

export type DiffSide = 'plus' | 'minus' | null;
export const diffSide = (n: number | null): DiffSide => (!n ? null : n > 0 ? 'plus' : 'minus');

// ─── Input clean-up (server + client) ────────────────────────────────────────

export function toQty(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, SO_QTY_MAX);
}

/** null / '' = not filled ("-" on paper); otherwise a whole, non-negative Rupiah amount. */
export function toValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, SO_VALUE_MAX);
}

export function cleanFindings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((f) => (typeof f === 'string' ? f.replace(/\s+/g, ' ').trim().slice(0, SO_FINDING_MAX) : ''))
    .filter(Boolean)
    .slice(0, SO_FINDINGS_MAX);
}

export const isSoDate = (v: unknown): v is string => typeof v === 'string' && isDayKey(v);

// ─── Dates + numbers on paper ────────────────────────────────────────────────

const MONTHS_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sept', 'Okt', 'Nov', 'Des'];

/** "16 Sept 2026" — the Surat's short date. */
export function shortDateId(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_SHORT_ID[m - 1] ?? ''} ${y}`;
}

const ID0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** "6.227" (the BA sheet as Excel shows it on an Indonesian PC). */
export const idNumber = (n: number): string => ID0.format(Math.round(n));

/** Screen: "Rp 1.250.000", "−Rp 5.000". */
export const soRupiah = (n: number): string => `${n < 0 ? '−' : ''}Rp ${idNumber(Math.abs(n))}`;

/** Screen: "+12 pcs", "−3 pcs", "0 pcs". */
export const signedPcs = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${idNumber(Math.abs(n))} pcs`;

/** The box under the perincian: "Total Harga Selisih Barang Plus / Minus = -" / "= Rp 1.250.000" / "= -Rp 5.000". */
export function totalHargaText(total: number | null): string {
  const value = !total ? '-' : `${total < 0 ? '-' : ''}Rp ${idNumber(Math.abs(total))}`;
  return `Total Harga Selisih Barang Plus / Minus = ${value}`;
}

// ─── List row ────────────────────────────────────────────────────────────────

export interface StockOpnameListRow {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  soDate: string;
  docNumber: string;
  auditorName: string;
  holderName: string;
  bcTotal: number;
  scanTotal: number;
  qtyDiff: number;
  valueTotal: number | null;
  binsTotal: number;
  binsMatch: number;
  binsMismatch: number;
  findings: number;
  /** Super Reward rows saved (null = not filled yet). */
  rewardRows: number | null;
  updatedAt: string;
}

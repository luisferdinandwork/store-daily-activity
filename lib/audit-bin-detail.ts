// lib/audit-bin-detail.ts
// ─────────────────────────────────────────────────────────────────────────────
// Audit "Hasil Cek Bin" → detail of ONE store-day: the whole answer of Business Central (ppBinContentCheckHeaders +
// ppBinContentCheckLines), one row per item line with the API's own column names, grouped PER BIN. Pure, client-safe.
//
// What is added on top of the raw rows: the verdict of the line (`judgeStatus` — the same rule the report and the staff
// app use), and a per-bin summary. A bin is WRONG as soon as one of its lines is wrong (the report counts bins the same
// way, lib/audit-bin-report.ts). Any field BC sends on a line that is not one of the known ones (a price BC adds later,
// for instance) is kept in `extra` and shown as an extra column — the page never needs a code change to show it.
// ─────────────────────────────────────────────────────────────────────────────

import { BIN_CHECK_REASON_META, decodeODataText, isBcBinCheckHeader, judgeStatus, type BinCheckReason } from '@/lib/bin-check';

/** Columns the table always has, in the API's order and under the API's names. */
export const BIN_DETAIL_COLUMNS = [
  'binCode',
  'itemNo',
  'variantCode',
  'unitOfMeasureCode',
  'actualBinCodes',
  'scanQuantity',
  'binQuantity',
  'binContentCheckStatus',
] as const;

const KNOWN_LINE_KEYS = new Set<string>(['date', 'location', 'binCode', 'itemNo', 'variantCode', 'unitOfMeasureCode', 'actualBinCodes', 'scanQuantity', 'binQuantity', 'binContentCheckStatus']);

export type ExtraValue = string | number | boolean | null;

export interface BinDetailLine {
  /** Row number in the answer, 1-based (header order, then line order). */
  no: number;
  /** The bin that was being checked (the header's binCode). */
  binCode: string;
  /** False = a bin BC listed that nobody scanned. */
  checked: boolean;
  itemNo: string;
  variantCode: string;
  unitOfMeasureCode: string;
  /** Where the item belongs, as BC sends it (`A|B` = several bins). */
  actualBinCodes: string;
  scanQuantity: number | null;
  binQuantity: number | null;
  /** BC's `binContentCheckStatus`, OData escapes decoded ("" = a right line). */
  status: string;
  wrong: boolean;
  reason: BinCheckReason | null;
  /** Every other scalar field of the line. */
  extra: Record<string, ExtraValue>;
}

export interface BinDetailBin {
  binCode: string;
  checked: boolean;
  /** Position of the bin's first header in BC's answer (0-based) — "Urutan BC". */
  order: number;
  /** Item lines in the bin. */
  lines: number;
  /** Right item lines. */
  correct: number;
  /** Wrong item lines — the bin is wrong when this is > 0. */
  wrong: number;
  scanQty: number;
  binQty: number;
  /** Wrong lines per reason (only reasons that occur). */
  reasons: Partial<Record<BinCheckReason, number>>;
}

export interface BinDetail {
  lines: BinDetailLine[];
  bins: BinDetailBin[];
  /** Union of the `extra` keys of all lines, sorted — the extra columns of the table. */
  extraColumns: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const toQty = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string => (typeof v === 'string' ? decodeODataText(v).trim() : v == null ? '' : String(v));

/** The raw BC headers (with their expanded lines) of one store-day → the detail table. */
export function buildBinDetail(headers: readonly unknown[]): BinDetail {
  const lines: BinDetailLine[] = [];
  const bins = new Map<string, BinDetailBin>();
  const extraKeys = new Set<string>();

  for (const raw of headers) {
    if (!isBcBinCheckHeader(raw)) continue;
    const binCode = raw.binCode.trim();
    const checked = raw.checked !== false;
    const bin: BinDetailBin = bins.get(binCode) ?? { binCode, checked, order: bins.size, lines: 0, correct: 0, wrong: 0, scanQty: 0, binQty: 0, reasons: {} };
    bin.checked = bin.checked || checked;
    bins.set(binCode, bin);

    const rawLines = Array.isArray(raw.ppBinContentCheckLines) ? raw.ppBinContentCheckLines : [];
    for (const rawLine of rawLines) {
      if (!isRecord(rawLine)) continue;
      const scanQuantity = toQty(rawLine.scanQuantity);
      const binQuantity = toQty(rawLine.binQuantity);
      const status = text(rawLine.binContentCheckStatus);
      const verdict = judgeStatus(typeof rawLine.binContentCheckStatus === 'string' ? rawLine.binContentCheckStatus : '', scanQuantity, binQuantity);

      const extra: Record<string, ExtraValue> = {};
      for (const [key, value] of Object.entries(rawLine)) {
        if (KNOWN_LINE_KEYS.has(key) || key.startsWith('@')) continue;
        if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          extra[key] = typeof value === 'string' ? decodeODataText(value) : (value ?? null);
          extraKeys.add(key);
        }
      }

      lines.push({
        no: lines.length + 1,
        binCode,
        checked,
        itemNo: text(rawLine.itemNo),
        variantCode: text(rawLine.variantCode),
        unitOfMeasureCode: text(rawLine.unitOfMeasureCode),
        actualBinCodes: text(rawLine.actualBinCodes),
        scanQuantity,
        binQuantity,
        status,
        wrong: verdict.wrong,
        reason: verdict.wrong ? verdict.reason : null,
        extra,
      });
      bin.lines += 1;
      if (verdict.wrong) {
        bin.wrong += 1;
        bin.reasons[verdict.reason] = (bin.reasons[verdict.reason] ?? 0) + 1;
      } else bin.correct += 1;
      bin.scanQty += scanQuantity ?? 0;
      bin.binQty += binQuantity ?? 0;
    }
  }

  return {
    lines,
    bins: [...bins.values()].sort((a, b) => a.binCode.localeCompare(b.binCode, 'en', { numeric: true })),
    extraColumns: [...extraKeys].sort(),
  };
}

/** Wrong lines per reason over a set of bins, in the order the reasons are shown (only reasons that occur). */
export function reasonCounts(bins: readonly Pick<BinDetailBin, 'reasons'>[]): Array<{ reason: BinCheckReason; count: number }> {
  const sum = new Map<BinCheckReason, number>();
  for (const b of bins) for (const [r, n] of Object.entries(b.reasons) as [BinCheckReason, number][]) sum.set(r, (sum.get(r) ?? 0) + n);
  return [...sum.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => BIN_CHECK_REASON_META[a.reason].order - BIN_CHECK_REASON_META[b.reason].order);
}

/** What the page's totals say — over the bins that were scanned (`checked`), counted per BIN like the report. */
export function binDetailTotals(detail: Pick<BinDetail, 'lines' | 'bins'>) {
  const scannedBins = detail.bins.filter((b) => b.checked);
  const wrongBins = scannedBins.filter((b) => b.wrong > 0).length;
  const correctBins = scannedBins.length - wrongBins;
  const scanned = detail.lines.filter((l) => l.checked);
  const wrongLines = scanned.filter((l) => l.wrong).length;
  return {
    bins: scannedBins.length,
    unscannedBins: detail.bins.length - scannedBins.length,
    correctBins,
    wrongBins,
    /** Right bins ÷ scanned bins. */
    accuracy: scannedBins.length > 0 ? (correctBins / scannedBins.length) * 100 : null,
    lines: scanned.length,
    correctLines: scanned.length - wrongLines,
    wrongLines,
    reasons: reasonCounts(scannedBins),
    scanQty: scanned.reduce((s, l) => s + (l.scanQuantity ?? 0), 0),
    binQty: scanned.reduce((s, l) => s + (l.binQuantity ?? 0), 0),
  };
}

/** The SKU as the staff app writes it: `itemNo-variant`. */
export const detailSku = (l: Pick<BinDetailLine, 'itemNo' | 'variantCode'>) => (l.variantCode ? `${l.itemNo}-${l.variantCode}` : l.itemNo);

/** The bins BC says the item belongs in (`A|B` → ['A', 'B']). */
export const actualBins = (l: Pick<BinDetailLine, 'actualBinCodes'>) => l.actualBinCodes.split('|').map((b) => b.trim()).filter(Boolean);

/**
 * Which cells of a WRONG line show the mistake, so the page can mark them: the scanned quantity when it differs from
 * the bin's, and the "belongs in" bins when the item is not in a bin it belongs in (Misplaced).
 */
export function lineHighlights(l: Pick<BinDetailLine, 'wrong' | 'reason' | 'binCode' | 'actualBinCodes' | 'scanQuantity' | 'binQuantity'>) {
  if (!l.wrong) return { scanQuantity: false, actualBinCodes: false };
  const qtyDiffers = l.scanQuantity != null && l.binQuantity != null && l.scanQuantity !== l.binQuantity;
  const bins = actualBins(l).map((b) => b.toUpperCase());
  const elsewhere = l.reason === 'misplaced' || (bins.length > 0 && !bins.includes(l.binCode.trim().toUpperCase()));
  return { scanQuantity: qtyDiffers || l.reason === 'not_scanned' || l.reason === 'not_found', actualBinCodes: elsewhere };
}

// ─── Per-bin view ────────────────────────────────────────────────────────────

export type BinVerdictFilter = 'all' | 'wrong' | 'right';
export type BinSort = 'wrong' | 'bin' | 'bc';

export const BIN_SORT_LABEL: Record<BinSort, string> = { wrong: 'Salah terbanyak', bin: 'Kode bin', bc: 'Urutan BC' };

export interface BinViewFilter {
  verdict: BinVerdictFilter;
  /** Only bins / lines with this mistake. */
  reason: BinCheckReason | null;
  /** SKU, bin, status, "belongs in" bin — a bin whose code matches keeps all its lines. */
  query: string;
  /** Also show bins BC listed that nobody scanned. */
  withUnscanned: boolean;
  sort: BinSort;
}

export interface BinView {
  bin: BinDetailBin;
  /** The bin's wrong lines that pass the filter, in BC order. */
  wrongLines: BinDetailLine[];
  /** The bin's right lines that pass the filter, in BC order. */
  rightLines: BinDetailLine[];
}

/** The bins the page lists, each with its lines split into wrong (highlighted, first) and right. */
export function binViews(detail: Pick<BinDetail, 'lines' | 'bins'>, f: BinViewFilter): BinView[] {
  const q = f.query.trim().toLowerCase();
  const byBin = new Map<string, BinDetailLine[]>();
  for (const l of detail.lines) {
    const list = byBin.get(l.binCode);
    if (list) list.push(l);
    else byBin.set(l.binCode, [l]);
  }

  const out: BinView[] = [];
  for (const bin of detail.bins) {
    if (!f.withUnscanned && !bin.checked) continue;
    if (f.verdict === 'wrong' && bin.wrong === 0) continue;
    if (f.verdict === 'right' && bin.wrong > 0) continue;
    if (f.reason && !bin.reasons[f.reason]) continue;

    let lines = byBin.get(bin.binCode) ?? [];
    if (f.reason) lines = lines.filter((l) => l.reason === f.reason);
    if (q && !bin.binCode.toLowerCase().includes(q)) {
      lines = lines.filter((l) => [detailSku(l), l.actualBinCodes, l.status, l.reason ? BIN_CHECK_REASON_META[l.reason].label : ''].some((v) => v.toLowerCase().includes(q)));
      if (lines.length === 0) continue;
    }
    out.push({ bin, wrongLines: lines.filter((l) => l.wrong), rightLines: lines.filter((l) => !l.wrong) });
  }

  const code = (a: BinView, b: BinView) => a.bin.binCode.localeCompare(b.bin.binCode, 'en', { numeric: true });
  const cmp: Record<BinSort, (a: BinView, b: BinView) => number> = {
    // Wrong bins first (most wrong items first), unscanned bins last.
    wrong: (a, b) => Number(b.bin.checked) - Number(a.bin.checked) || b.bin.wrong - a.bin.wrong || code(a, b),
    bin: code,
    bc: (a, b) => a.bin.order - b.bin.order,
  };
  return out.sort(cmp[f.sort]);
}

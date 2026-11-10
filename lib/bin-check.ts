// lib/bin-check.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cek Bin · hasil scan dari Business Central — pure, client-safe rules.
//
// BC (PP Bin Content Check) judges what the employee scanned against what BC
// says is in each bin. Two OData feeds describe the same check:
//   • ppBinContentCheckHeaders ($expand lines)  – per bin, per item: the scanned
//     quantity, the quantity in the bin and a status;
//   • ppBinContentChecks (summary)              – per bin, pipe-separated
//     `itemNo-variant` lists for every wrong status.
// The staff app only ever shows what is WRONG, in plain Indonesian. Everything
// here is deterministic and free of I/O so it can be tested without BC
// (npm run test:bin-check); the fetching lives in lib/bc/bin-content-check.ts.
// ─────────────────────────────────────────────────────────────────────────────

// ─── What the API hands the staff app ────────────────────────────────────────

/**
 * Why a line is wrong. BC's "Not Scanned" (in the bin's list, never scanned) and
 * "Not Found" are ONE reason for the employee — `not_found` — "the item wasn't found".
 */
export type BinCheckReason =
  | 'qty_lower'
  | 'qty_higher'
  | 'misplaced'
  | 'not_found'
  | 'unknown';

/** `ok` = BC answered; the other two mean "no data right now" (never an error page). */
export type BinCheckState = 'ok' | 'not_configured' | 'unavailable';

export interface BinCheckIssue {
  /** Stable key (bin + item + reason) for React lists and de-duplication. */
  key: string;
  /** The bin that was being checked/scanned. */
  binCode: string;
  /** Where the item belongs (BC `actualBinCodes`); falls back to `binCode`. */
  correctBins: string[];
  itemNo: string;
  variantCode: string;
  /** What the employee scanned; null when only the summary feed was available. */
  scanQuantity: number | null;
  /** What BC says is in the bin; null when only the summary feed was available. */
  binQuantity: number | null;
  reason: BinCheckReason;
  /** The decoded BC status, kept only for `unknown` reasons so the UI can show it. */
  statusText: string | null;
}

export interface BinCheckResult {
  state: BinCheckState;
  /** Jakarta day (YYYY-MM-DD) and BC location the result belongs to. */
  day: string;
  location: string;
  /** Wrong results only — correct ones are counted, never listed. */
  issues: BinCheckIssue[];
  /** Distinct bins BC has a check for on that day. 0 = nothing scanned yet. */
  checkedBins: number;
  /** Item lines that were right (a count for the all-clear message only). */
  okItems: number;
  /** False when the headers feed failed and quantities could not be shown. */
  quantitiesAvailable: boolean;
  fetchedAt: string | null;
}

// ─── Words ───────────────────────────────────────────────────────────────────

/** One table section per reason, in this `order`; `label` is the section title, `hint` the line under it. */
export const BIN_CHECK_REASON_META: Record<
  BinCheckReason,
  { label: string; hint: string; order: number }
> = {
  qty_lower: {
    label: 'Qty kurang',
    hint: 'Jumlah yang di-scan lebih sedikit dari qty di bin.',
    order: 0,
  },
  qty_higher: {
    label: 'Qty lebih',
    hint: 'Jumlah yang di-scan lebih banyak dari qty di bin.',
    order: 1,
  },
  misplaced: {
    label: 'Salah bin',
    hint: 'Barang ada di bin yang salah. Pindahkan ke bin yang benar.',
    order: 2,
  },
  not_found: {
    label: 'Item tidak ditemukan',
    hint: 'Barang tidak ketemu saat scan. Cari lagi di bin-nya atau tanya tim OPS.',
    order: 3,
  },
  unknown: {
    label: 'Perlu dicek',
    hint: 'Hasil scan belum sesuai. Cek lagi barang dan bin-nya.',
    order: 4,
  },
};

// ─── BC row shapes (all fields optional on the wire) ─────────────────────────

export interface BcBinCheckLine {
  date?: string;
  location?: string;
  binCode?: string;
  itemNo?: string;
  variantCode?: string;
  unitOfMeasureCode?: string;
  actualBinCodes?: string;
  scanQuantity?: number | string | null;
  binQuantity?: number | string | null;
  binContentCheckStatus?: string;
}

export interface BcBinCheckHeader {
  date?: string;
  location?: string;
  binCode: string;
  checked?: boolean;
  ppBinContentCheckLines?: unknown;
}

export interface BcBinCheckSummary {
  date?: string;
  location?: string;
  binCode: string;
  skuQtyLowerThanBin?: string | null;
  skuQtyHigherThanBin?: string | null;
  skuMisplaced?: string | null;
  skuNotScanned?: string | null;
  skuNotFound?: string | null;
}

export function isBcBinCheckHeader(row: unknown): row is BcBinCheckHeader {
  return isRecord(row) && typeof row.binCode === 'string' && row.binCode.trim() !== '';
}

export function isBcBinCheckSummary(row: unknown): row is BcBinCheckSummary {
  return isRecord(row) && typeof row.binCode === 'string' && row.binCode.trim() !== '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ─── Status words ────────────────────────────────────────────────────────────

/** OData escapes odd characters as `_xHHHH_` (`_x0020_` = space). */
export function decodeODataText(value: string): string {
  return value.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Plain, comparable form of a BC status: decoded, lower-case, letters and digits only. */
function compactStatus(raw: string): string {
  return decodeODataText(raw).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** BC status texts that mean "this item was right" — never listed. */
const OK_STATUSES = new Set(['', 'ok', 'correct', 'match', 'matched', 'sesuai', 'equal', 'none', 'valid']);

function reasonFromWords(compact: string): BinCheckReason | null {
  // "Not Scanned" = BC expected it in the bin and it never turned up → the same "not found".
  if (compact.includes('notscanned') || compact.includes('unscanned')) return 'not_found';
  if (compact.includes('notfound') || compact.includes('missing')) return 'not_found';
  if (compact.includes('misplace')) return 'misplaced';
  if (compact.includes('lower')) return 'qty_lower';
  if (compact.includes('higher')) return 'qty_higher';
  return null;
}

export type StatusVerdict =
  | { wrong: false }
  | { wrong: true; reason: BinCheckReason; statusText: string | null };

/**
 * Is this item line wrong, and why? The five statuses BC is known to send map
 * to a reason; any other status is judged by the quantities — equal = right,
 * anything else = "Perlu dicek" (it's safer to ask the employee to look than to
 * hide a problem).
 */
export function judgeStatus(
  rawStatus: string | null | undefined,
  scanQuantity: number | null,
  binQuantity: number | null,
): StatusVerdict {
  const compact = compactStatus(rawStatus ?? '');
  if (OK_STATUSES.has(compact)) return { wrong: false };

  const reason = reasonFromWords(compact);
  if (reason) return { wrong: true, reason, statusText: null };

  if (scanQuantity != null && binQuantity != null && scanQuantity === binQuantity) return { wrong: false };
  return { wrong: true, reason: 'unknown', statusText: decodeODataText(rawStatus ?? '').trim() || null };
}

// ─── Item tokens ("itemNo-variant") ──────────────────────────────────────────

export function skuToken(itemNo: string, variantCode: string): string {
  return variantCode ? `${itemNo}-${variantCode}` : itemNo;
}

/** "ASC1203A611.200-095" → item + variant. Splits on the LAST hyphen; none = no variant. */
export function splitSkuToken(token: string): { itemNo: string; variantCode: string } {
  const t = token.trim();
  const i = t.lastIndexOf('-');
  if (i <= 0) return { itemNo: t, variantCode: '' };
  return { itemNo: t.slice(0, i), variantCode: t.slice(i + 1) };
}

/** A pipe-separated summary list ("A-M|B-S", "" = none) → tokens. */
export function splitSkuList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split('|').map((s) => s.trim().replace(/-$/, '')).filter(Boolean);
}

function splitBins(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(/[|,;]/).map((s) => s.trim()).filter(Boolean);
}

function toQty(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const SUMMARY_FIELDS: ReadonlyArray<readonly [keyof BcBinCheckSummary, BinCheckReason]> = [
  ['skuQtyLowerThanBin', 'qty_lower'],
  ['skuQtyHigherThanBin', 'qty_higher'],
  ['skuMisplaced', 'misplaced'],
  ['skuNotScanned', 'not_found'],
  ['skuNotFound', 'not_found'],
];

// ─── Build the wrong-results list ────────────────────────────────────────────

const keyOf = (bin: string, token: string, reason: BinCheckReason) =>
  `${bin.toUpperCase()}|${token.toUpperCase()}|${reason}`;

/**
 * Turns the two BC feeds into the list the employee sees.
 *
 * `headers` / `summaries` are the raw rows of each feed, or `null` when that
 * feed could not be fetched. Rows that don't belong to `location` / `day` are
 * ignored (the `$filter` should already guarantee it; this keeps a wrong answer
 * from ever reaching another store). Headers carry the quantities, so they win;
 * the summary only adds items the headers did not list, or — if the headers feed
 * failed — stands in for them without quantities.
 */
export function buildBinCheckIssues(input: {
  headers: unknown[] | null;
  summaries: unknown[] | null;
  location: string;
  day: string;
}): { issues: BinCheckIssue[]; checkedBins: number; okItems: number; quantitiesAvailable: boolean } {
  const wantLocation = input.location.trim().toUpperCase();
  const belongs = (row: { location?: string; date?: string }) =>
    (!row.location || row.location.trim().toUpperCase() === wantLocation) &&
    (!row.date || row.date.slice(0, 10) === input.day);

  const issues = new Map<string, BinCheckIssue>();
  const checkedBins = new Set<string>();
  let okItems = 0;

  if (input.headers) {
    for (const raw of input.headers) {
      if (!isBcBinCheckHeader(raw) || !belongs(raw)) continue;
      // `checked: false` = the bin is on BC's list but nobody scanned it — not a result.
      if (raw.checked === false) continue;
      const headerBin = raw.binCode.trim();
      checkedBins.add(headerBin.toUpperCase());

      const lines = Array.isArray(raw.ppBinContentCheckLines) ? raw.ppBinContentCheckLines : [];
      for (const rawLine of lines) {
        if (!isRecord(rawLine)) continue;
        const line = rawLine as BcBinCheckLine;
        if (typeof line.itemNo !== 'string' || !line.itemNo.trim()) continue;

        const scan = toQty(line.scanQuantity);
        const inBin = toQty(line.binQuantity);
        const verdict = judgeStatus(line.binContentCheckStatus, scan, inBin);
        if (!verdict.wrong) {
          okItems += 1;
          continue;
        }

        const binCode = (typeof line.binCode === 'string' && line.binCode.trim()) || headerBin;
        const itemNo = line.itemNo.trim();
        const variantCode = (line.variantCode ?? '').trim();
        const key = keyOf(binCode, skuToken(itemNo, variantCode), verdict.reason);
        if (issues.has(key)) continue;

        const correctBins = splitBins(line.actualBinCodes);
        issues.set(key, {
          key,
          binCode,
          correctBins: correctBins.length ? correctBins : [binCode],
          itemNo,
          variantCode,
          scanQuantity: scan,
          binQuantity: inBin,
          reason: verdict.reason,
          statusText: verdict.statusText,
        });
      }
    }
  }

  if (input.summaries) {
    for (const raw of input.summaries) {
      if (!isBcBinCheckSummary(raw) || !belongs(raw)) continue;
      const bin = raw.binCode.trim();
      // With the headers in hand, only bins they list as checked count; without
      // them the summary is all there is.
      if (input.headers && !checkedBins.has(bin.toUpperCase())) continue;
      if (!input.headers) checkedBins.add(bin.toUpperCase());

      for (const [field, reason] of SUMMARY_FIELDS) {
        for (const token of splitSkuList(raw[field] as string | null | undefined)) {
          const key = keyOf(bin, token, reason);
          if (issues.has(key)) continue;
          const { itemNo, variantCode } = splitSkuToken(token);
          issues.set(key, {
            key,
            binCode: bin,
            correctBins: [bin],
            itemNo,
            variantCode,
            scanQuantity: null,
            binQuantity: null,
            reason,
            statusText: null,
          });
        }
      }
    }
  }

  const sorted = [...issues.values()].sort(
    (a, b) =>
      compareNatural(a.correctBins[0] ?? a.binCode, b.correctBins[0] ?? b.binCode) ||
      compareNatural(a.binCode, b.binCode) ||
      BIN_CHECK_REASON_META[a.reason].order - BIN_CHECK_REASON_META[b.reason].order ||
      compareNatural(a.itemNo, b.itemNo) ||
      compareNatural(a.variantCode, b.variantCode),
  );

  return {
    issues: sorted,
    checkedBins: checkedBins.size,
    okItems,
    quantitiesAvailable: input.headers !== null,
  };
}

function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * The wrong items split into one group per reason (only reasons that have items), in
 * the order the sections are shown; inside a group the items keep their list order.
 */
export function groupIssuesByReason(
  issues: readonly BinCheckIssue[],
): Array<{ reason: BinCheckReason; issues: BinCheckIssue[] }> {
  const groups = new Map<BinCheckReason, BinCheckIssue[]>();
  for (const i of issues) {
    const list = groups.get(i.reason);
    if (list) list.push(i);
    else groups.set(i.reason, [i]);
  }
  return [...groups.entries()]
    .map(([reason, list]) => ({ reason, issues: list }))
    .sort((a, b) => BIN_CHECK_REASON_META[a.reason].order - BIN_CHECK_REASON_META[b.reason].order);
}

/** The "SKU" cell: item number with its variant behind it ("SPE2010107-M"). */
export function issueSku(issue: Pick<BinCheckIssue, 'itemNo' | 'variantCode'>): string {
  return skuToken(issue.itemNo, issue.variantCode);
}

// lib/petty-cash-report.ts
// Shapes + grouping for Finance's Petty Cash Report (client-safe, no DB
// imports) — shared by the report page, its API and the Excel export.

/** One store's line in the report: what it used, and where to send the refill. */
export interface PettyCashReportRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  /** Letters of the store code — FF001 → "FF", OD002 → "OD". */
  code: string;

  /** Completed petty cash spend in the month, integer Rupiah. */
  totalUsed: number;
  txCount: number;

  pic1Name: string | null;
  /** Null until PIC 1 has filed a refill request with bank details. */
  bankName: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
}

/** FF001 → "FF", OD002 → "OD", DUMMY-001 → "DUMMY". */
export function storeCodeOf(storeNo: string): string {
  return storeNo.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? storeNo.toUpperCase();
}

// Brand behind each store code. Codes not listed here still work — they just
// group under their own letters with no brand label.
const STORE_CODE_BRANDS: Record<string, string> = {
  FF: 'Fisik Football',
  FS: 'Fisik Sport',
  FO: 'Factory Outlet',
  OD: 'ODD',
  SS: 'Specs Store',
};

// Codes people call by a longer name than the letters in the store number
// (OD002 is an "ODD" store).
const STORE_CODE_DISPLAY: Record<string, string> = { OD: 'ODD' };

// How the groups are ordered; anything else follows alphabetically.
const STORE_CODE_ORDER = ['FF', 'FS', 'FO', 'OD', 'SS'];

export function storeCodeDisplay(code: string): string {
  return STORE_CODE_DISPLAY[code] ?? code;
}

export function storeCodeBrand(code: string): string | null {
  return STORE_CODE_BRANDS[code] ?? null;
}

export interface StoreCodeGroup {
  code: string;
  /** What to show for the code (OD → "ODD"). */
  display: string;
  brand: string | null;
  rows: PettyCashReportRow[];
  storeCount: number;
  totalUsed: number;
  /** Stores whose PIC 1 has filed bank details. */
  withBankCount: number;
}

export function hasBankDetails(row: PettyCashReportRow): boolean {
  return Boolean(row.bankName && row.accountNumber && row.accountHolderName);
}

function codeRank(code: string): number {
  const i = STORE_CODE_ORDER.indexOf(code);
  return i === -1 ? STORE_CODE_ORDER.length : i;
}

/** Sort order for store codes: FF, FS, FO, OD, SS, then the rest alphabetically. */
export function compareStoreCodes(a: string, b: string): number {
  return codeRank(a) - codeRank(b) || a.localeCompare(b);
}

export function groupByStoreCode(rows: PettyCashReportRow[]): StoreCodeGroup[] {
  const byCode = new Map<string, PettyCashReportRow[]>();
  for (const row of rows) {
    const list = byCode.get(row.code);
    if (list) list.push(row);
    else byCode.set(row.code, [row]);
  }

  return [...byCode.entries()]
    .sort(([a], [b]) => compareStoreCodes(a, b))
    .map(([code, list]) => {
      const sorted = [...list].sort((a, b) =>
        a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }),
      );
      return {
        code,
        display: storeCodeDisplay(code),
        brand: storeCodeBrand(code),
        rows: sorted,
        storeCount: sorted.length,
        totalUsed: sorted.reduce((sum, r) => sum + r.totalUsed, 0),
        withBankCount: sorted.filter(hasBankDetails).length,
      };
    });
}

/** "2026-09" → "September 2026". */
export function reportMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

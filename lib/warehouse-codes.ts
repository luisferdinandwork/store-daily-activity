// lib/warehouse-codes.ts
// Client-safe shapes + rules for the IT "Warehouse Codes" page (/it/warehouse-codes).
// A BC location code is a warehouse when it starts with "DM" (automatic) or IT listed it.

export const WAREHOUSE_CODE_MAX = 30;
export const WAREHOUSE_NAME_MAX = 80;

export interface WarehouseCodeRow {
  /** Null for the automatic "DM…" codes that were seen but not listed. */
  id: number | null;
  code: string;
  name: string | null;
  /** 'dm' = follows the "DM" rule; 'listed' = added by IT. */
  source: 'dm' | 'listed';
  /** Transfer orders that touch this code (either end). */
  orderCount: number;
}

export interface UnknownCodeRow {
  code: string;
  orderCount: number;
}

/** Upper-case, trimmed, inner whitespace removed. */
export function normalizeWarehouseCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function validateWarehouseCode(code: string): string | null {
  if (!code) return 'Kode gudang wajib diisi.';
  if (code.length > WAREHOUSE_CODE_MAX) return `Kode maksimal ${WAREHOUSE_CODE_MAX} karakter.`;
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) return 'Kode hanya boleh huruf, angka, titik, minus atau garis bawah.';
  return null;
}

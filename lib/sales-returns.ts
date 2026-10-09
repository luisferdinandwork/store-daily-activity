// lib/sales-returns.ts
//
// Sales Return — shapes + rules shared by the staff app, the Ops / Finance
// lists and their APIs (client-safe, no DB imports). DB side:
// lib/db/utils/sales-returns.ts.

import { isIsoDay, shiftDate, todayJakarta } from '@/lib/finance/dates';

// ─── Upload limits ───────────────────────────────────────────────────────────

export const SALES_RETURN_MAX_PHOTOS = 3;
/** Per photo, after the phone has already shrunk it (lib/image-compress.ts). */
export const SALES_RETURN_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** One request carries every photo; proxy.ts buffers at most 10 MB of a body. */
export const SALES_RETURN_MAX_TOTAL_BYTES = 9 * 1024 * 1024;
/** What the staff app lists under the form. */
export const EMPLOYEE_SALES_RETURNS_LIMIT = 50;

// ─── Receipt number ──────────────────────────────────────────────────────────

export const RECEIPT_NUMBER_MIN = 3;
export const RECEIPT_NUMBER_MAX = 40;

/** What is stored and searched on: no spaces, upper-case ("000000p001000091825 " → "000000P001000091825"). */
export function normalizeReceiptNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** The POS slip number as typed → the value to store, or an Indonesian message for the employee. */
export function validateReceiptNumber(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeReceiptNumber(raw);
  if (!value) return { ok: false, error: 'Nomor struk wajib diisi.' };
  if (value.length < RECEIPT_NUMBER_MIN) {
    return { ok: false, error: `Nomor struk minimal ${RECEIPT_NUMBER_MIN} karakter.` };
  }
  if (value.length > RECEIPT_NUMBER_MAX) {
    return { ok: false, error: `Nomor struk maksimal ${RECEIPT_NUMBER_MAX} karakter.` };
  }
  if (!/^[A-Z0-9][A-Z0-9._/#-]*$/.test(value)) {
    return { ok: false, error: 'Nomor struk hanya boleh huruf, angka, dan tanda - . / _ #' };
  }
  return { ok: true, value };
}

/** image_urls is a JSON array in a text column; tolerate a bare URL or junk. */
export function parseImageUrls(raw: string | null | undefined): string[] {
  const text = raw?.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [text];
}

// ─── Staff app ───────────────────────────────────────────────────────────────

export interface EmployeeSalesReturn {
  id: number;
  receiptNumber: string;
  imageUrls: string[];
  uploadedByName: string;
  /** Filed by the signed-in employee. */
  mine: boolean;
  /** ISO instant of the upload. */
  createdAt: string;
}

// ─── Ops / Finance list ──────────────────────────────────────────────────────

export interface SalesReturnRow {
  id: number;
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  receiptNumber: string;
  imageUrls: string[];
  uploadedBy: string;
  /** ISO instant of the upload. */
  createdAt: string;
}

export interface SalesReturnStoreOption {
  id: number;
  storeNo: string;
  name: string;
}

export interface SalesReturnAreaOption {
  id: number;
  name: string;
}

/** Numbers for the chosen filters (search, store, area, period). */
export interface SalesReturnSummary {
  count: number;
  stores: number;
  employees: number;
  /** Filed today (Jakarta) — within the same filters, so 0 when the period ends earlier. */
  today: number;
  /** The store with the most returns in the filters; null when there are none. */
  topStore: { storeNo: string; count: number } | null;
}

export interface SalesReturnsPage {
  from: string;
  to: string;
  rows: SalesReturnRow[];
  summary: SalesReturnSummary;
  stores: SalesReturnStoreOption[];
  /** Only the areas an Ops HO / IT user may pick from; one entry for an Area Ops. */
  areas: SalesReturnAreaOption[];
  matching: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** What both lists accept (query string → validated values). */
export interface SalesReturnQuery {
  from: string;
  to: string;
  storeId: number | null;
  areaId: number | null;
  /** Receipt number, uploader, store name or code. */
  q: string;
  page: number;
}

export const SALES_RETURN_SEARCH_MAX = 60;

/** ?from&to[&storeId][&areaId][&q][&page] — from/to default to this month so far. */
export function parseSalesReturnQuery(
  params: URLSearchParams,
): ({ ok: true } & SalesReturnQuery) | { ok: false; error: string } {
  const today = todayJakarta();
  const from = params.get('from') ?? `${today.slice(0, 8)}01`;
  const to = params.get('to') ?? today;

  if (!isIsoDay(from) || !isIsoDay(to)) return { ok: false, error: 'Invalid date. Use YYYY-MM-DD.' };
  if (from > to) return { ok: false, error: '"from" must not be after "to".' };

  const id = (name: string): number | null | undefined => {
    const raw = params.get(name);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const storeId = id('storeId');
  const areaId = id('areaId');
  if (storeId === undefined) return { ok: false, error: 'Invalid storeId.' };
  if (areaId === undefined) return { ok: false, error: 'Invalid areaId.' };

  return {
    ok: true,
    from,
    to,
    storeId,
    areaId,
    q: (params.get('q') ?? '').trim().slice(0, SALES_RETURN_SEARCH_MAX),
    page: Math.max(1, Math.floor(Number(params.get('page'))) || 1),
  };
}

/** First and last day of a YYYY-MM month — the from/to Ops' month picker sends. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: shiftDate(nextMonth, -1) };
}

// ─── Display ─────────────────────────────────────────────────────────────────

/** "09 Okt 2026, 14.30" in Jakarta time. */
export function fmtSalesReturnWhen(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

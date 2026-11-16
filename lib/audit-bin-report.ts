// lib/audit-bin-report.ts
// ─────────────────────────────────────────────────────────────────────────────
// Audit "Hasil Cek Bin" — pure, client-safe rules (no I/O). The page /audit/cek-bin shows, for a period, every
// store's daily Cek Bin as Business Central judged it: how many item lines were RIGHT and how many WRONG, and the
// daily averages. No item detail on purpose (the store's own Cek Bin page lists the items).
//
// Source: BC `ppBinContentCheckHeaders` with their lines (lib/bc/bin-check-audit.ts) for the whole period in ONE
// query. A line is right or wrong by the same rule the staff app uses (`judgeStatus` in lib/bin-check.ts:
// "Matched" / blank = right; Qty lebih / kurang, Salah bin, Not Scanned / Not Found = wrong). Headers with
// `checked: false` (a bin on BC's list nobody scanned) are not results.
//
//   accuracy (akurasi)     = right ÷ (right + wrong)
//   daily average          = Σ over the store-days that HAVE a Cek Bin ÷ the number of those store-days
// ─────────────────────────────────────────────────────────────────────────────

import { addDaysKey, isDayKey } from '@/lib/day-bucket';
import { isBcBinCheckHeader, judgeStatus, type BcBinCheckLine } from '@/lib/bin-check';

/** Longest period the page asks BC for in one go. */
export const BIN_REPORT_MAX_DAYS = 31;

/** One store's Cek Bin on one Jakarta day, as BC judged it. */
export interface BinDayStat {
  /** BC location = stores.storeNo, upper-case. */
  location: string;
  /** YYYY-MM-DD */
  date: string;
  /** Bins scanned (headers with checked ≠ false). */
  bins: number;
  /** Item lines BC judged right. */
  correct: number;
  /** Item lines BC judged wrong. */
  wrong: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const toQty = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Raw BC headers (+ expanded lines) → one stat per location + day, inside [from, to]. Rows outside the range or
 * without a location are dropped (the `$filter` should already guarantee it).
 */
export function summarizeBinCheckHeaders(headers: unknown[], from: string, to: string): BinDayStat[] {
  const map = new Map<string, BinDayStat & { binSet: Set<string> }>();
  for (const raw of headers) {
    if (!isBcBinCheckHeader(raw)) continue;
    if (raw.checked === false) continue;
    const location = (raw.location ?? '').trim().toUpperCase();
    const date = (raw.date ?? '').slice(0, 10);
    if (!location || !isDayKey(date) || date < from || date > to) continue;

    const key = `${location}|${date}`;
    let stat = map.get(key);
    if (!stat) {
      stat = { location, date, bins: 0, correct: 0, wrong: 0, binSet: new Set() };
      map.set(key, stat);
    }
    stat.binSet.add(raw.binCode.trim().toUpperCase());

    const lines = Array.isArray(raw.ppBinContentCheckLines) ? raw.ppBinContentCheckLines : [];
    for (const rawLine of lines) {
      if (!isRecord(rawLine)) continue;
      const line = rawLine as BcBinCheckLine;
      const verdict = judgeStatus(line.binContentCheckStatus, toQty(line.scanQuantity), toQty(line.binQuantity));
      if (verdict.wrong) stat.wrong += 1;
      else stat.correct += 1;
    }
  }
  return [...map.values()]
    .map(({ binSet, ...s }) => ({ ...s, bins: binSet.size }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.location.localeCompare(b.location, 'en', { numeric: true }));
}

// ─── Totals ──────────────────────────────────────────────────────────────────

export interface BinTotals {
  /** Store-days that have a Cek Bin result. */
  storeDays: number;
  /** Distinct days with at least one result. */
  days: number;
  /** Distinct stores with at least one result. */
  stores: number;
  bins: number;
  correct: number;
  wrong: number;
  /** Per store-day with a result; null when there is none. */
  avgCorrect: number | null;
  avgWrong: number | null;
  avgBins: number | null;
  /** 0–100, null when nothing was judged. */
  accuracy: number | null;
}

export function accuracyOf(correct: number, wrong: number): number | null {
  const all = correct + wrong;
  return all > 0 ? (correct / all) * 100 : null;
}

export function binTotals(rows: readonly Pick<BinDayStat, 'location' | 'date' | 'bins' | 'correct' | 'wrong'>[]): BinTotals {
  const storeDays = rows.length;
  const correct = rows.reduce((s, r) => s + r.correct, 0);
  const wrong = rows.reduce((s, r) => s + r.wrong, 0);
  const bins = rows.reduce((s, r) => s + r.bins, 0);
  return {
    storeDays,
    days: new Set(rows.map((r) => r.date)).size,
    stores: new Set(rows.map((r) => r.location)).size,
    bins,
    correct,
    wrong,
    avgCorrect: storeDays ? correct / storeDays : null,
    avgWrong: storeDays ? wrong / storeDays : null,
    avgBins: storeDays ? bins / storeDays : null,
    accuracy: accuracyOf(correct, wrong),
  };
}

// ─── Period ──────────────────────────────────────────────────────────────────

/** Every day of [from, to], oldest first (empty when the range is invalid or too long). */
export function periodDays(from: string, to: string, max = BIN_REPORT_MAX_DAYS): string[] {
  if (!isDayKey(from) || !isDayKey(to) || from > to) return [];
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= max; d = addDaysKey(d, 1)) out.push(d);
  return out.length > max ? [] : out;
}

/** Why a period can't be asked for, or null when it is fine. */
export function periodProblem(from: string, to: string, today: string): string | null {
  if (!isDayKey(from) || !isDayKey(to)) return 'Periode tidak valid.';
  if (from > to) return 'Tanggal awal harus sebelum tanggal akhir.';
  if (to > today) return 'Periode tidak boleh melewati hari ini.';
  if (periodDays(from, to).length === 0) return `Periode maksimal ${BIN_REPORT_MAX_DAYS} hari.`;
  return null;
}

// ─── Views ───────────────────────────────────────────────────────────────────

/** A stat joined with its PRISM store (the API does the join). */
export interface BinReportRow extends BinDayStat {
  storeId: number;
  storeName: string;
  areaId: number | null;
  areaName: string | null;
}

export interface BinReportStore {
  id: number;
  storeNo: string;
  name: string;
  areaId: number | null;
  areaName: string | null;
}

export interface BinDayGroup {
  date: string;
  rows: BinReportRow[];
  totals: BinTotals;
}

/** One group per day of the period (newest first) — days without any result are kept, so gaps show. */
export function groupByDay(rows: readonly BinReportRow[], days: readonly string[]): BinDayGroup[] {
  const byDay = new Map<string, BinReportRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.date);
    if (list) list.push(r);
    else byDay.set(r.date, [r]);
  }
  return [...days]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const list = (byDay.get(date) ?? []).sort((a, b) => a.location.localeCompare(b.location, 'en', { numeric: true }));
      return { date, rows: list, totals: binTotals(list) };
    });
}

export interface BinStoreGroup {
  store: BinReportStore;
  rows: BinReportRow[];
  totals: BinTotals;
}

/** One group per store in `stores` (stores without a result are kept — they did no Cek Bin in the period). */
export function groupByStore(rows: readonly BinReportRow[], stores: readonly BinReportStore[]): BinStoreGroup[] {
  const byStore = new Map<number, BinReportRow[]>();
  for (const r of rows) {
    const list = byStore.get(r.storeId);
    if (list) list.push(r);
    else byStore.set(r.storeId, [r]);
  }
  return stores.map((store) => {
    const list = (byStore.get(store.id) ?? []).sort((a, b) => b.date.localeCompare(a.date));
    return { store, rows: list, totals: binTotals(list) };
  });
}

export type BinStoreSort = 'accuracy_asc' | 'accuracy_desc' | 'days_desc' | 'wrong_desc' | 'store';

export const BIN_STORE_SORT_LABEL: Record<BinStoreSort, string> = {
  accuracy_asc: 'Akurasi terendah',
  accuracy_desc: 'Akurasi tertinggi',
  wrong_desc: 'Salah terbanyak / hari',
  days_desc: 'Hari cek bin terbanyak',
  store: 'Kode toko',
};

/** Stores with no result always go last, in store-code order. */
export function sortStoreGroups(groups: readonly BinStoreGroup[], sort: BinStoreSort): BinStoreGroup[] {
  const byCode = (a: BinStoreGroup, b: BinStoreGroup) => a.store.storeNo.localeCompare(b.store.storeNo, 'en', { numeric: true });
  const withData = groups.filter((g) => g.totals.storeDays > 0);
  const without = groups.filter((g) => g.totals.storeDays === 0).sort(byCode);
  const acc = (g: BinStoreGroup) => g.totals.accuracy ?? 0;
  const cmp: Record<BinStoreSort, (a: BinStoreGroup, b: BinStoreGroup) => number> = {
    accuracy_asc: (a, b) => acc(a) - acc(b) || byCode(a, b),
    accuracy_desc: (a, b) => acc(b) - acc(a) || byCode(a, b),
    wrong_desc: (a, b) => (b.totals.avgWrong ?? 0) - (a.totals.avgWrong ?? 0) || byCode(a, b),
    days_desc: (a, b) => b.totals.storeDays - a.totals.storeDays || byCode(a, b),
    store: byCode,
  };
  return [...withData.sort(cmp[sort]), ...without];
}

// ─── Formats ─────────────────────────────────────────────────────────────────

/** "12,5" / "12" — averages keep one decimal only when they need it. */
export function formatAvg(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

/** "92%" / "92,4%" */
export function formatAccuracy(n: number | null): string {
  if (n == null) return '—';
  return `${n.toLocaleString('id-ID', { maximumFractionDigits: n >= 99.95 || n < 0.05 ? 0 : 1 })}%`;
}

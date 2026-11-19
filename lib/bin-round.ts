// lib/bin-round.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cek Bin · monthly bin round — pure, client-safe rules (no I/O).
//
// Every month a store has to check EVERY bin it has in Business Central once. The bin list comes from BC
// (`ppBinContentsAPI`, cached per store in `store_bin_codes`); each month starts over with all of them "pending".
// Every day the staff app hands the store DAILY_BIN_COUNT (20) bins to scan in BC:
//   • only bins NOT checked yet this month — a checked bin never comes back in the same month;
//   • picked at random (seeded by store + day, so the same day always gives the same list), bins that never came
//     up yet first, then the ones that came up before but were not scanned (least offered first);
//   • then put in bin-code order ("GDM1A1, GDM1A2, … GDM2B4") so the store can walk them in one go.
// A bin counts as checked as soon as BC has a scan of it this month (assigned or not). Its result is the FIRST
// day it was checked (a bin is wrong when one of its item lines is wrong — the same rule as Hasil Cek Bin);
// a later scan is kept as "last result", so a bin found wrong and scanned right later counts as fixed
// ("diperbaiki") — it still counts as wrong in the accuracy.
//
// DB side: lib/db/utils/bin-round.ts. BC side: lib/bc/bin-round.ts. Tests: npm run test:bin-round.
// ─────────────────────────────────────────────────────────────────────────────

import { addDaysKey, daysInMonthKey, isDayKey } from '@/lib/day-bucket';
import { decodeODataText, isBcBinCheckHeader, judgeStatus, type BcBinCheckLine, type BinCheckReason } from '@/lib/bin-check';

/** Bins handed to a store per day. */
export const DAILY_BIN_COUNT = 20;

/**
 * BC bins that are never part of the round — EXACT codes only (upper-case): just the catch-all DISPLAY bin.
 * Every other bin BC lists for the store is checked: the floor fixtures DISPLAY-1 … DISPLAY-5 / DISPLAY-A1 …
 * DISPLAY-H4, BOOKING, RECEIVING, SHIPPING, DEFECT / BAD / DAMAGE (2026-11-19, by request: "only the bin coded
 * DISPLAY, character by character, is not checked"). A month filled under another rule is brought in line the next
 * time it is read (applyBinRules in lib/db/utils/bin-round.ts).
 */
export const EXCLUDED_BIN_CODES: readonly string[] = ['DISPLAY'];

/** The rule in words, for the pages. */
export const EXCLUDED_BINS_TEXT = `bin berkode persis ${EXCLUDED_BIN_CODES.join(', ')} (DISPLAY-A1, RECEIVING, dst. tetap dicek)`;

/** Wrong item lines kept per bin (snapshot of the first check). */
export const MAX_WRONG_LINES = 60;

export function normalizeBinCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export function isExcludedBin(code: string): boolean {
  return EXCLUDED_BIN_CODES.includes(normalizeBinCode(code));
}

/** "GDM1A2" before "GDM1A10"; the walking order of a list. */
export function compareBinCodes(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

// ─── Month ───────────────────────────────────────────────────────────────────

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: string | null | undefined): value is string {
  return !!value && YEAR_MONTH.test(value);
}

export function yearMonthOfDay(day: string): string {
  return day.slice(0, 7);
}

export function shiftYearMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function lastDayOfMonth(ym: string): string {
  return `${ym}-${String(daysInMonthKey(ym)).padStart(2, '0')}`;
}

/** The days of `ym` up to `today` that can have results; null for a month that has not started. */
export function monthBounds(ym: string, today: string): { from: string; to: string } | null {
  if (!isYearMonth(ym) || !isDayKey(today)) return null;
  const from = `${ym}-01`;
  if (from > today) return null;
  const last = lastDayOfMonth(ym);
  return { from, to: last < today ? last : today };
}

/** A month is closed for good (stats frozen) from the 2nd day after it ended — late BC postings get one day. */
export function isMonthFinal(ym: string, today: string): boolean {
  return addDaysKey(lastDayOfMonth(ym), 2) <= today;
}

const MONTH_LABEL = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "November 2026" */
export function monthLabel(ym: string): string {
  if (!isYearMonth(ym)) return ym;
  return MONTH_LABEL.format(new Date(`${ym}-01T00:00:00Z`));
}

const DAY_LABEL = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "19 Nov" */
export function shortDay(day: string | null | undefined): string {
  if (!day || !isDayKey(day)) return '—';
  return DAY_LABEL.format(new Date(`${day}T00:00:00Z`));
}

// ─── Picking the day's bins ──────────────────────────────────────────────────

export interface PoolBin {
  binCode: string;
  /** How many earlier daily lists of this month already had it. */
  timesAssigned: number;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function roundSeed(storeId: number, day: string): string {
  return `bin-round|${storeId}|${day}`;
}

/**
 * The day's list from the pool of bins still pending this month: `count` codes, in walking (bin-code) order.
 * Deterministic for a given pool + seed. Never-offered bins first, then the least-offered ones.
 */
export function pickDailyBins(pool: readonly PoolBin[], seed: string, count = DAILY_BIN_COUNT): string[] {
  const seen = new Map<string, number>();
  for (const bin of pool) {
    const code = normalizeBinCode(bin.binCode);
    if (!code || isExcludedBin(code)) continue;
    const times = Math.max(0, Math.floor(bin.timesAssigned) || 0);
    seen.set(code, Math.min(seen.get(code) ?? times, times));
  }
  // Order the input first, so the DB's row order can't change the result.
  const all = [...seen.entries()].sort((a, b) => compareBinCodes(a[0], b[0]));
  const next = mulberry32(fnv1a(seed));
  const fresh = shuffle(all.filter(([, t]) => t === 0), next);
  const offered = shuffle(all.filter(([, t]) => t > 0), next).sort((a, b) => a[1] - b[1]); // stable: random within a tier
  return [...fresh, ...offered]
    .slice(0, Math.max(0, count))
    .map(([code]) => code)
    .sort(compareBinCodes);
}

// ─── Results from BC ─────────────────────────────────────────────────────────

export type BinResult = 'correct' | 'wrong';
export type BinRoundStatus = 'pending' | BinResult;

export interface BinWrongLine {
  itemNo: string;
  variantCode: string;
  unitOfMeasureCode: string;
  reason: BinCheckReason;
  /** BC's own text, kept only for a status PRISM does not know. */
  statusText: string | null;
  scanQuantity: number | null;
  binQuantity: number | null;
  actualBinCodes: string[];
}

/** One bin on one day it was scanned. */
export interface BinDayCheck {
  date: string;
  wrong: boolean;
  /** Item lines BC compared. */
  lines: number;
  wrongLines: BinWrongLine[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const toQty = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string => (typeof v === 'string' ? decodeODataText(v).trim() : '');

function splitBins(value: unknown): string[] {
  return text(value)
    .split(/[|,;]/)
    .map((s) => normalizeBinCode(s))
    .filter(Boolean);
}

/**
 * Raw BC `ppBinContentCheckHeaders` (+ lines) → location → bin → its scan days (oldest first). Headers with
 * `checked: false` (a bin nobody scanned) and rows outside [from, to] are dropped. Several headers of one bin on
 * one day are one check, wrong when any of them is.
 */
export function collectBinChecks(headers: readonly unknown[], from: string, to: string): Map<string, Map<string, BinDayCheck[]>> {
  const days = new Map<string, Map<string, Map<string, BinDayCheck>>>();
  for (const raw of headers) {
    if (!isBcBinCheckHeader(raw) || raw.checked === false) continue;
    const location = normalizeBinCode(raw.location);
    const date = (raw.date ?? '').slice(0, 10);
    const bin = normalizeBinCode(raw.binCode);
    if (!location || !bin || !isDayKey(date) || date < from || date > to) continue;

    let byBin = days.get(location);
    if (!byBin) days.set(location, (byBin = new Map()));
    let byDay = byBin.get(bin);
    if (!byDay) byBin.set(bin, (byDay = new Map()));
    let check = byDay.get(date);
    if (!check) byDay.set(date, (check = { date, wrong: false, lines: 0, wrongLines: [] }));

    const lines = Array.isArray(raw.ppBinContentCheckLines) ? raw.ppBinContentCheckLines : [];
    for (const rawLine of lines) {
      if (!isRecord(rawLine)) continue;
      const line = rawLine as BcBinCheckLine;
      const scanQuantity = toQty(line.scanQuantity);
      const binQuantity = toQty(line.binQuantity);
      const verdict = judgeStatus(line.binContentCheckStatus, scanQuantity, binQuantity);
      check.lines += 1;
      if (!verdict.wrong) continue;
      check.wrong = true;
      const itemNo = text(line.itemNo);
      const variantCode = text(line.variantCode);
      const dup = check.wrongLines.some((w) => w.itemNo === itemNo && w.variantCode === variantCode && w.reason === verdict.reason);
      if (dup) continue;
      check.wrongLines.push({
        itemNo,
        variantCode,
        unitOfMeasureCode: text(line.unitOfMeasureCode),
        reason: verdict.reason,
        statusText: verdict.statusText,
        scanQuantity,
        binQuantity,
        actualBinCodes: splitBins(line.actualBinCodes),
      });
    }
  }

  const out = new Map<string, Map<string, BinDayCheck[]>>();
  for (const [location, byBin] of days) {
    const bins = new Map<string, BinDayCheck[]>();
    for (const [bin, byDay] of byBin) bins.set(bin, [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)));
    out.set(location, bins);
  }
  return out;
}

export interface FoldedBinChecks {
  status: BinResult;
  firstCheckedOn: string;
  /** Wrong item lines on the first check (the full count; `wrongLines` is capped). */
  firstWrongCount: number;
  wrongLines: BinWrongLine[];
  lastCheckedOn: string;
  lastResult: BinResult;
  /** Days this month the bin was scanned. */
  checkDays: number;
}

/** A bin's month from its scan days: the FIRST check is its result, the last one says whether it was fixed. */
export function foldBinChecks(checks: readonly BinDayCheck[]): FoldedBinChecks | null {
  if (!checks.length) return null;
  const sorted = [...checks].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    status: first.wrong ? 'wrong' : 'correct',
    firstCheckedOn: first.date,
    firstWrongCount: first.wrongLines.length,
    wrongLines: first.wrongLines.slice(0, MAX_WRONG_LINES),
    lastCheckedOn: last.date,
    lastResult: last.wrong ? 'wrong' : 'correct',
    checkDays: sorted.length,
  };
}

/** Found wrong, scanned right on a later day. */
export function isFixed(bin: { status: BinRoundStatus; lastResult: BinResult | null; firstCheckedOn: string | null; lastCheckedOn: string | null }): boolean {
  return bin.status === 'wrong' && bin.lastResult === 'correct' && !!bin.lastCheckedOn && !!bin.firstCheckedOn && bin.lastCheckedOn > bin.firstCheckedOn;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface BinMonthStats {
  /** Bins of the month: still in BC, or already checked. */
  totalBins: number;
  checkedBins: number;
  correctBins: number;
  wrongBins: number;
  /** Wrong bins scanned right on a later day. */
  fixedBins: number;
}

export const EMPTY_STATS: BinMonthStats = { totalBins: 0, checkedBins: 0, correctBins: 0, wrongBins: 0, fixedBins: 0 };

export function pendingBins(s: BinMonthStats): number {
  return Math.max(0, s.totalBins - s.checkedBins);
}

/** Checked ÷ all bins, 0–100; null without bins. */
export function progressPct(s: BinMonthStats): number | null {
  return s.totalBins > 0 ? Math.min(100, (s.checkedBins / s.totalBins) * 100) : null;
}

/** Right ÷ checked, 0–100; null before the first check. */
export function accuracyPct(s: Pick<BinMonthStats, 'correctBins' | 'wrongBins'>): number | null {
  const all = s.correctBins + s.wrongBins;
  return all > 0 ? (s.correctBins / all) * 100 : null;
}

/** Days of DAILY_BIN_COUNT it still takes. */
export function daysToFinish(pending: number, perDay = DAILY_BIN_COUNT): number {
  return pending > 0 ? Math.ceil(pending / perDay) : 0;
}

export function sumStats(list: readonly BinMonthStats[]): BinMonthStats {
  return list.reduce<BinMonthStats>(
    (acc, s) => ({
      totalBins: acc.totalBins + s.totalBins,
      checkedBins: acc.checkedBins + s.checkedBins,
      correctBins: acc.correctBins + s.correctBins,
      wrongBins: acc.wrongBins + s.wrongBins,
      fixedBins: acc.fixedBins + s.fixedBins,
    }),
    { ...EMPTY_STATS },
  );
}

/** "45%" / "45,5%" / "—" */
export function formatPct(n: number | null): string {
  if (n == null) return '—';
  return `${n.toLocaleString('id-ID', { maximumFractionDigits: n >= 99.95 || n < 0.05 || Number.isInteger(n) ? 0 : 1 })}%`;
}

// ─── API shapes ──────────────────────────────────────────────────────────────

/** Where the store's bin list from BC stands. */
export type BinListState = 'ok' | 'syncing' | 'never' | 'failed';

export interface BinListSync {
  state: BinListState;
  /** Last successful read of the store's bins from BC (ISO). */
  syncedAt: string | null;
  binCount: number | null;
  error: string | null;
}

export type BcFeedState = 'ok' | 'not_configured' | 'unavailable';

export interface DailyBinEntry {
  position: number;
  binCode: string;
  status: BinRoundStatus;
  /** First scan this month (may be after the list's day). */
  checkedOn: string | null;
  wrongCount: number;
}

export interface DailyBinList {
  day: string;
  bins: DailyBinEntry[];
  checked: number;
  correct: number;
  wrong: number;
}

export function dailyCounts(bins: readonly DailyBinEntry[]): Pick<DailyBinList, 'checked' | 'correct' | 'wrong'> {
  const correct = bins.filter((b) => b.status === 'correct').length;
  const wrong = bins.filter((b) => b.status === 'wrong').length;
  return { checked: correct + wrong, correct, wrong };
}

/** One store's month on the overview. */
export interface BinProgressStoreRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaId: number | null;
  areaName: string | null;
  /** null = no round for this store this month (no bin list yet, or a past month before the round existed). */
  stats: BinMonthStats | null;
  binList: BinListSync;
  /** Today's list (current month only): bins on it and how many are scanned. */
  today: { assigned: number; checked: number } | null;
  finalizedAt: string | null;
}

export type BinProgressPhase = 'no_list' | 'not_started' | 'running' | 'done';

export function storePhase(row: Pick<BinProgressStoreRow, 'stats'>): BinProgressPhase {
  const s = row.stats;
  if (!s || s.totalBins === 0) return 'no_list';
  if (s.checkedBins === 0) return 'not_started';
  return s.checkedBins >= s.totalBins ? 'done' : 'running';
}

export const PHASE_LABEL: Record<BinProgressPhase, string> = {
  no_list: 'Belum ada daftar bin',
  not_started: 'Belum mulai',
  running: 'Berjalan',
  done: 'Selesai',
};

export interface BinProgressOverview {
  yearMonth: string;
  today: string;
  /** BC answer for the results of this month (null = not asked, e.g. a frozen month). */
  resultsState: BcFeedState | null;
  rows: BinProgressStoreRow[];
}

export interface BinProgressBin {
  binCode: string;
  /** Still on BC's list for the store. */
  inBc: boolean;
  status: BinRoundStatus;
  firstCheckedOn: string | null;
  firstWrongCount: number;
  wrongLines: BinWrongLine[];
  lastCheckedOn: string | null;
  lastResult: BinResult | null;
  checkDays: number;
  timesAssigned: number;
  lastAssignedOn: string | null;
  /** From the store's BC bin list now. */
  itemLines: number | null;
  quantity: number | null;
}

export interface BinProgressDetail {
  store: { id: number; storeNo: string; name: string; areaName: string | null };
  yearMonth: string;
  today: string;
  stats: BinMonthStats | null;
  binList: BinListSync;
  resultsState: BcFeedState | null;
  bins: BinProgressBin[];
  /** Today's list (current month), null when nobody opened the task yet today. */
  todayList: DailyBinList | null;
  finalizedAt: string | null;
  /** The store's bins in BC (its list now) that the round leaves out — isExcludedBin, in bin-code order. */
  excludedBins: string[];
}

/** What the staff Cek Bin page gets. */
export interface EmployeeBinRound {
  /** ok · preparing (the bin list is being read from BC) · failed (BC could not give the list) · no_bins (BC has no bins for the store). */
  state: 'ok' | 'preparing' | 'failed' | 'no_bins';
  day: string;
  perDay: number;
  list: DailyBinList | null;
  month: BinMonthStats | null;
  resultsState: BcFeedState | null;
  /** Every bin of the month is checked: nothing left to hand out. */
  allChecked: boolean;
}

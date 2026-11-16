// lib/audit-super-reward.ts
// ─────────────────────────────────────────────────────────────────────────────
// Audit "Super Reward" — the Lampiran Regular Reward Stock Opname, the third document of a Stock Opname beside the
// Berita Acara SO and the Surat Pernyataan. Client-safe rules + shapes (no DB imports); the printed page copies the
// "Super Reward" sheet of format stock opname audit.xlsx (components/audit/stock-opname/SuperRewardDocument.tsx).
//
// One row per employee of the store, saved on the Stock Opname record (`audit_stock_opnames.reward_rows`, a snapshot).
//   From PRISM, never typed: No · Employee No. (NIK) · Employee Name · Tgl SO Audit (= the SO day) · PIC (PIC 1,
//     PIC 2, SA 1 … SA n — SAs numbered in list order).
//   Typed by the auditor: Tgl Masuk Toko Awal · Rincian Tgl SO (SO Periode 1–3).
//   The other four FOLLOW those until the auditor picks another value (stored null = follow the rule):
//     Ket Durasi           = "> 3 BULAN" once the SO day is ≥ 3 calendar months after Tgl Masuk, else "< 3 BULAN"
//     Jumlah SO            = how many SO dates are filled
//     Keterangan Incentive = > 3 BULAN → "Dapat Regular Reward" · < 3 BULAN → "Tidak Dapat Regular Reward"
//     Regular Reward       = when Dapat, by Jumlah SO: 1 → Voucher Rp 300.000 · 2 → Voucher Rp 500.000 · 3 → Cash Rp 500.000
//   (read off the sample sheet — every row of it follows these; the exact 3-month boundary and the tiers are not
//   confirmed by the audit team, which is why every one of them can be overridden per row).
// ─────────────────────────────────────────────────────────────────────────────

import { isDayKey } from '@/lib/day-bucket';
import type { Signatory } from '@/lib/audit-cash-check';

// ─── Columns ─────────────────────────────────────────────────────────────────

export type RewardType = 'pic_1' | 'pic_2' | 'sa';

export const REWARD_TYPES: ReadonlyArray<{ key: RewardType; label: string }> = [
  { key: 'pic_1', label: 'PIC 1' },
  { key: 'pic_2', label: 'PIC 2' },
  { key: 'sa', label: 'SA' },
];

const TYPE_ORDER: Record<RewardType, number> = { pic_1: 0, pic_2: 1, sa: 2 };

/** employee_types.code → the sheet's PIC column ('pic_1' / 'pic_2' / 'sa'); anything else → null (printed blank). */
export function rewardTypeOf(code: string | null | undefined): RewardType | null {
  return code === 'pic_1' || code === 'pic_2' || code === 'sa' ? code : null;
}

export type RewardDuration = 'over' | 'under';
export const DURATION_LABEL: Record<RewardDuration, string> = { over: '> 3 BULAN', under: '< 3 BULAN' };
export const REWARD_MIN_MONTHS = 3;

export type RewardIncentive = 'dapat' | 'tidak';
export const INCENTIVE_LABEL: Record<RewardIncentive, string> = {
  dapat: 'Dapat Regular Reward',
  tidak: 'Tidak Dapat Regular Reward',
};

export type RewardTier = 'voucher_300' | 'voucher_500' | 'cash_500';
export type RewardChoice = RewardTier | 'none';

/** The three REGULAR REWARD columns (R · S · T), in the sheet's order. */
export const REWARD_TIERS: ReadonlyArray<{ key: RewardTier; kind: 'voucher' | 'cash'; amount: number; label: string; short: string; header: string }> = [
  { key: 'voucher_300', kind: 'voucher', amount: 300_000, label: 'Voucher cash Rp 300.000', short: 'Voucher 300rb', header: 'Rp 300.000,-' },
  { key: 'voucher_500', kind: 'voucher', amount: 500_000, label: 'Voucher cash Rp 500.000', short: 'Voucher 500rb', header: 'Rp 500.000,-' },
  { key: 'cash_500', kind: 'cash', amount: 500_000, label: 'Cash Rp 500.000', short: 'Cash 500rb', header: 'Rp 500.000,-' },
];

export const REWARD_CHOICE_LABEL: Record<RewardChoice, string> = {
  voucher_300: 'Voucher 300rb',
  voucher_500: 'Voucher 500rb',
  cash_500: 'Cash 500rb',
  none: 'Tidak ada',
};

/** Rincian Tgl SO has three columns: SO PERIODE 1 · 2 · 3. */
export const SO_PERIODS = 3;
export const REWARD_ROWS_MAX = 40;
export const REWARD_NIK_MAX = 30;
export const REWARD_NAME_MAX = 80;
export const SO_COUNT_MAX = 9;

/** Dept IR signs the Super Reward (between Disetujui and Diketahui); carried to the next Stock Opname like the others. */
export const DEFAULT_IR: Signatory = { name: 'Pandapotan Judika', title: 'Manager IR' };

// ─── The row ─────────────────────────────────────────────────────────────────

export interface SoRewardRow {
  /** The PRISM user the auto columns come from; null = added by hand (not in PRISM). */
  userId: string | null;
  nik: string;
  name: string;
  type: RewardType | null;
  /** Tgl Masuk Toko Awal (YYYY-MM-DD). */
  joinDate: string | null;
  /** Rincian Tgl SO — SO Periode 1, 2, 3. Always SO_PERIODS long. */
  soDates: (string | null)[];
  // ── Overrides — null = follow the rule ──
  duration: RewardDuration | null;
  soCount: number | null;
  incentive: RewardIncentive | null;
  reward: RewardChoice | null;
}

/** A row's four rule-driven columns as they print, and whether each still follows its rule. */
export interface ResolvedReward {
  duration: RewardDuration | null;
  durationAuto: boolean;
  soCount: number;
  soCountAuto: boolean;
  incentive: RewardIncentive | null;
  incentiveAuto: boolean;
  reward: RewardChoice | null;
  rewardAuto: boolean;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

/** YYYY-MM-DD + n calendar months, clamped to the month's last day (30 Nov + 3 → 28/29 Feb). */
export function addMonthsDay(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function autoDuration(joinDate: string | null, soDate: string): RewardDuration | null {
  if (!joinDate) return null;
  return addMonthsDay(joinDate, REWARD_MIN_MONTHS) <= soDate ? 'over' : 'under';
}

export const countSoDates = (dates: ReadonlyArray<string | null>): number => dates.filter(Boolean).length;

export function autoIncentive(duration: RewardDuration | null): RewardIncentive | null {
  return duration == null ? null : duration === 'over' ? 'dapat' : 'tidak';
}

export function autoReward(incentive: RewardIncentive | null, soCount: number): RewardChoice | null {
  if (incentive == null) return null;
  if (incentive === 'tidak' || soCount <= 0) return 'none';
  return soCount === 1 ? 'voucher_300' : soCount === 2 ? 'voucher_500' : 'cash_500';
}

/** The rule chain — an override feeds the next rule (a Ket Durasi picked by hand drives Keterangan, and so on). */
export function resolveReward(row: SoRewardRow, soDate: string): ResolvedReward {
  const duration = row.duration ?? autoDuration(row.joinDate, soDate);
  const soCount = row.soCount ?? countSoDates(row.soDates);
  const incentive = row.incentive ?? autoIncentive(duration);
  const reward = row.reward ?? autoReward(incentive, soCount);
  return {
    duration,
    durationAuto: row.duration == null,
    soCount,
    soCountAuto: row.soCount == null,
    incentive,
    incentiveAuto: row.incentive == null,
    reward,
    rewardAuto: row.reward == null,
  };
}

/** PIC 1 first, then PIC 2, then SA, then anyone without a type — keeping the order inside each group. */
export function sortRewardRows<T extends Pick<SoRewardRow, 'type'>>(rows: T[]): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.type ? TYPE_ORDER[a.row.type] : 9) - (b.row.type ? TYPE_ORDER[b.row.type] : 9) || a.i - b.i)
    .map((x) => x.row);
}

/** The PIC column for each row: "PIC 1", "PIC 2", "SA 1", "SA 2" … (SAs numbered in list order); '' without a type. */
export function rewardRoleLabels(rows: ReadonlyArray<Pick<SoRewardRow, 'type'>>): string[] {
  let sa = 0;
  return rows.map((r) => (r.type === 'pic_1' ? 'PIC 1' : r.type === 'pic_2' ? 'PIC 2' : r.type === 'sa' ? `SA ${++sa}` : ''));
}

export interface RewardSummary {
  employees: number;
  /** Rows whose Keterangan is Dapat / Tidak Dapat / not decided yet (no Tgl Masuk and nothing picked). */
  dapat: number;
  tidak: number;
  open: number;
  byTier: Record<RewardTier, number>;
  voucher: number;
  cash: number;
  total: number;
}

export function summarizeReward(rows: ReadonlyArray<SoRewardRow>, soDate: string): RewardSummary {
  const s: RewardSummary = {
    employees: rows.length,
    dapat: 0,
    tidak: 0,
    open: 0,
    byTier: { voucher_300: 0, voucher_500: 0, cash_500: 0 },
    voucher: 0,
    cash: 0,
    total: 0,
  };
  for (const row of rows) {
    const r = resolveReward(row, soDate);
    if (r.incentive === 'dapat') s.dapat += 1;
    else if (r.incentive === 'tidak') s.tidak += 1;
    else s.open += 1;
    const tier = REWARD_TIERS.find((t) => t.key === r.reward);
    if (!tier) continue;
    s.byTier[tier.key] += 1;
    if (tier.kind === 'voucher') s.voucher += tier.amount;
    else s.cash += tier.amount;
  }
  s.total = s.voucher + s.cash;
  return s;
}

// ─── Building rows ───────────────────────────────────────────────────────────

const padDates = (dates: ReadonlyArray<string | null>): (string | null)[] =>
  Array.from({ length: SO_PERIODS }, (_, i) => dates[i] ?? null);

export interface RewardPerson {
  userId: string | null;
  nik: string;
  name: string;
  type: RewardType | null;
}

/**
 * A new row for a person. Without history: SO Periode 1 = this SO's day, nothing else filled. With the person's row
 * in an EARLIER Super Reward of the same store: Tgl Masuk carried over, and that row's SO dates + this SO's day as the
 * Rincian (the last three, oldest first) — the auditor removes a date that should not count.
 */
export function newRewardRow(person: RewardPerson, soDate: string, previous?: SoRewardRow | null): SoRewardRow {
  const earlier = (previous?.soDates ?? []).filter((d): d is string => !!d && d < soDate);
  const dates = [...new Set([...earlier, soDate])].sort().slice(-SO_PERIODS);
  return {
    userId: person.userId,
    nik: person.nik,
    name: person.name,
    type: person.type,
    joinDate: previous?.joinDate ?? null,
    soDates: padDates(dates),
    duration: null,
    soCount: null,
    incentive: null,
    reward: null,
  };
}

// ─── Clean-up (server + client) ──────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const cleanText = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const cleanDay = (v: unknown): string | null => (typeof v === 'string' && isDayKey(v) ? v : null);

const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => (values.includes(v as T) ? (v as T) : null);

export function cleanRewardRows(input: unknown): SoRewardRow[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SoRewardRow[] = [];
  for (const raw of input) {
    if (out.length >= REWARD_ROWS_MAX) break;
    if (!isRecord(raw)) continue;
    const userId = typeof raw.userId === 'string' && raw.userId.trim() ? raw.userId.trim().slice(0, 64) : null;
    if (userId) {
      if (seen.has(userId)) continue;
      seen.add(userId);
    }
    const name = cleanText(raw.name, REWARD_NAME_MAX);
    if (!name) continue;
    const dates = Array.isArray(raw.soDates) ? raw.soDates.slice(0, SO_PERIODS).map(cleanDay) : [];
    const count = raw.soCount == null || raw.soCount === '' ? null : Math.round(Number(raw.soCount));
    out.push({
      userId,
      nik: cleanText(raw.nik, REWARD_NIK_MAX).toUpperCase(),
      name,
      type: oneOf(raw.type, ['pic_1', 'pic_2', 'sa'] as const),
      joinDate: cleanDay(raw.joinDate),
      soDates: padDates(dates),
      duration: oneOf(raw.duration, ['over', 'under'] as const),
      soCount: count == null || !Number.isFinite(count) ? null : Math.min(Math.max(count, 0), SO_COUNT_MAX),
      incentive: oneOf(raw.incentive, ['dapat', 'tidak'] as const),
      reward: oneOf(raw.reward, ['voucher_300', 'voucher_500', 'cash_500', 'none'] as const),
    });
  }
  return out;
}

// ─── On paper ────────────────────────────────────────────────────────────────

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The sheet's `[$-409]d-mmm-yy`: "1-Jan-26", "16-Sep-26". '' for no date. */
export function sheetDate(day: string | null | undefined): string {
  if (!day || !isDayKey(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${d}-${MONTHS_EN[m - 1]}-${String(y).slice(-2)}`;
}

/** Row 3 of the sheet: "LAMPIRAN REGULAR REWARD STOCK OPNAME FS020 FISIK SPORT PLAZA MEDAN FAIR". */
export const rewardTitle = (storeNo: string, storeTitle: string): string =>
  `LAMPIRAN REGULAR REWARD STOCK OPNAME ${storeNo} ${storeTitle}`.replace(/\s+/g, ' ').trim();

/** Screen money: "Rp 1.100.000". */
export const rewardRupiah = (n: number): string => `Rp ${new Intl.NumberFormat('id-ID').format(n)}`;

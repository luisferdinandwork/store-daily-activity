// lib/setoran-correction.ts
// Pure maths for IT's "Koreksi Setoran" — client-safe, no DB imports. The page
// uses it for the live preview and the server (lib/db/utils/setoran-correction.ts)
// re-runs it on the rows it reads inside the transaction, so both always agree.
//
// The ledger is a running balance: each day's `unpaid` (sisa) becomes the next
// day's `carryIn` (sisa kemarin). Correcting one day therefore shifts every day
// after it, and this recalculates that whole tail.

import { SETORAN_SMALL_THRESHOLD } from '@/lib/setoran-review';

/** decimal(12,2) ceiling — anything bigger can't be stored. */
export const SETORAN_MAX_AMOUNT = 9_999_999_999;

/** Deposits are made in multiples of this (same step as the employee setoran page). */
export const SETORAN_DEPOSIT_STEP = 50_000;

/**
 * The deposit the employee page would suggest: the whole cash drawer — uang
 * diterima PLUS sisa kemarin — rounded down to the deposit step; nothing when
 * that total is under Rp 50.000.
 */
export function suggestedDeposit(drawerTotal: number): number {
  if (!Number.isFinite(drawerTotal) || drawerTotal < SETORAN_SMALL_THRESHOLD) return 0;
  return Math.floor(drawerTotal / SETORAN_DEPOSIT_STEP) * SETORAN_DEPOSIT_STEP;
}

export const CORRECTION_REASON_MIN = 5;
export const CORRECTION_REASON_MAX = 500;

// ─── API shapes (GET /api/ops/setoran-correction) ────────────────────────────

export interface CorrectableStore {
  id: number;
  storeNo: string;
  name: string;
}

/**
 * What a calendar day looks like for the store:
 *  - submitted — a completed setoran with a ledger row (correctable)
 *  - draft     — a task exists but was never submitted (can be filled in)
 *  - orphan    — a completed task with no ledger row (legacy data; can't be edited here)
 *  - empty     — nothing at all (can be filled in)
 */
export type SetoranDayKind = 'submitted' | 'draft' | 'orphan' | 'empty';

/** One calendar day in the correction page's list — with or without a setoran. */
export interface SetoranDayRow {
  /** YYYY-MM-DD */
  date: string;
  kind: SetoranDayKind;
  /** An opening-shift schedule exists that day (the store was expected to report). */
  scheduled: boolean;
  taskId: number | null;
  /** Sisa kemarin: the balance coming into this day (running, also across empty days). */
  carryIn: number;
  /** Balance owed after this day — equals `carryIn` when nothing was submitted. */
  balance: number;
  // Money — set for a submitted day; for a draft only what was typed so far.
  received: number | null;
  required: number | null;
  stored: number | null;
  unpaid: number | null;
  isNoSetoran: boolean;
  submittedBy: string | null;
  submittedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** How many times IT has changed this day. */
  correctionCount: number;
  /** The latest IT change was filling the day in (rather than correcting it). */
  addedByIt: boolean;
}

export interface SetoranCorrectionEntry {
  id: number;
  taskId: number;
  kind: 'correct' | 'create';
  /** YYYY-MM-DD of the corrected day. */
  date: string;
  reason: string;
  correctedBy: string;
  createdAt: string;
  before: { received: number; stored: number; unpaid: number };
  after: { received: number; stored: number; unpaid: number };
  wasVerified: boolean;
  /** Number of later days whose carry-over was recalculated. */
  affectedDays: number;
}

export interface SetoranLedgerView {
  store: CorrectableStore;
  /** Jakarta calendar date the list runs up to. */
  today: string;
  /** Every day from `days` ago through today, date ascending. */
  rows: SetoranDayRow[];
  /** Newest first. */
  corrections: SetoranCorrectionEntry[];
}

/** One ledger day, integer Rupiah. */
export interface LedgerChainRow {
  taskId: number;
  /** YYYY-MM-DD */
  date: string;
  received: number;
  carryIn: number;
  required: number;
  stored: number;
  unpaid: number;
}

export interface PlannedRow extends LedgerChainRow {
  isTarget: boolean;
  /** Values before the correction. */
  before: Pick<LedgerChainRow, 'received' | 'carryIn' | 'required' | 'stored' | 'unpaid'>;
  changed: boolean;
  /** `stored` is larger than the recalculated required amount — sisa floored at 0. */
  clamped: boolean;
}

export type CorrectionPlan =
  | {
      ok: true;
      rows: PlannedRow[];
      noChange: boolean;
      /** Balance still owed after the last day, before → after. */
      closingBefore: number;
      closingAfter: number;
    }
  | { ok: false; error: string };

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

const isAmount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= SETORAN_MAX_AMOUNT;

/**
 * `chain` = the corrected day first, then every later ledger day of the same
 * store in date order. The corrected day keeps its own sisa kemarin; each later
 * day keeps its uang diterima and disetor but takes its sisa kemarin from the
 * day before it.
 */
export function planSetoranCorrection(
  chain: LedgerChainRow[],
  input: { received: number; stored: number },
  /** `isNew`: chain[0] is a placeholder for a day with no setoran yet (see `createChain`). */
  opts: { isNew?: boolean } = {},
): CorrectionPlan {
  const [target, ...later] = chain;
  if (!target) return { ok: false, error: 'Setoran tidak ditemukan.' };

  const { received, stored } = input;
  if (!isAmount(received) || !isAmount(stored)) {
    return { ok: false, error: 'Nominal harus berupa angka bulat Rupiah (0 atau lebih).' };
  }

  // The deposit comes out of the whole cash drawer: uang diterima PLUS sisa
  // kemarin. (Same rule as submitSetoran's "setoran kecil" check: the carried
  // sisa counts too, so a day deposits the accumulated balance even when little
  // was received that day.)
  const required = received + target.carryIn;
  if (required < SETORAN_SMALL_THRESHOLD && stored > 0) {
    return {
      ok: false,
      error: `Uang di laci (diterima + sisa kemarin = ${rp(required)}) di bawah ${rp(SETORAN_SMALL_THRESHOLD)} tidak disetor — nominal disetor harus 0.`,
    };
  }
  if (stored > required) {
    return {
      ok: false,
      error: `Nominal disetor (${rp(stored)}) melebihi uang diterima + sisa kemarin (${rp(required)}).`,
    };
  }

  const rows: PlannedRow[] = [];
  const unpaid = required - stored;
  rows.push({
    taskId: target.taskId,
    date: target.date,
    received,
    carryIn: target.carryIn,
    required,
    stored,
    unpaid,
    isTarget: true,
    before: pick(target),
    changed: opts.isNew || received !== target.received || stored !== target.stored || unpaid !== target.unpaid,
    clamped: false,
  });

  let carry = unpaid;
  for (const r of later) {
    const req = r.received + carry;
    const sisa = Math.max(0, req - r.stored);
    rows.push({
      taskId: r.taskId,
      date: r.date,
      received: r.received,
      carryIn: carry,
      required: req,
      stored: r.stored,
      unpaid: sisa,
      isTarget: false,
      before: pick(r),
      changed: carry !== r.carryIn || req !== r.required || sisa !== r.unpaid,
      clamped: r.stored > req,
    });
    carry = sisa;
  }

  return {
    ok: true,
    rows,
    noChange: !rows[0].changed,
    closingBefore: chain[chain.length - 1].unpaid,
    closingAfter: carry,
  };
}

function pick(r: LedgerChainRow): PlannedRow['before'] {
  return { received: r.received, carryIn: r.carryIn, required: r.required, stored: r.stored, unpaid: r.unpaid };
}

/** The corrected day and every submitted day after it, from the page's day list. */
export function correctionChain(days: SetoranDayRow[], taskId: number): LedgerChainRow[] {
  const i = days.findIndex((d) => d.taskId === taskId && d.kind === 'submitted');
  if (i < 0) return [];
  return days.slice(i).flatMap((d) => (d.kind === 'submitted' ? [toChainRow(d)] : []));
}

/**
 * A day with no setoran yet: a placeholder head (nothing received or deposited,
 * so its sisa is just the balance carried in) followed by every submitted day
 * after it, whose carry-over the new day will change.
 */
export function createChain(days: SetoranDayRow[], date: string): LedgerChainRow[] {
  const day = days.find((d) => d.date === date);
  if (!day) return [];
  const head: LedgerChainRow = {
    taskId: 0,
    date,
    received: 0,
    carryIn: day.carryIn,
    required: day.carryIn,
    stored: 0,
    unpaid: day.carryIn,
  };
  return [head, ...days.filter((d) => d.date > date && d.kind === 'submitted').map(toChainRow)];
}

function toChainRow(d: SetoranDayRow): LedgerChainRow {
  return {
    taskId: d.taskId ?? 0,
    date: d.date,
    received: d.received ?? 0,
    carryIn: d.carryIn,
    required: d.required ?? 0,
    stored: d.stored ?? 0,
    unpaid: d.unpaid ?? 0,
  };
}

/** Trimmed reason, or an error message. */
export function validateCorrectionReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < CORRECTION_REASON_MIN) {
    return { ok: false, error: `Alasan koreksi wajib diisi (minimal ${CORRECTION_REASON_MIN} karakter).` };
  }
  if (reason.length > CORRECTION_REASON_MAX) {
    return { ok: false, error: `Alasan koreksi maksimal ${CORRECTION_REASON_MAX} karakter.` };
  }
  return { ok: true, reason };
}

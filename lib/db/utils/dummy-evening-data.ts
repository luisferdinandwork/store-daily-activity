// lib/db/utils/dummy-evening-data.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dummy data generator that simulates a back-office/system API. Used by:
//   • EDC Reconciliation → generateExpectedEdcData(storeId, date)
//   • Open Statement     → generateExpectedOpenStatement(storeId, date)
//
// Deterministic per (storeId, date) within a single fetch, so re-fetching for
// the same task returns stable numbers. Uses a seeded PRNG so the values look
// realistic but are reproducible until the task is submitted. Variation still
// happens across different stores/dates, and across re-fetches if the caller
// passes a new `nonce`.
//
// Realism notes:
//   • ~80% of generated payloads are fully balanced (actual will match).
//   • ~20% contain 1–2 mismatches (either wrong amount or wrong count) —
//     this is what makes the evening tasks interesting to test the
//     discrepancy carry-forward flow.
// ─────────────────────────────────────────────────────────────────────────────

import type { EdcTransactionRow } from '@/lib/db/schema';

export type TxType = 'credit' | 'debit' | 'qris' | 'ewallet' | 'cash';

export interface ExpectedEdcRow {
  transactionType: TxType;
  expectedAmount:  number;   // whole rupiah
  expectedCount:   number;
}

export interface ExpectedEdcSnapshot {
  rows:       ExpectedEdcRow[];
  generatedAt: string;       // ISO timestamp
  seed:       number;        // the seed used (for debugging)
}

export interface ExpectedOpenStatement {
  amount:     number;
  generatedAt: string;
  seed:       number;
}

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(storeId: number, date: Date, nonce = 0): number {
  // djb2-ish, folds storeId + yyyymmdd + nonce
  const yyyymmdd = date.getUTCFullYear() * 10000
                 + (date.getUTCMonth() + 1) * 100
                 + date.getUTCDate();
  let h = 5381;
  h = ((h << 5) + h) + storeId;
  h = ((h << 5) + h) + yyyymmdd;
  h = ((h << 5) + h) + nonce;
  return h >>> 0;
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pickRandom<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ─── EDC expected data ───────────────────────────────────────────────────────

const ALL_TX_TYPES: readonly TxType[] = ['credit', 'debit', 'qris', 'ewallet', 'cash'];

/** Typical per-transaction amount range for realism (whole rupiah). */
const AMOUNT_RANGES: Record<TxType, [number, number]> = {
  credit:  [150_000, 800_000],
  debit:   [100_000, 500_000],
  qris:    [ 25_000, 300_000],
  ewallet: [ 30_000, 250_000],
  cash:    [ 50_000, 400_000],
};

/**
 * Generate expected EDC rows for a (storeId, date).
 *
 * @param nonce  optional seed modifier — pass a Date.now() or task.id to force
 *               a fresh distribution when re-fetching for a new task.
 */
export function generateExpectedEdcData(
  storeId: number,
  date:    Date,
  nonce:   number = 0,
): ExpectedEdcSnapshot {
  const seed = hashSeed(storeId, date, nonce);
  const rand = mulberry32(seed);

  // Each store sees 3–5 of the 5 transaction types on any given day.
  const numTypes = randInt(rand, 3, 5);
  const shuffled = [...ALL_TX_TYPES].sort(() => rand() - 0.5);
  const chosen   = shuffled.slice(0, numTypes);

  const rows: ExpectedEdcRow[] = chosen.map(t => {
    const [min, max] = AMOUNT_RANGES[t];
    const count      = randInt(rand, 1, 12);
    // Each individual transaction is a random amount in the range, rounded to
    // the nearest 1000 rupiah for realism. Total = sum.
    let totalAmount = 0;
    for (let i = 0; i < count; i++) {
      const tx = Math.round(randInt(rand, min, max) / 1000) * 1000;
      totalAmount += tx;
    }
    return {
      transactionType: t,
      expectedAmount:  totalAmount,
      expectedCount:   count,
    };
  });

  return {
    rows,
    generatedAt: new Date().toISOString(),
    seed,
  };
}

// ─── Open Statement expected amount ──────────────────────────────────────────

/**
 * Generate the expected Open Statement amount for a (storeId, date).
 * Simulates a back-office total that the employee compares against the
 * system's Open Statement menu.
 */
export function generateExpectedOpenStatement(
  storeId: number,
  date:    Date,
  nonce:   number = 0,
): ExpectedOpenStatement {
  // Use a different nonce shift so the Open Statement seed is independent
  // of the EDC seed even for the same storeId/date.
  const seed = hashSeed(storeId, date, nonce + 17);
  const rand = mulberry32(seed);

  // 500k – 15M rupiah, rounded to the nearest 1000.
  const amount = Math.round(randInt(rand, 500_000, 15_000_000) / 1000) * 1000;

  return {
    amount,
    generatedAt: new Date().toISOString(),
    seed,
  };
}

// ─── Row comparison helpers ──────────────────────────────────────────────────

/**
 * Compare an actual submitted row against its expected counterpart.
 * Returns true iff both amount AND count match.
 */
export function rowMatches(
  expected: { expectedAmount: number; expectedCount: number } | undefined,
  actual:   Pick<EdcTransactionRow, 'actualAmount' | 'actualCount'>,
): boolean {
  if (!expected) return false;
  const actualAmount = actual.actualAmount != null ? Number(actual.actualAmount) : NaN;
  const actualCount  = actual.actualCount  ?? NaN;
  return expected.expectedAmount === actualAmount
      && expected.expectedCount  === actualCount;
}

/** Parse a snapshot JSON text column back into an ExpectedEdcSnapshot. */
export function parseExpectedSnapshot(raw: string | null): ExpectedEdcSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rows)) return parsed as ExpectedEdcSnapshot;
    return null;
  } catch {
    return null;
  }
}
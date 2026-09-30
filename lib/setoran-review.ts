// lib/setoran-review.ts
// Shapes, status rules and grouping for Finance's Setoran Review (daily) and
// Setoran Report (monthly) — client-safe, no DB imports. Shared by both pages,
// their APIs and the Excel export.

export { storeCodeOf } from '@/lib/petty-cash-report';

// ─── Business thresholds ─────────────────────────────────────────────────────

/** Below this "uang aktual diterima" nothing is deposited — only a cashier photo. */
export const SETORAN_SMALL_THRESHOLD = 50_000;

/**
 * A remainder up to this amount is normal daily rounding (Rp 67.700 carried from
 * Rp 4.567.700 → Rp 4.500.000). Anything above is flagged "Kurang setor".
 */
export const SETORAN_SHORT_THRESHOLD = 100_000;

// ─── Daily row ───────────────────────────────────────────────────────────────

export type SetoranTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'pending' | 'no_data';

export interface SetoranStoreRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  /** Letters of the store code — FF001 → "FF". */
  code: string;

  /** Null when no setoran task exists yet for this day. */
  taskId: number | null;
  /** 'no_data' = the store is scheduled but no task row was ever created. */
  status: SetoranTaskStatus;

  // Money, integer Rupiah. Null while there is nothing entered yet.
  /** Uang aktual diterima. */
  received: number | null;
  /** Sisa kemarin — unpaid balance carried in from earlier days. */
  carryIn: number;
  /** Wajib disetor = received + carryIn. */
  required: number | null;
  /** Uang disetor. */
  stored: number | null;
  /** Sisa hari ini = required − stored (becomes tomorrow's carryIn). */
  unpaid: number | null;
  /** The store genuinely had no setoran (uang diterima = 0). */
  isNoSetoran: boolean;

  // Evidence photos
  resiPhoto: string | null;
  atmCardSelfiePhoto: string | null;
  cashierPhoto: string | null;
  atmCardPhoto: string | null;

  // Actor trail (display names)
  submittedBy: string | null;
  submittedAt: string | null;
  receivedBy: string | null;
  receivedAt: string | null;
  storedBy: string | null;
  storedAt: string | null;
  notes: string | null;

  // Verification
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** Completed and not verified yet. */
  canVerify: boolean;

  /** Latest IT change to this day (Koreksi Setoran): its figures corrected, or the whole day filled in. */
  correction: { by: string; at: string; reason: string; kind: 'correct' | 'create' } | null;

  /** Staff on an opening shift that day. */
  scheduledStaff: { userId: string; name: string }[];
}

// ─── Review status ───────────────────────────────────────────────────────────

export type ReviewStatus =
  | 'belum_setor'   // red    — day is over and nothing was submitted
  | 'pending'       // red    — unresolved discrepancy
  | 'kurang'        // amber  — submitted, but remainder above the rounding threshold
  | 'draft'         // blue   — being filled in today
  | 'belum_mulai'   // slate  — not started yet (today / future)
  | 'selesai'       // green  — submitted, remainder within rounding
  | 'tanpa_setoran'; // slate — store had no setoran that day

export interface StatusMeta {
  label: string;
  dot: string;
  badge: string;
  /** Sorted / counted as needing Finance's attention. */
  attention: boolean;
}

export const STATUS_META: Record<ReviewStatus, StatusMeta> = {
  belum_setor:   { label: 'Belum setor',   dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',         attention: true },
  pending:       { label: 'Pending',       dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',         attention: true },
  kurang:        { label: 'Kurang setor',  dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-800 ring-amber-200',      attention: true },
  draft:         { label: 'Draft',         dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',         attention: false },
  belum_mulai:   { label: 'Belum mulai',   dot: 'bg-slate-300',   badge: 'bg-slate-100 text-slate-600 ring-slate-200',     attention: false },
  selesai:       { label: 'Selesai',       dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', attention: false },
  tanpa_setoran: { label: 'Tanpa setoran', dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600 ring-slate-200',     attention: false },
};

export const STATUS_ORDER: ReviewStatus[] = [
  'belum_setor', 'pending', 'kurang', 'draft', 'belum_mulai', 'selesai', 'tanpa_setoran',
];

/** `isPastDay` — the reviewed date is before today (Jakarta), so "not submitted" is now a miss. */
export function deriveReviewStatus(row: SetoranStoreRow, isPastDay: boolean): ReviewStatus {
  switch (row.status) {
    case 'completed':
      if (row.isNoSetoran) return 'tanpa_setoran';
      return (row.unpaid ?? 0) > SETORAN_SHORT_THRESHOLD ? 'kurang' : 'selesai';
    case 'pending':
      return 'pending';
    case 'in_progress':
      return isPastDay ? 'belum_setor' : 'draft';
    default:
      return isPastDay ? 'belum_setor' : 'belum_mulai';
  }
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export interface EvidenceSlot {
  key: 'resi' | 'atmSelfie' | 'cashier' | 'atmCard';
  label: string;
  url: string | null;
}

/**
 * The photos Finance should see for this row. A small setoran (< Rp 50.000)
 * carries "Foto sisa setoran" + "Foto kartu ATM"; a normal one carries the
 * bank receipt + a selfie with the ATM card. Before an amount is entered we
 * just list whichever photos exist.
 */
export function evidenceSlots(row: SetoranStoreRow): EvidenceSlot[] {
  const resi:      EvidenceSlot = { key: 'resi',      label: 'Foto resi',        url: row.resiPhoto };
  const atmSelfie: EvidenceSlot = { key: 'atmSelfie', label: 'Selfie kartu ATM', url: row.atmCardSelfiePhoto };
  const cashier:   EvidenceSlot = { key: 'cashier',   label: 'Foto sisa setoran', url: row.cashierPhoto };
  const atmCard:   EvidenceSlot = { key: 'atmCard',   label: 'Foto kartu ATM',   url: row.atmCardPhoto };

  if (row.received == null) return [resi, atmSelfie, cashier, atmCard].filter((s) => s.url);
  // Small = little received and nothing deposited. A day that deposited money
  // (e.g. IT recorded a deposit of the carried sisa) needs the bank receipt.
  const small = row.received < SETORAN_SMALL_THRESHOLD && (row.stored ?? 0) === 0;
  return small ? [cashier, atmCard] : [resi, atmSelfie];
}

/** Labels of required photos that a submitted setoran doesn't have. */
export function missingEvidence(row: SetoranStoreRow): string[] {
  if (row.status !== 'completed') return [];
  return evidenceSlots(row).filter((s) => !s.url).map((s) => s.label);
}

// ─── Grouping by store code ──────────────────────────────────────────────────
// Shared with the other Finance sheet pages — see lib/finance/code-groups.ts.

export { groupRowsByCode, type CodeGroup } from '@/lib/finance/code-groups';

export interface DayTotals {
  received: number;
  carryIn: number;
  required: number;
  stored: number;
  unpaid: number;
}

export function sumDay(rows: SetoranStoreRow[]): DayTotals {
  const t: DayTotals = { received: 0, carryIn: 0, required: 0, stored: 0, unpaid: 0 };
  for (const r of rows) {
    t.received += r.received ?? 0;
    t.carryIn += r.carryIn;
    t.required += r.required ?? 0;
    t.stored += r.stored ?? 0;
    t.unpaid += r.status === 'completed' ? r.unpaid ?? 0 : 0;
  }
  return t;
}

// ─── Monthly row ─────────────────────────────────────────────────────────────

export interface SetoranMonthRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaName: string;
  code: string;

  /** Days with an opening-shift schedule, up to and including today. */
  workDays: number;
  /** Submitted with money deposited. */
  depositDays: number;
  /** Submitted with nothing deposited (no setoran / small setoran). */
  noDepositDays: number;
  /** Past work days with no submission. */
  missedDays: number;

  totalReceived: number;
  totalStored: number;
  /** Unpaid balance after the latest submission up to the end of the month. */
  closingUnpaid: number;
  /** Submitted setoran Finance hasn't verified. */
  unverified: number;
  /** YYYY-MM-DD of the latest submission in the month. */
  lastSubmittedDate: string | null;
}

export interface MonthTotals {
  stores: number;
  workDays: number;
  depositDays: number;
  noDepositDays: number;
  missedDays: number;
  totalReceived: number;
  totalStored: number;
  closingUnpaid: number;
  unverified: number;
}

export function sumMonth(rows: SetoranMonthRow[]): MonthTotals {
  const t: MonthTotals = {
    stores: rows.length, workDays: 0, depositDays: 0, noDepositDays: 0, missedDays: 0,
    totalReceived: 0, totalStored: 0, closingUnpaid: 0, unverified: 0,
  };
  for (const r of rows) {
    t.workDays += r.workDays;
    t.depositDays += r.depositDays;
    t.noDepositDays += r.noDepositDays;
    t.missedDays += r.missedDays;
    t.totalReceived += r.totalReceived;
    t.totalStored += r.totalStored;
    t.closingUnpaid += r.closingUnpaid;
    t.unverified += r.unverified;
  }
  return t;
}

// ─── Dates ───────────────────────────────────────────────────────────────────
// Shared with the other Finance daily pages — see lib/finance/dates.ts.

export {
  dayBounds,
  dayKey,
  fmtDateLong,
  fmtDateShort,
  fmtDateTime,
  shiftDate,
  todayJakarta,
} from '@/lib/finance/dates';

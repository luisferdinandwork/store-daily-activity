// lib/petty-cash-review.ts
//
// Finance's review of a completed petty cash request (client-safe, no DB imports) — shared by the
// Finance Petty Cash Monitoring page, the employee Petty Cash page and their APIs.
//
// Finance checks petty cash once a month. On /finance/petty-cash it may turn a request down in one of
// two ways, with or without a comment, until it verifies the refill that covers it:
//
//   Perlu Perbaikan (needs_fix)  PIC 1 files it again next month as a RE-REQUEST
//                                (lib/petty-cash-re-request.ts) with what Finance asked for
//   Ditolak (rejected)           final — it can NOT be re-requested
//
//   null ──Perlu Perbaikan──▶ needs_fix ──Ditolak──▶ rejected
//    └────────────Ditolak───────────────────────────▶
//   (accept takes either decision back → accepted; a Perlu Perbaikan that already has a re-request can't be touched)
//
// A request Finance has not accepted (needs_fix or rejected) is not counted as used: the transfer is
// what the store used minus those requests, while the store's petty cash still goes back to Rp 1.000.000
// when PIC 1 confirms receipt. The part the transfer does not cover is paid by the employee themselves,
// outside the system. Once Finance has verified the refill the amount is locked and Finance can no
// longer decide on it — but a Perlu Perbaikan request stays re-requestable (in the next period).

export type FinanceReview = 'needs_fix' | 'rejected' | 'accepted';

export const FINANCE_COMMENT_MAX = 300;

export const FINANCE_REVIEW_LABEL: Record<FinanceReview, string> = {
  needs_fix: 'Perlu Perbaikan',
  rejected: 'Ditolak',
  accepted: 'Diterima',
};

export const isFinanceReview = (v: unknown): v is FinanceReview =>
  v === 'needs_fix' || v === 'rejected' || v === 'accepted';

/** The reviews that take a request out of "used" — the same list the SQL filters use. */
export const LEFT_OUT_REVIEWS = ['needs_fix', 'rejected'] as const;

/**
 * A request is locked once the refill that settles its period has been verified: its amount is part of cash
 * already sent, so Finance can no longer decide on it. Requests are tied to their PERIOD (not to the day they
 * were filed), so one filed while the refill was on its way — it belongs to the next period — stays open to
 * Finance's decision.
 * `verifiedThrough` = the latest period (YYYY-MM) of the store whose refill Finance has verified
 * (see getVerifiedThrough); `requestMonth` is the request's own period.
 */
export function isLockedByVerification(
  requestMonth: string,
  verifiedThrough: string | null | undefined,
): boolean {
  return verifiedThrough != null && requestMonth <= verifiedThrough;
}

/** A request in this state does not count towards the refill transfer. */
export const leavesOutOfTransfer = (review: string | null | undefined): boolean =>
  review === 'needs_fix' || review === 'rejected';

/** What the employee and Finance see about a request, from Finance's review. */
export type ReviewOutcome = 'none' | FinanceReview;

export function reviewOutcome(review: string | null | undefined): ReviewOutcome {
  return isFinanceReview(review) ? review : 'none';
}

/** Only a Perlu Perbaikan request can be filed again; a Ditolak one is final. */
export const canReRequest = (review: string | null | undefined): boolean => review === 'needs_fix';

/** Frozen figures on a verified refill, or the live ones. */
export interface RefillTransfer {
  /** max − balance: what the store used, rejected requests NOT included (their amount went back to the balance). */
  refill: number;
  rejectedCount: number;
  rejectedAmount: number;
  /** What Finance sends: the refill. */
  transfer: number;
  /** True once Finance has verified the refill — the figures no longer move. */
  frozen: boolean;
}

/** The Indonesian line PIC 1 gets with the refill (and Finance sees on the request). */
export function rejectedNote(count: number, amount: number): string | null {
  if (count <= 0) return null;
  return `${count} request Perlu Perbaikan / Ditolak (Rp ${amount.toLocaleString('id-ID')}) tidak dihitung sebagai terpakai dan tidak ikut ditransfer — nominal itu dibayar sendiri oleh karyawan di luar sistem`;
}

/** Trimmed optional comment, or an error message. */
export function validateFinanceComment(raw: unknown): { ok: true; comment: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, comment: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Komentar tidak valid.' };
  const comment = raw.trim();
  if (comment.length > FINANCE_COMMENT_MAX) {
    return { ok: false, error: `Komentar maksimal ${FINANCE_COMMENT_MAX} karakter.` };
  }
  return { ok: true, comment: comment || null };
}

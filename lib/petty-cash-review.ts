// lib/petty-cash-review.ts
//
// Finance's review of a completed petty cash request (client-safe, no DB imports) — shared by the
// Finance Petty Cash Monitoring page, the employee Petty Cash page and their APIs.
//
// Finance opens a store's request on /finance/petty-cash and may REJECT it, with or without a comment,
// until it verifies the refill that covers it:
//
//   null ──reject──▶ rejected ──PIC 1 corrects──▶ resubmitted ──Finance accepts──▶ accepted
//                       ▲                             │
//                       └────── Finance rejects again ┘          (accept also undoes a rejection)
//
// A rejected (or not-yet-reviewed resubmitted) request is left out of the refill transfer: the transfer
// is what the store used minus those requests, while the store's petty cash still goes back to
// Rp 1.000.000 when PIC 1 confirms receipt. Once Finance has verified the refill the amount is locked
// and any rejection still standing is PERMANENT: PIC 1 keeps seeing the reason, can no longer correct
// it, and files a new request next month.

export type FinanceReview = 'rejected' | 'resubmitted' | 'accepted';

export const FINANCE_COMMENT_MAX = 300;

export const FINANCE_REVIEW_LABEL: Record<FinanceReview, string> = {
  rejected: 'Ditolak Finance',
  resubmitted: 'Perbaikan dikirim',
  accepted: 'Perbaikan diterima',
};

export const isFinanceReview = (v: unknown): v is FinanceReview =>
  v === 'rejected' || v === 'resubmitted' || v === 'accepted';

/**
 * A request is locked once the store's refill has been verified after it was filed: its amount is part
 * of cash already sent, so Finance can no longer reject it and a standing rejection is permanent.
 * `verifiedCutoff` = when Finance last verified one of the store's refills.
 */
export function isLockedByVerification(
  createdAt: Date | string,
  verifiedCutoff: Date | string | null | undefined,
): boolean {
  return verifiedCutoff != null && new Date(createdAt).getTime() <= new Date(verifiedCutoff).getTime();
}

/** A request in this state does not count towards the refill transfer. */
export const leavesOutOfTransfer = (review: string | null | undefined): boolean =>
  review === 'rejected' || review === 'resubmitted';

/** What the employee can do about a request, from Finance's review and whether the refill is verified. */
export type ReviewOutcome =
  | 'none'
  /** Rejected, PIC 1 may still correct it. */
  | 'rejected'
  /** Corrected, waiting for Finance. */
  | 'resubmitted'
  /** Finance accepted the correction. */
  | 'accepted'
  /** Rejected (or never re-accepted) and the refill is verified — final. */
  | 'permanent';

export function reviewOutcome(review: string | null | undefined, locked: boolean): ReviewOutcome {
  if (!isFinanceReview(review)) return 'none';
  if (review === 'accepted') return 'accepted';
  return locked ? 'permanent' : review;
}

/** The cash to send: what the store used (max − balance) minus the requests Finance rejected. */
export const refillTransfer = (refill: number, rejectedAmount: number): number =>
  Math.max(0, refill - rejectedAmount);

/** Frozen figures on a verified refill, or the live ones. */
export interface RefillTransfer {
  /** max − balance: what the store used. */
  refill: number;
  rejectedCount: number;
  rejectedAmount: number;
  /** refill − rejectedAmount: what Finance sends. */
  transfer: number;
  /** True once Finance has verified the refill — the figures no longer move. */
  frozen: boolean;
}

/** The Indonesian line PIC 1 gets with the refill (and Finance sees on the request). */
export function rejectedNote(count: number, amount: number): string | null {
  if (count <= 0) return null;
  return `${count} request ditolak Finance (Rp ${amount.toLocaleString('id-ID')}) tidak ikut ditransfer`;
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

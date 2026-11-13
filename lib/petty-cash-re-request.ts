// lib/petty-cash-re-request.ts
//
// Re-request (client-safe, no DB imports) — shared by the employee Petty Cash page, its API and the
// Finance / Ops views that mark one.
//
// When Finance sends a completed request back with "Perlu Perbaikan", the SAME request goes back to PIC 1 as a
// draft (no new request is made). PIC 1 fixes it (category, Keterangan, what was spent, receipt photo) and sends it
// to OPS again; it is marked "Re-request" (`is_re_request`) so OPS knows it was fixed after Perlu Perbaikan. Once
// OPS approves it, it is completed and back on Finance's list (Pending Finance), with the normal choices again.
// It is counted in its own period while that period still runs and no refill was asked for it, else in the next
// one (lib/db/utils/petty-cash-review.ts). A request Finance turned down with "Ditolak" is final.
//
// Rows filed before 2026-11-13 as a separate new request (`re_request_of_id` → the original) keep showing as they
// were.

import { isDayKey } from '@/lib/day-bucket';

export const RE_REQUEST_LABEL = 'Re-request';

/** The pieces of a request that mark it as a re-request, as the Finance / Ops rows carry them. */
export interface ReRequestInfo {
  isReRequest: boolean;
  /** Older re-requests only: the date PIC 1 gave as the day the request was made (YYYY-MM-DD, Jakarta). */
  requestDate: string | null;
}

/** "2026-10-05" → "5 Okt 2026" (a calendar day, no timezone shifting). */
export function fmtRequestDate(ymd: string): string {
  if (!isDayKey(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

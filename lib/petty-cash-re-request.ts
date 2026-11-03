// lib/petty-cash-re-request.ts
//
// Re-request (client-safe, no DB imports) — shared by the employee Petty Cash page, its API and the
// Finance / Ops views that mark one.
//
// Finance checks petty cash once a month, so a request it sends back with "Perlu Perbaikan" is not fixed on
// the spot: PIC 1 files it again in the next period as a RE-REQUEST. It is picked from the store's Perlu
// Perbaikan requests, carries the date the request was originally made (typed in) and is stamped with the day
// it was filed (automatic). Ops already approved the original, so a re-request skips Ops — it goes straight to
// `completed` (only the usage is recorded) and lands on Finance's list, marked "Re-request". A request Finance
// turned down with "Ditolak" is final and can NOT be re-requested.

import { isDayKey } from '@/lib/day-bucket';

export const RE_REQUEST_LABEL = 'Re-request';

/** A Perlu Perbaikan request PIC 1 may file again (what the Re-request sheet starts from). */
export interface ReRequestable {
  id: number;
  categoryName: string | null;
  description: string;
  /** What was spent on it, Rupiah. */
  amount: number;
  imageUrl: string | null;
  /** When the original was filed (ISO instant). */
  createdAt: string;
  /** The petty cash period it was filed in (YYYY-MM). */
  month: string;
  /** Finance's comment on the decision, if it left one. */
  financeComment: string | null;
  /** The Jakarta day it was filed on (YYYY-MM-DD) — the starting value of the date field. */
  filedOn: string;
  /** The request is itself a re-request (Finance sent it back again). */
  isReRequest: boolean;
}

/** The "tanggal request" PIC 1 types in: a real YYYY-MM-DD, not in the future (`today` is the Jakarta day). */
export function validateRequestDate(
  raw: unknown,
  today: string,
): { ok: true; date: string } | { ok: false; error: string } {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, error: 'Tanggal request wajib diisi.' };
  if (!isDayKey(value)) return { ok: false, error: 'Tanggal request tidak valid.' };
  if (value > today) return { ok: false, error: 'Tanggal request tidak boleh di masa depan.' };
  return { ok: true, date: value };
}

/** The pieces of a request that mark it as a re-request, as the Finance / Ops rows carry them. */
export interface ReRequestInfo {
  isReRequest: boolean;
  /** The date PIC 1 gave as the day the request was made (YYYY-MM-DD, Jakarta); null on a normal request. */
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

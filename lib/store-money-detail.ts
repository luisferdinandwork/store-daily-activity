// lib/store-money-detail.ts
// What Finance sees when it opens a row of "Daily Report All Store": one store on one sales day —
// the Setoran filed the morning after (who, the cash figures, the proof photos) and the Store
// Closing of the sales day (who, every bank × method, the Z-Report and Indodana photos).
// Client-safe, no DB imports; the data comes from lib/db/utils/store-day-detail.ts.
//
// Only what Finance needs to check a day: the closing's other fields (checklist ticks, the
// storefront-locked photo, …) are deliberately left out.

import type { EdcBankCode } from '@/lib/store-closing-edc';

export interface DetailPerson {
  name: string;
  nik: string | null;
}

/** A proof photo; `url` is what the store uploaded (a storage URL, used as the image source as-is). */
export interface DetailPhoto {
  key: string;
  label: string;
  url: string;
  /** ISO instant the photo was added. */
  at: string | null;
}

export interface DaySetoranDetail {
  /** YYYY-MM-DD — the day it was filed (sales day + 1). */
  date: string;
  submittedBy: DetailPerson | null;
  /** ISO instant. */
  submittedAt: string | null;

  /** Uang diterima — shown as Sales Cash. */
  received: number;
  /** Sisa kemarin. */
  carryIn: number;
  /** Wajib disetor — shown as Harus Disetor. */
  required: number;
  /** Disetor — shown as Setoran Tunai. */
  stored: number;
  /** Sisa — shown as Tidak Disetor; carried to the next setoran. */
  unpaid: number;
  isNoSetoran: boolean;

  notes: string | null;
  verifiedBy: DetailPerson | null;
  verifiedAt: string | null;
  /** The latest IT change to the day's figures (Koreksi Setoran). */
  correction: { by: string; reason: string; at: string; kind: 'correct' | 'create' } | null;

  photos: DetailPhoto[];
}

/** posted = submitted with the statement posted · on_hold = submitted On Hold · draft = not submitted yet. */
export type ClosingState = 'posted' | 'on_hold' | 'draft';

export const CLOSING_STATE_LABEL: Record<ClosingState, string> = {
  posted: 'Statement posted',
  on_hold: 'On Hold',
  draft: 'Belum disubmit',
};

export interface DayClosingDetail {
  state: ClosingState;
  holdReason: string | null;
  /** Who submitted it (or, for a draft, who filled it in last). */
  submittedBy: DetailPerson | null;
  /** ISO instant. */
  submittedAt: string | null;

  /** Per bank, all methods added up; null = the bank was left blank. */
  banks: Record<EdcBankCode, number | null>;
  /** null = not filled in. */
  opMeVoucher: number | null;

  /** Foto Z-Report & EDC Settlement. */
  zReportPhoto: DetailPhoto | null;
  /** Dashboard Indodana (optional for the store). */
  indodanaPhoto: DetailPhoto | null;
}

export interface StoreDayDetail {
  storeNo: string;
  storeName: string;
  areaName: string;
  /** YYYY-MM-DD */
  salesDate: string;
  setoranDate: string;
  /** Null = no setoran was submitted for the morning after. */
  setoran: DaySetoranDetail | null;
  /** Null = the store has no Store Closing for the sales day. */
  closing: DayClosingDetail | null;
}

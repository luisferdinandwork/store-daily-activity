// lib/cash-count-sessions.ts
// The five moments of the day the cashier cash is counted, per the SOP
// "Alur Penghitungan Uang Sepanjang Hari" (client-safe — no DB imports).
// Must stay in sync with cashCountSessionEnum in lib/db/schema/enums.ts.

import { isClosingShift, isOpeningShift } from '@/lib/shift-tasks';

export const CASH_COUNT_SESSIONS = ['pagi', 'siang_1', 'siang_2', 'sore', 'malam'] as const;

export type CashCountSession = typeof CASH_COUNT_SESSIONS[number];

export interface CashCountSessionInfo {
  step: number;
  label: string;
  /** When in the day this count happens. */
  moment: string;
  /** Who counts, per the SOP. */
  counter: string;
  /** What gets counted. */
  items: string[];
  /** The SOP's "Tujuan". */
  purpose: string;
}

const HANDOVER_ITEMS = ['Uang omset', 'Uang modal', 'Uang petty cash', 'Uang sisa setoran'];

export const CASH_COUNT_SESSION_INFO: Record<CashCountSession, CashCountSessionInfo> = {
  pagi: {
    step: 1,
    label: 'Pagi',
    moment: 'Shift pagi datang',
    counter: 'Shift pagi',
    items: ['Uang modal', 'Uang omset', 'Uang setoran', 'Uang petty cash'],
    purpose: 'Memastikan seluruh dana dalam kondisi sesuai sebelum operasional dimulai.',
  },
  siang_1: {
    step: 2,
    label: 'Siang (1)',
    moment: 'Pergantian shift',
    counter: 'Staff siang',
    items: HANDOVER_ITEMS,
    purpose: 'Serah terima dana dari shift pagi ke shift siang dengan kondisi sudah dipastikan sesuai.',
  },
  siang_2: {
    step: 3,
    label: 'Siang (2)',
    moment: 'Istirahat',
    counter: 'Staff pagi',
    items: HANDOVER_ITEMS,
    purpose: 'Kontrol ulang dana oleh shift pagi setelah operasional berjalan dan sebelum shift siang istirahat.',
  },
  sore: {
    step: 4,
    label: 'Sore',
    moment: 'Shift pagi pulang',
    counter: 'Staff siang',
    items: HANDOVER_ITEMS,
    purpose: 'Serah terima dana dari shift pagi kepada shift siang untuk operasional sore hingga closing.',
  },
  malam: {
    step: 5,
    label: 'Malam',
    moment: 'Closing',
    counter: 'Shift closing',
    items: ['Uang modal', 'Uang omset', 'Uang setoran', 'Uang petty cash', 'Pisahkan uang cash untuk setoran'],
    purpose: 'Memastikan semua dana akurat, memisahkan uang setoran, dan siap disetor ke bank.',
  },
};

/**
 * All five sessions are mandatory every day. They're enforced at checkout,
 * following the SOP timeline: an opening shift (morning, JKP Pagi) leaves at
 * Sore ("shift pagi pulang"), so sessions 1–4 must be on record; a closing
 * shift (evening, JKP Siang, full day) leaves after Malam, so all five must
 * be. Someone always closes, so every store/day ends with all five counts.
 * Other shifts (middle) aren't part of the cash SOP and aren't gated.
 */
export function requiredCashCountSessionsForShift(shiftCode: string): CashCountSession[] {
  if (isClosingShift(shiftCode)) return [...CASH_COUNT_SESSIONS];
  if (isOpeningShift(shiftCode)) return CASH_COUNT_SESSIONS.filter((s) => s !== 'malam');
  return [];
}

/** Required sessions (for this shift's checkout) not counted yet. */
export function missingCashCountSessionsForShift(
  shiftCode: string,
  counted: Iterable<CashCountSession>,
): CashCountSession[] {
  const done = new Set(counted);
  return requiredCashCountSessionsForShift(shiftCode).filter((s) => !done.has(s));
}

/** "Pagi, Siang (1)" */
export function cashCountSessionLabels(sessions: CashCountSession[]): string {
  return sessions.map((s) => CASH_COUNT_SESSION_INFO[s].label).join(', ');
}

export function isCashCountSession(value: unknown): value is CashCountSession {
  return typeof value === 'string' && (CASH_COUNT_SESSIONS as readonly string[]).includes(value);
}

/** "Sesi 2 · Siang (1)" */
export function cashCountSessionTitle(session: CashCountSession): string {
  const info = CASH_COUNT_SESSION_INFO[session];
  return `Sesi ${info.step} · ${info.label}`;
}

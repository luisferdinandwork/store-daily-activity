// lib/petty-cash-bank.ts
// Bank details PIC 1 must give when requesting a petty cash refill — where
// Finance transfers the cash. Client-safe (no DB imports): the employee form
// and the refill-request API validate with the same rules.

export const PETTY_CASH_BANKS = [
  'BCA',
  'Mandiri',
  'BNI',
  'BRI',
  'BSI',
  'CIMB Niaga',
  'Permata',
  'Danamon',
  'BTN',
  'OCBC',
  'Bank Jago',
  'SeaBank',
  'Jenius (BTPN)',
] as const;

/** Sentinel select value that reveals the free-text bank field. */
export const PETTY_CASH_BANK_OTHER = '__other__';

export const PETTY_CASH_BANK_NAME_MAX = 40;
export const PETTY_CASH_ACCOUNT_NUMBER_MIN = 5;
export const PETTY_CASH_ACCOUNT_NUMBER_MAX = 20;
export const PETTY_CASH_ACCOUNT_HOLDER_MAX = 80;

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
}

export type BankDetailsResult =
  | { ok: true; value: BankDetails }
  | { ok: false; error: string };

/**
 * Trims and validates raw form input. The account number keeps digits only
 * (people paste "123-456 789"); the holder name is upper-cased the way it
 * appears on a bank book, so the Finance sheet reads consistently.
 */
export function normalizeBankDetails(input: {
  bankName?: unknown;
  accountNumber?: unknown;
  accountHolderName?: unknown;
}): BankDetailsResult {
  const typedBank = typeof input.bankName === 'string' ? input.bankName.trim().replace(/\s+/g, ' ') : '';
  // "bca" typed under "Bank lainnya" → the canonical "BCA", so the Finance
  // sheet doesn't end up with three spellings of one bank.
  const bankName =
    PETTY_CASH_BANKS.find((b) => b.toLowerCase() === typedBank.toLowerCase()) ?? typedBank;
  const accountNumber =
    typeof input.accountNumber === 'string' ? input.accountNumber.replace(/[\s.-]/g, '') : '';
  const accountHolderName =
    typeof input.accountHolderName === 'string'
      ? input.accountHolderName.trim().replace(/\s+/g, ' ').toUpperCase()
      : '';

  if (!bankName) return { ok: false, error: 'Pilih atau isi nama bank.' };
  if (bankName.length > PETTY_CASH_BANK_NAME_MAX) {
    return { ok: false, error: `Nama bank maksimal ${PETTY_CASH_BANK_NAME_MAX} karakter.` };
  }

  if (!accountNumber) return { ok: false, error: 'Nomor rekening wajib diisi.' };
  if (!/^\d+$/.test(accountNumber)) {
    return { ok: false, error: 'Nomor rekening hanya boleh berisi angka.' };
  }
  if (
    accountNumber.length < PETTY_CASH_ACCOUNT_NUMBER_MIN ||
    accountNumber.length > PETTY_CASH_ACCOUNT_NUMBER_MAX
  ) {
    return {
      ok: false,
      error: `Nomor rekening harus ${PETTY_CASH_ACCOUNT_NUMBER_MIN}–${PETTY_CASH_ACCOUNT_NUMBER_MAX} digit.`,
    };
  }

  if (!accountHolderName) return { ok: false, error: 'Nama pemilik rekening wajib diisi.' };
  if (accountHolderName.length > PETTY_CASH_ACCOUNT_HOLDER_MAX) {
    return { ok: false, error: `Nama pemilik rekening maksimal ${PETTY_CASH_ACCOUNT_HOLDER_MAX} karakter.` };
  }

  return { ok: true, value: { bankName, accountNumber, accountHolderName } };
}

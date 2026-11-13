// lib/petty-cash-categories.ts
// Petty cash request categories — shared rules + the starting set (client-safe,
// no DB imports). The live list is the petty_cash_categories table, managed by
// IT at /it/petty-cash-categories; this starter set is what migration
// 0041 inserts and the seed re-applies (idempotently, by name).
//
// A category has NO preset Keterangan: the PIC always writes their own. What a
// category has is a Pengertian (definition) and Contoh Pengeluaran (examples),
// shown in the "!" help sheet on the employee Petty Cash page.

/**
 * Max length of a request's Keterangan — 50 since 2026-11-13 (was 100, before that 300), by request, so it fits the
 * Purchase Invoice export's Description as it is. Older, longer rows stay as they are; PIC 1 shortens one only when
 * fixing it after Perlu Perbaikan.
 */
export const PETTY_CASH_REASON_MAX = 50;

/**
 * A request's Keterangan is always shown (and stored) in capitals — the same on
 * the employee app, Ops and Finance. Apply it when typing, on save, and when
 * reading rows written before this rule.
 */
export const pettyCashDescription = (text: string | null | undefined): string =>
  (text ?? '').toLocaleUpperCase('id-ID');

/** Max length of a category name. */
export const PETTY_CASH_CATEGORY_NAME_MAX = 50;

/** Max length of a category's Pengertian / Contoh Pengeluaran. */
export const PETTY_CASH_CATEGORY_TEXT_MAX = 1000;

/** Max length of a category's IS (Business Central item no., e.g. IS000022). */
export const PETTY_CASH_IS_CODE_MAX = 20;

/**
 * A category's IS as stored: trimmed, upper-case, no spaces; '' → null. Back office only — IT sets it, Finance
 * sees it (petty cash lists + the Purchase Invoice export's "No." column); the employee app never gets it.
 */
export const normalizeIsCode = (raw: string | null | undefined): string | null =>
  (raw ?? '').replace(/\s+/g, '').toUpperCase() || null;

/** Letters, digits, '-', '_' and '.' only — what a BC item no. can hold. */
export const isValidIsCode = (code: string): boolean =>
  code.length <= PETTY_CASH_IS_CODE_MAX && /^[A-Z0-9._-]+$/.test(code);

export interface PettyCashCategoryDefault {
  name: string;
  definition: string;
  examples: string;
  /** IS — Business Central item no. (Finance's sheet, column "IS"). */
  isCode: string;
  sortOrder: number;
  /** Default true. */
  isActive?: boolean;
}

/** The categories from Finance's "Kategori Pengeluaran Store" sheet. */
export const DEFAULT_PETTY_CASH_CATEGORIES: PettyCashCategoryDefault[] = [
  {
    name: 'STATIONERY & OFFICE SUPPLIES',
    definition: 'Alat tulis dan perlengkapan administrasi kantor.',
    examples:
      'Pulpen, pensil, spidol, kertas HVS, sticky notes, buku tulis, map, folder, ordner, amplop, stapler, isi staples, paper clip, tinta printer, toner, correction tape, gunting, cutter, lakban, lem, label sticker, kalkulator, print surat jalan',
    isCode: 'IS000022',
    sortOrder: 10,
  },
  {
    name: 'POSTAGE / TELEGRAMS',
    definition: 'Biaya pengiriman surat, dokumen, dan paket.',
    examples:
      'Pengiriman dokumen melalui JNE/J&T/SiCepat, surat resmi, biaya kurir/ekspedisi, perangko, dan pengiriman paket kantor.',
    isCode: 'IS000057',
    sortOrder: 20,
  },
  {
    name: 'TELEPHONE / FAX / TELEX',
    definition: 'Biaya telepon dan layanan komunikasi kantor.',
    examples:
      'Tagihan telepon kantor, pulsa/nomor telepon kantor, biaya layanan fax, biaya telex (jika digunakan), dan layanan komunikasi kantor lainnya. Paket internet dicatat di sini hanya jika sesuai kebijakan akun perusahaan.',
    isCode: 'IS000011',
    sortOrder: 30,
  },
  {
    name: 'HOUSEKEEPING EXPS / SUPPLIES',
    definition: 'Biaya kebersihan dan perlengkapan cleaning kantor.',
    examples:
      'Sabun cuci tangan, tisu toilet/ruangan, cairan pembersih lantai, pembersih kaca, pewangi ruangan, sapu, pel, pengki, spons, lap, kantong sampah, disinfektan, sarung tangan cleaning, dan pengharum toilet, air galon',
    isCode: 'IS000012',
    sortOrder: 40,
  },
  {
    name: 'PRINTING',
    definition: 'Biaya promosi toko yang diadakan oleh marketing',
    examples: 'Cetak POP, sale tag dll',
    isCode: 'IS000005',
    sortOrder: 50,
  },
  // New in Finance's sheet (2026-11-13). Added hidden: IT shows it to PIC 1 with the eye button when Finance is ready.
  {
    name: 'REPAIR & MAINTENANCE',
    definition: 'Biaya yang dikeluarkan untuk service / maintenance operasional di toko',
    examples: 'AC, Lampu',
    isCode: 'IS000026',
    sortOrder: 60,
    isActive: false,
  },
];

/** Shown under the category list: the final grouping is Finance's call. */
export const PETTY_CASH_CATEGORY_NOTE =
  'Pengelompokan akhir mengikuti kebijakan Chart of Accounts (COA) dan ketentuan Finance perusahaan.';

/** What the employee request form needs to know about a category. */
export interface PettyCashCategoryOption {
  id: number;
  name: string;
  /** Pengertian. */
  definition: string | null;
  /** Contoh Pengeluaran. */
  examples: string | null;
}

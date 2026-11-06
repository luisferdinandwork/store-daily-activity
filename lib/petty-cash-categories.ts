// lib/petty-cash-categories.ts
// Petty cash request categories — shared rules + the starting set (client-safe,
// no DB imports). The live list is the petty_cash_categories table, managed by
// IT at /it/petty-cash-categories; this starter set is what migration
// 0041 inserts and the seed re-applies (idempotently, by name).
//
// A category has NO preset Keterangan: the PIC always writes their own. What a
// category has is a Pengertian (definition) and Contoh Pengeluaran (examples),
// shown in the "!" help sheet on the employee Petty Cash page.

/** Max length of a request's Keterangan (changed from 300, 2026-11-02, by request). */
export const PETTY_CASH_REASON_MAX = 100;

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

export interface PettyCashCategoryDefault {
  name: string;
  definition: string;
  examples: string;
  sortOrder: number;
}

/** The main categories, from Finance's "Kategori Pengeluaran Store" sheet. */
export const DEFAULT_PETTY_CASH_CATEGORIES: PettyCashCategoryDefault[] = [
  {
    name: 'STATIONERY & OFFICE SUPPLIES',
    definition: 'Alat tulis dan perlengkapan administrasi kantor.',
    examples:
      'Pulpen, pensil, spidol, kertas HVS, sticky notes, buku tulis, map, folder, ordner, amplop, stapler, isi staples, paper clip, tinta printer, toner, correction tape, gunting, cutter, lakban, lem, label sticker, kalkulator, print surat jalan',
    sortOrder: 10,
  },
  {
    name: 'POSTAGE / TELEGRAMS',
    definition: 'Biaya pengiriman surat, dokumen, dan paket.',
    examples:
      'Pengiriman dokumen melalui JNE/J&T/SiCepat, surat resmi, biaya kurir/ekspedisi, perangko, dan pengiriman paket kantor.',
    sortOrder: 20,
  },
  {
    name: 'TELEPHONE / FAX / TELEX',
    definition: 'Biaya telepon dan layanan komunikasi kantor.',
    examples:
      'Tagihan telepon kantor, pulsa/nomor telepon kantor, biaya layanan fax, biaya telex (jika digunakan), dan layanan komunikasi kantor lainnya. Paket internet dicatat di sini hanya jika sesuai kebijakan akun perusahaan.',
    sortOrder: 30,
  },
  {
    name: 'HOUSEKEEPING EXPS / SUPPLIES',
    definition: 'Biaya kebersihan dan perlengkapan cleaning kantor.',
    examples:
      'Sabun cuci tangan, tisu toilet/ruangan, cairan pembersih lantai, pembersih kaca, pewangi ruangan, sapu, pel, pengki, spons, lap, kantong sampah, disinfektan, sarung tangan cleaning, dan pengharum toilet, air galon',
    sortOrder: 40,
  },
  {
    name: 'PRINTING',
    definition: 'Biaya promosi toko yang diadakan oleh marketing',
    examples: 'Cetak POP, sale tag dll',
    sortOrder: 50,
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

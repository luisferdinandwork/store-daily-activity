// lib/petty-cash-categories.ts
// Petty cash request categories — shared rules + the starting set (client-safe,
// no DB imports). The live list is the petty_cash_categories table, managed by
// IT at /it/petty-cash-categories; this starter set is what migration
// 0015 inserts and the seed re-applies (idempotently, by name).

/** Max length of a request's Keterangan / a category's default reason. */
export const PETTY_CASH_REASON_MAX = 300;

/** Max length of a category name. */
export const PETTY_CASH_CATEGORY_NAME_MAX = 50;

export interface PettyCashCategoryDefault {
  name: string;
  defaultReason: string | null;
  requiresCustomReason: boolean;
  sortOrder: number;
}

export const DEFAULT_PETTY_CASH_CATEGORIES: PettyCashCategoryDefault[] = [
  {
    name: 'Galon',
    defaultReason:
      'Pembelian isi ulang air galon untuk kebutuhan air minum karyawan selama jam operasional toko.',
    requiresCustomReason: false,
    sortOrder: 10,
  },
  {
    name: 'Pulsa Internet',
    defaultReason:
      'Pembelian pulsa / paket data internet untuk operasional toko, seperti koneksi aplikasi, komunikasi, dan pengiriman laporan harian.',
    requiresCustomReason: false,
    sortOrder: 20,
  },
  {
    name: 'Dokumen',
    defaultReason:
      'Biaya keperluan dokumen operasional toko, seperti fotokopi, cetak, atau pengiriman dokumen.',
    requiresCustomReason: false,
    sortOrder: 30,
  },
  {
    name: 'POV',
    defaultReason: 'Pembelian kebutuhan POV untuk mendukung operasional toko.',
    requiresCustomReason: false,
    sortOrder: 40,
  },
  {
    name: 'Alat Kebersihan Toko',
    defaultReason:
      'Pembelian perlengkapan kebersihan toko (sabun lantai, pembersih kaca, kain lap, kantong sampah, dll.) agar area toko tetap bersih dan nyaman.',
    requiresCustomReason: false,
    sortOrder: 50,
  },
  {
    name: 'ATK',
    defaultReason:
      'Pembelian alat tulis kantor untuk operasional toko, seperti kertas, pulpen, lakban, dan label harga.',
    requiresCustomReason: false,
    sortOrder: 60,
  },
  {
    // No default — the PIC must explain what the request is for.
    name: 'Lain-Lain',
    defaultReason: null,
    requiresCustomReason: true,
    sortOrder: 70,
  },
];

/** What the employee request form needs to know about a category. */
export interface PettyCashCategoryOption {
  id: number;
  name: string;
  defaultReason: string | null;
  requiresCustomReason: boolean;
}

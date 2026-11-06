ALTER TABLE "petty_cash_categories" ADD COLUMN "definition" text;--> statement-breakpoint
ALTER TABLE "petty_cash_categories" ADD COLUMN "examples" text;--> statement-breakpoint

-- Main categories from Finance's "Kategori Pengeluaran Store" sheet
-- (lib/petty-cash-categories.ts). No preset Keterangan any more — the PIC always
-- writes their own; definition + examples feed the "!" help sheet.
INSERT INTO "petty_cash_categories" ("name", "definition", "examples", "sort_order")
VALUES
  ('STATIONERY & OFFICE SUPPLIES', 'Alat tulis dan perlengkapan administrasi kantor.', 'Pulpen, pensil, spidol, kertas HVS, sticky notes, buku tulis, map, folder, ordner, amplop, stapler, isi staples, paper clip, tinta printer, toner, correction tape, gunting, cutter, lakban, lem, label sticker, kalkulator, print surat jalan', 10),
  ('POSTAGE / TELEGRAMS', 'Biaya pengiriman surat, dokumen, dan paket.', 'Pengiriman dokumen melalui JNE/J&T/SiCepat, surat resmi, biaya kurir/ekspedisi, perangko, dan pengiriman paket kantor.', 20),
  ('TELEPHONE / FAX / TELEX', 'Biaya telepon dan layanan komunikasi kantor.', 'Tagihan telepon kantor, pulsa/nomor telepon kantor, biaya layanan fax, biaya telex (jika digunakan), dan layanan komunikasi kantor lainnya. Paket internet dicatat di sini hanya jika sesuai kebijakan akun perusahaan.', 30),
  ('HOUSEKEEPING EXPS / SUPPLIES', 'Biaya kebersihan dan perlengkapan cleaning kantor.', 'Sabun cuci tangan, tisu toilet/ruangan, cairan pembersih lantai, pembersih kaca, pewangi ruangan, sapu, pel, pengki, spons, lap, kantong sampah, disinfektan, sarung tangan cleaning, dan pengharum toilet, air galon', 40),
  ('PRINTING', 'Biaya promosi toko yang diadakan oleh marketing', 'Cetak POP, sale tag dll', 50)
ON CONFLICT ("name") DO UPDATE SET
  "definition" = EXCLUDED."definition",
  "examples" = EXCLUDED."examples",
  "sort_order" = EXCLUDED."sort_order",
  "default_reason" = NULL,
  "requires_custom_reason" = false,
  "is_active" = true,
  "updated_at" = now();--> statement-breakpoint

-- The earlier starter set (Galon, ATK, …, Lain-Lain) is hidden, not deleted:
-- past requests keep their category name and IT still sees its usage count.
UPDATE "petty_cash_categories"
SET "is_active" = false, "default_reason" = NULL, "requires_custom_reason" = false, "updated_at" = now()
WHERE "name" NOT IN ('STATIONERY & OFFICE SUPPLIES', 'POSTAGE / TELEGRAMS', 'TELEPHONE / FAX / TELEX', 'HOUSEKEEPING EXPS / SUPPLIES', 'PRINTING');

ALTER TABLE "petty_cash_transactions" ADD COLUMN "is_re_request" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "re_request_of_id" integer;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "request_date" timestamp;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_re_request_of_id_petty_cash_transactions_id_fk" FOREIGN KEY ("re_request_of_id") REFERENCES "public"."petty_cash_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pct_re_request_of_unique" ON "petty_cash_transactions" USING btree ("re_request_of_id") WHERE "petty_cash_transactions"."re_request_of_id" IS NOT NULL;--> statement-breakpoint
-- "Rejected" (PIC 1 may fix it) is now "Perlu Perbaikan" (needs_fix); "rejected" now means the final Ditolak.
-- A request rejected under the old rule keeps behaving exactly as before: still fixable until the refill is
-- verified, and Ditolak once it is (reviewOutcome in lib/petty-cash-review.ts).
UPDATE "petty_cash_transactions" SET "finance_review" = 'needs_fix' WHERE "finance_review" = 'rejected';--> statement-breakpoint
-- Keterangan is now at most 100 characters: shorten the starter categories' default reasons that were longer
-- (only where IT has not already edited them).
UPDATE "petty_cash_categories" SET "default_reason" = 'Pembelian isi ulang air galon untuk kebutuhan air minum karyawan toko.' WHERE "name" = 'Galon' AND "default_reason" = 'Pembelian isi ulang air galon untuk kebutuhan air minum karyawan selama jam operasional toko.';--> statement-breakpoint
UPDATE "petty_cash_categories" SET "default_reason" = 'Pembelian pulsa / paket data internet untuk operasional toko.' WHERE "name" = 'Pulsa Internet' AND "default_reason" = 'Pembelian pulsa / paket data internet untuk operasional toko, seperti koneksi aplikasi, komunikasi, dan pengiriman laporan harian.';--> statement-breakpoint
UPDATE "petty_cash_categories" SET "default_reason" = 'Biaya keperluan dokumen operasional toko (fotokopi, cetak, pengiriman).' WHERE "name" = 'Dokumen' AND "default_reason" = 'Biaya keperluan dokumen operasional toko, seperti fotokopi, cetak, atau pengiriman dokumen.';--> statement-breakpoint
UPDATE "petty_cash_categories" SET "default_reason" = 'Pembelian perlengkapan kebersihan toko (sabun lantai, pembersih kaca, kain lap, kantong sampah).' WHERE "name" = 'Alat Kebersihan Toko' AND "default_reason" = 'Pembelian perlengkapan kebersihan toko (sabun lantai, pembersih kaca, kain lap, kantong sampah, dll.) agar area toko tetap bersih dan nyaman.';--> statement-breakpoint
UPDATE "petty_cash_categories" SET "default_reason" = 'Pembelian alat tulis kantor untuk operasional toko (kertas, pulpen, lakban, label harga).' WHERE "name" = 'ATK' AND "default_reason" = 'Pembelian alat tulis kantor untuk operasional toko, seperti kertas, pulpen, lakban, dan label harga.';

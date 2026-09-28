-- Petty cash request categories (Galon, ATK, …, Lain-Lain), CMS'd by OPS HO / IT.
-- Requests keep category_id + a category_name snapshot; old requests stay NULL.
CREATE TABLE "petty_cash_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_reason" text,
	"requires_custom_reason" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "petty_cash_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "category_name" text;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_category_id_petty_cash_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."petty_cash_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Starter categories (lib/petty-cash-categories.ts). Idempotent: a category
-- OPS already created/renamed with the same name is left untouched.
INSERT INTO "petty_cash_categories" ("name", "default_reason", "requires_custom_reason", "sort_order")
VALUES
  ('Galon', 'Pembelian isi ulang air galon untuk kebutuhan air minum karyawan selama jam operasional toko.', false, 10),
  ('Pulsa Internet', 'Pembelian pulsa / paket data internet untuk operasional toko, seperti koneksi aplikasi, komunikasi, dan pengiriman laporan harian.', false, 20),
  ('Dokumen', 'Biaya keperluan dokumen operasional toko, seperti fotokopi, cetak, atau pengiriman dokumen.', false, 30),
  ('POV', 'Pembelian kebutuhan POV untuk mendukung operasional toko.', false, 40),
  ('Alat Kebersihan Toko', 'Pembelian perlengkapan kebersihan toko (sabun lantai, pembersih kaca, kain lap, kantong sampah, dll.) agar area toko tetap bersih dan nyaman.', false, 50),
  ('ATK', 'Pembelian alat tulis kantor untuk operasional toko, seperti kertas, pulpen, lakban, dan label harga.', false, 60),
  ('Lain-Lain', NULL, true, 70)
ON CONFLICT ("name") DO NOTHING;

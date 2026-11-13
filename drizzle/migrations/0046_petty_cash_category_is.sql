ALTER TABLE "petty_cash_categories" ADD COLUMN "is_code" text;--> statement-breakpoint

-- IS (Business Central item no.) per category, from Finance's "Kategori Pengeluaran Store - Petty Cash" sheet
-- (lib/petty-cash-categories.ts). Back office only: IT edits it, Finance sees it + exports it as "No.".
UPDATE "petty_cash_categories" AS c
SET "is_code" = v.is_code, "updated_at" = now()
FROM (VALUES
  ('STATIONERY & OFFICE SUPPLIES', 'IS000022'),
  ('POSTAGE / TELEGRAMS', 'IS000057'),
  ('TELEPHONE / FAX / TELEX', 'IS000011'),
  ('HOUSEKEEPING EXPS / SUPPLIES', 'IS000012'),
  ('PRINTING', 'IS000005')
) AS v(name, is_code)
WHERE upper(c."name") = v.name AND c."is_code" IS NULL;--> statement-breakpoint

-- New in the sheet: added HIDDEN (is_active = false) — IT shows it to PIC 1 with the eye button when Finance is ready.
INSERT INTO "petty_cash_categories" ("name", "definition", "examples", "is_code", "is_active", "sort_order")
VALUES ('REPAIR & MAINTENANCE', 'Biaya yang dikeluarkan untuk service / maintenance operasional di toko', 'AC, Lampu', 'IS000026', false, 60)
ON CONFLICT ("name") DO UPDATE SET "is_code" = COALESCE("petty_cash_categories"."is_code", EXCLUDED."is_code");

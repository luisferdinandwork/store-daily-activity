ALTER TABLE "setoran_money_storage" ADD COLUMN "sales_cash_photo" text;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD COLUMN "sales_cash_photo_by" text;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD COLUMN "sales_cash_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "sales_cash_photo" text;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "sales_cash_photo_by" text;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "sales_cash_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "sales_cash_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_sales_cash_photo_by_users_id_fk" FOREIGN KEY ("sales_cash_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_sales_cash_photo_by_users_id_fk" FOREIGN KEY ("sales_cash_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Indodana is one amount now (method "total"), not QRIS / Debit / Credit
-- (lib/store-closing-edc.ts). Fold what earlier closings stored into the single
-- cell. The old cells stay in place (nothing is deleted) but are no longer read.
INSERT INTO "store_closing_edc_entries" ("task_id", "bank", "method", "amount")
SELECT "task_id", 'indodana', 'total', SUM("amount")
FROM "store_closing_edc_entries"
WHERE "bank" = 'indodana' AND "method" IN ('qris', 'debit', 'credit')
GROUP BY "task_id"
ON CONFLICT ("task_id", "bank", "method") DO NOTHING;

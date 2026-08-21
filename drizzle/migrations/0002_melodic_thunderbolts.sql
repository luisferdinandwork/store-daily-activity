ALTER TABLE "petty_cash_transactions" ADD COLUMN "actual_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "actual_amount_by" text;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "actual_amount_at" timestamp;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_actual_amount_by_users_id_fk" FOREIGN KEY ("actual_amount_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
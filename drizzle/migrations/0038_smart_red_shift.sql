ALTER TABLE "petty_cash_refill_requests" ADD COLUMN "transfer_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "petty_cash_refill_requests" ADD COLUMN "rejected_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "petty_cash_refill_requests" ADD COLUMN "rejected_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "finance_review" text;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "finance_review_by" text;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "finance_review_at" timestamp;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "finance_comment" text;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "finance_rejected_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "resubmitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_finance_review_by_users_id_fk" FOREIGN KEY ("finance_review_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
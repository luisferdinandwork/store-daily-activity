ALTER TABLE "audit_stock_opnames" ADD COLUMN "ir_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD COLUMN "ir_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD COLUMN "reward_rows" jsonb;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD COLUMN "reward_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD COLUMN "reward_checked_by" text;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD CONSTRAINT "audit_stock_opnames_reward_checked_by_users_id_fk" FOREIGN KEY ("reward_checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
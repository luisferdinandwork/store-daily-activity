DROP TABLE "daily_target_overrides" CASCADE;--> statement-breakpoint
ALTER TABLE "employee_monthly_targets" ADD COLUMN "percentage" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_monthly_targets" ADD COLUMN "is_percentage_overridden" boolean DEFAULT false NOT NULL;
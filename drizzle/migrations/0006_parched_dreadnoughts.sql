CREATE TYPE "public"."impact_visit_type" AS ENUM('virtual', 'on_location');--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'on_hold';--> statement-breakpoint
ALTER TABLE "impact_visits" ADD COLUMN "visit_type" "impact_visit_type";--> statement-breakpoint
ALTER TABLE "impact_visits" ADD COLUMN "screenshot_url" text;--> statement-breakpoint
ALTER TABLE "impact_visits" ADD COLUMN "visit_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "impact_visits" ADD COLUMN "visit_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "impact_visits" ADD COLUMN "estimasi_achievement" text;--> statement-breakpoint
ALTER TABLE "impact_visits" ADD COLUMN "cash_money_ok" boolean DEFAULT false NOT NULL;
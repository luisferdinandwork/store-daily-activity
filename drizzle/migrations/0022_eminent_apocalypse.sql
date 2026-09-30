ALTER TABLE "setoran_money_storage" ALTER COLUMN "schedule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ALTER COLUMN "schedule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "setoran_corrections" ADD COLUMN "kind" text DEFAULT 'correct' NOT NULL;
ALTER TABLE "impact_visits" ADD COLUMN "visit_photo_url" text;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD COLUMN "is_on_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD COLUMN "note" text;
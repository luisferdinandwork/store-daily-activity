ALTER TABLE "notifications" ADD COLUMN "related_type" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "related_id" integer;--> statement-breakpoint
CREATE INDEX "notifications_related_idx" ON "notifications" USING btree ("related_type","related_id");
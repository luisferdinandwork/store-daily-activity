ALTER TABLE "store_closing_tasks" ADD COLUMN "storefront_locked_photo" text;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "storefront_locked_photo_by" text;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "storefront_locked_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_storefront_locked_photo_by_users_id_fk" FOREIGN KEY ("storefront_locked_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "setoran_money_storage" ADD COLUMN "cashier_photo" text;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD COLUMN "cashier_photo_by" text;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD COLUMN "cashier_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "cashier_photo" text;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "cashier_photo_by" text;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "cashier_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_cashier_photo_by_users_id_fk" FOREIGN KEY ("cashier_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_cashier_photo_by_users_id_fk" FOREIGN KEY ("cashier_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
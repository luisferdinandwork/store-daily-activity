ALTER TABLE "setoran_money_storage" ADD COLUMN "atm_card_photo" text;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD COLUMN "atm_card_photo_by" text;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD COLUMN "atm_card_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "atm_card_photo" text;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "atm_card_photo_by" text;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD COLUMN "atm_card_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_atm_card_photo_by_users_id_fk" FOREIGN KEY ("atm_card_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_atm_card_photo_by_users_id_fk" FOREIGN KEY ("atm_card_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
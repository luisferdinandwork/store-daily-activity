ALTER TABLE "receiving_tasks" RENAME TO "item_dropping_tasks";--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" RENAME COLUMN "has_receiving" TO "has_dropping";--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" RENAME COLUMN "receiving_photos" TO "dropping_photos";--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" DROP CONSTRAINT "receiving_tasks_store_id_date_unique";--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" DROP CONSTRAINT "receiving_tasks_schedule_id_schedules_id_fk";
--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" DROP CONSTRAINT "receiving_tasks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" DROP CONSTRAINT "receiving_tasks_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" DROP CONSTRAINT "receiving_tasks_shift_id_shifts_id_fk";
--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" DROP CONSTRAINT "receiving_tasks_verified_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD COLUMN "parent_task_id" integer;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD COLUMN "drop_time" timestamp;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD COLUMN "is_received" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD COLUMN "receive_time" timestamp;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD COLUMN "received_by_user_id" text;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
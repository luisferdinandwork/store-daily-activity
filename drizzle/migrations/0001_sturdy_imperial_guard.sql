CREATE TABLE "serah_terima_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"completed_by" text,
	"completed_by_schedule_id" integer,
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "serah_terima_tasks_store_date_shift_unique" UNIQUE("store_id","date","shift_id")
);
--> statement-breakpoint
ALTER TABLE "serah_terima_entries" DROP CONSTRAINT "serah_terima_entries_created_by_schedule_id_schedules_id_fk";
--> statement-breakpoint
ALTER TABLE "serah_terima_entries" DROP CONSTRAINT "serah_terima_entries_completed_by_schedule_id_schedules_id_fk";
--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ALTER COLUMN "created_by_schedule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "serah_terima_tasks" ADD CONSTRAINT "serah_terima_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_tasks" ADD CONSTRAINT "serah_terima_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_tasks" ADD CONSTRAINT "serah_terima_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_tasks" ADD CONSTRAINT "serah_terima_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_tasks" ADD CONSTRAINT "serah_terima_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_tasks" ADD CONSTRAINT "serah_terima_tasks_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_tasks" ADD CONSTRAINT "serah_terima_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_created_by_schedule_id_schedules_id_fk" FOREIGN KEY ("created_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
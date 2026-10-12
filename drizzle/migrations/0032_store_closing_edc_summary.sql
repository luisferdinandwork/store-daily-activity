CREATE TABLE "store_closing_edc_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"bank" text NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_closing_edc_entries_cell_unique" UNIQUE("task_id","bank","method")
);
--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "op_me_voucher_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "indodana_dashboard_photo" text;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "indodana_dashboard_photo_at" timestamp;--> statement-breakpoint
ALTER TABLE "store_closing_edc_entries" ADD CONSTRAINT "store_closing_edc_entries_task_id_store_closing_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."store_closing_tasks"("id") ON DELETE cascade ON UPDATE no action;
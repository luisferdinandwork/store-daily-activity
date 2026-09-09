CREATE TABLE "store_cash_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"shift_id" integer NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"counted_by_user_id" text NOT NULL,
	"counted_by_schedule_id" integer,
	"witness_user_id" text NOT NULL,
	"selfie_photo" text NOT NULL,
	"notes" text,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_cash_counts_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
ALTER TABLE "store_cash_counts" ADD CONSTRAINT "store_cash_counts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_cash_counts" ADD CONSTRAINT "store_cash_counts_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_cash_counts" ADD CONSTRAINT "store_cash_counts_counted_by_user_id_users_id_fk" FOREIGN KEY ("counted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_cash_counts" ADD CONSTRAINT "store_cash_counts_counted_by_schedule_id_schedules_id_fk" FOREIGN KEY ("counted_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_cash_counts" ADD CONSTRAINT "store_cash_counts_witness_user_id_users_id_fk" FOREIGN KEY ("witness_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_cash_counts_store_date_idx" ON "store_cash_counts" USING btree ("store_id","date");
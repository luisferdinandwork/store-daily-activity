CREATE TABLE "bin_check_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"check_date" date NOT NULL,
	"year_month" text NOT NULL,
	"bin_code" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "bin_check_assignments_store_day_bin_unique" UNIQUE("store_id","check_date","bin_code")
);
--> statement-breakpoint
CREATE TABLE "bin_check_month_bins" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"bin_code" text NOT NULL,
	"in_bc" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"first_checked_on" date,
	"first_wrong_count" integer DEFAULT 0 NOT NULL,
	"wrong_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_checked_on" date,
	"last_result" text,
	"check_days" integer DEFAULT 0 NOT NULL,
	"times_assigned" integer DEFAULT 0 NOT NULL,
	"first_assigned_on" date,
	"last_assigned_on" date,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "bin_check_month_bins_store_month_bin_unique" UNIQUE("store_id","year_month","bin_code")
);
--> statement-breakpoint
CREATE TABLE "bin_check_months" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"total_bins" integer DEFAULT 0 NOT NULL,
	"checked_bins" integer DEFAULT 0 NOT NULL,
	"correct_bins" integer DEFAULT 0 NOT NULL,
	"wrong_bins" integer DEFAULT 0 NOT NULL,
	"fixed_bins" integer DEFAULT 0 NOT NULL,
	"bins_filled_at" timestamp,
	"results_synced_at" timestamp,
	"finalized_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "bin_check_months_store_month_unique" UNIQUE("store_id","year_month")
);
--> statement-breakpoint
CREATE TABLE "store_bin_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"bin_code" text NOT NULL,
	"item_lines" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	CONSTRAINT "store_bin_codes_store_bin_unique" UNIQUE("store_id","bin_code")
);
--> statement-breakpoint
CREATE TABLE "store_bin_syncs" (
	"store_id" integer PRIMARY KEY NOT NULL,
	"synced_at" timestamp,
	"bin_count" integer,
	"attempted_at" timestamp,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "bin_check_assignments" ADD CONSTRAINT "bin_check_assignments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_check_month_bins" ADD CONSTRAINT "bin_check_month_bins_month_id_bin_check_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."bin_check_months"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_check_month_bins" ADD CONSTRAINT "bin_check_month_bins_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_check_months" ADD CONSTRAINT "bin_check_months_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_bin_codes" ADD CONSTRAINT "store_bin_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_bin_syncs" ADD CONSTRAINT "store_bin_syncs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bin_check_assignments_store_day_idx" ON "bin_check_assignments" USING btree ("store_id","check_date");--> statement-breakpoint
CREATE INDEX "bin_check_month_bins_month_idx" ON "bin_check_month_bins" USING btree ("month_id");--> statement-breakpoint
CREATE INDEX "bin_check_months_month_idx" ON "bin_check_months" USING btree ("year_month");--> statement-breakpoint
CREATE INDEX "store_bin_codes_store_idx" ON "store_bin_codes" USING btree ("store_id");
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."break_type" AS ENUM('lunch', 'dinner', 'full_day_lunch', 'full_day_dinner');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('reported', 'in_review', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'submitted', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'discrepancy', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('credit', 'debit', 'qris', 'ewallet', 'cash');--> statement-breakpoint
CREATE TABLE "areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"shift_id" integer NOT NULL,
	"status" "attendance_status" DEFAULT 'present' NOT NULL,
	"check_in_time" timestamp,
	"check_out_time" timestamp,
	"on_break" boolean DEFAULT false NOT NULL,
	"notes" text,
	"recorded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_schedule_id_unique" UNIQUE("schedule_id")
);
--> statement-breakpoint
CREATE TABLE "break_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"attendance_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"break_type" "break_type" NOT NULL,
	"break_out_time" timestamp NOT NULL,
	"return_time" timestamp,
	"cash_out" numeric(12, 2) NOT NULL,
	"cash_in" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"date" timestamp NOT NULL,
	"actual_amount" numeric(12, 2) NOT NULL,
	"rounded_amount" numeric(12, 2) NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"issue_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"status" text DEFAULT 'reported' NOT NULL,
	"attachment_urls" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_schedule_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"monthly_schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"shift_id" integer,
	"is_off" boolean DEFAULT false NOT NULL,
	"is_leave" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_schedule_entries_monthly_schedule_id_user_id_date_unique" UNIQUE("monthly_schedule_id","user_id","date")
);
--> statement-breakpoint
CREATE TABLE "monthly_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"imported_by" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_schedules_store_id_year_month_unique" UNIQUE("store_id","year_month")
);
--> statement-breakpoint
CREATE TABLE "petty_cash_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"monthly_schedule_entry_id" integer,
	"is_holiday" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"geofence_radius_m" numeric(8, 2) DEFAULT '100',
	"area_id" integer NOT NULL,
	"petty_cash_balance" numeric(12, 2) DEFAULT '1000000',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role_id" integer NOT NULL,
	"employee_type_id" integer,
	"home_store_id" integer,
	"area_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "employee_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"start_time" time,
	"end_time" time,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "briefing_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"parent_task_id" integer,
	"done" boolean DEFAULT false NOT NULL,
	"is_balanced" boolean,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cek_bin_task_bins" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"bin_id" integer NOT NULL,
	"bin" text NOT NULL,
	"nama" text NOT NULL,
	"qty_bc" integer DEFAULT 0 NOT NULL,
	"qty_sesuai_bin" integer DEFAULT 0 NOT NULL,
	"qty_tidak_sesuai_bin" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cek_bin_task_bins_task_bin_unique" UNIQUE("task_id","bin_id")
);
--> statement-breakpoint
CREATE TABLE "cek_bin_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"total_store_bins" integer DEFAULT 0 NOT NULL,
	"minimum_bins_to_check" integer DEFAULT 0 NOT NULL,
	"checked_bins_count" integer DEFAULT 0 NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cek_bin_tasks_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "edc_reconciliation_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"parent_task_id" integer,
	"expected_fetched_at" timestamp,
	"expected_snapshot" text,
	"is_balanced" boolean,
	"discrepancy_started_at" timestamp,
	"discrepancy_resolved_at" timestamp,
	"discrepancy_duration_minutes" integer,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edc_transaction_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"edc_task_id" integer NOT NULL,
	"transaction_type" "tx_type" NOT NULL,
	"expected_amount" numeric(14, 2),
	"expected_count" integer,
	"actual_amount" numeric(14, 2),
	"actual_count" integer,
	"matches" boolean,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eod_z_report_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"total_nominal" numeric(14, 2),
	"z_report_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grooming_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"uniform_active" boolean DEFAULT true NOT NULL,
	"hair_active" boolean DEFAULT true NOT NULL,
	"smell_active" boolean DEFAULT true NOT NULL,
	"make_up_active" boolean DEFAULT true NOT NULL,
	"shoe_active" boolean DEFAULT true NOT NULL,
	"name_tag_active" boolean DEFAULT true NOT NULL,
	"uniform_checked" boolean,
	"hair_checked" boolean,
	"smell_checked" boolean,
	"make_up_checked" boolean,
	"shoe_checked" boolean,
	"name_tag_checked" boolean,
	"selfie_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "grooming_tasks_schedule_id_unique" UNIQUE("schedule_id")
);
--> statement-breakpoint
CREATE TABLE "item_dropping_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"to_number" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"drop_time" timestamp NOT NULL,
	"dropping_photos" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_dropping_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"has_dropping" boolean DEFAULT false NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_check_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"promo_name" boolean DEFAULT false NOT NULL,
	"promo_period" boolean DEFAULT false NOT NULL,
	"promo_mechanism" boolean DEFAULT false NOT NULL,
	"random_shoe_items" boolean DEFAULT false NOT NULL,
	"random_non_shoe_items" boolean DEFAULT false NOT NULL,
	"sell_tag" boolean DEFAULT false NOT NULL,
	"promo_name_by" text,
	"promo_name_at" timestamp,
	"promo_period_by" text,
	"promo_period_at" timestamp,
	"promo_mechanism_by" text,
	"promo_mechanism_at" timestamp,
	"random_shoe_items_by" text,
	"random_shoe_items_at" timestamp,
	"random_non_shoe_items_by" text,
	"random_non_shoe_items_at" timestamp,
	"sell_tag_by" text,
	"sell_tag_at" timestamp,
	"notes_by" text,
	"notes_at" timestamp,
	"completed_by" text,
	"completed_by_schedule_id" integer,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_check_tasks_schedule_id_unique" UNIQUE("schedule_id"),
	CONSTRAINT "marketing_check_tasks_store_date_shift_unique" UNIQUE("store_id","date","shift_id")
);
--> statement-breakpoint
CREATE TABLE "open_statement_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"parent_task_id" integer,
	"expected_amount" numeric(14, 2),
	"expected_fetched_at" timestamp,
	"actual_amount" numeric(14, 2),
	"is_balanced" boolean,
	"discrepancy_started_at" timestamp,
	"discrepancy_resolved_at" timestamp,
	"discrepancy_duration_minutes" integer,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setoran_money_storage" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"actual_received_amount" numeric(12, 2) NOT NULL,
	"previous_unpaid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"required_store_amount" numeric(12, 2) NOT NULL,
	"stored_amount" numeric(12, 2) NOT NULL,
	"unpaid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"resi_photo" text,
	"atm_card_selfie_photo" text,
	"notes" text,
	"actual_received_amount_by" text,
	"actual_received_amount_at" timestamp,
	"stored_amount_by" text,
	"stored_amount_at" timestamp,
	"resi_photo_by" text,
	"resi_photo_at" timestamp,
	"atm_card_selfie_photo_by" text,
	"atm_card_selfie_photo_at" timestamp,
	"notes_by" text,
	"notes_at" timestamp,
	"completed_by" text,
	"completed_by_schedule_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "setoran_money_storage_task_id_unique" UNIQUE("task_id"),
	CONSTRAINT "setoran_money_storage_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "setoran_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"expected_amount" numeric(12, 2),
	"carried_deficit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"carried_deficit_fetched_at" timestamp,
	"amount" numeric(12, 2),
	"resi_photo" text,
	"atm_card_selfie_photo" text,
	"unpaid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_received_amount_by" text,
	"actual_received_amount_at" timestamp,
	"stored_amount_by" text,
	"stored_amount_at" timestamp,
	"resi_photo_by" text,
	"resi_photo_at" timestamp,
	"atm_card_selfie_photo_by" text,
	"atm_card_selfie_photo_at" timestamp,
	"notes_by" text,
	"notes_at" timestamp,
	"completed_by" text,
	"completed_by_schedule_id" integer,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "setoran_tasks_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "store_bins" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"bin" text NOT NULL,
	"qty_bc" integer DEFAULT 0 NOT NULL,
	"qty_sesuai_bin" integer DEFAULT 0 NOT NULL,
	"qty_tidak_sesuai_bin" integer DEFAULT 0 NOT NULL,
	"nama" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_bins_store_bin_unique" UNIQUE("store_id","bin")
);
--> statement-breakpoint
CREATE TABLE "store_front_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"storefront_photos" text,
	"rolling_door_closed_photo" text,
	"claimed_by" text,
	"claimed_at" timestamp,
	"completed_by" text,
	"completed_by_schedule_id" integer,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_front_tasks_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "store_opening_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"login_pos" boolean DEFAULT false NOT NULL,
	"check_absen_sunfish" boolean DEFAULT false NOT NULL,
	"tarik_soh_sales" boolean DEFAULT false NOT NULL,
	"five_r" boolean DEFAULT false NOT NULL,
	"five_r_area_kasir_photos" text,
	"five_r_area_depan_photos" text,
	"five_r_area_kanan_photos" text,
	"five_r_area_kiri_photos" text,
	"five_r_area_gudang_photos" text,
	"cek_lamp" boolean DEFAULT false NOT NULL,
	"cek_sound_system" boolean DEFAULT false NOT NULL,
	"cash_drawer_photos" text,
	"login_pos_by" text,
	"login_pos_at" timestamp,
	"check_absen_sunfish_by" text,
	"check_absen_sunfish_at" timestamp,
	"tarik_soh_sales_by" text,
	"tarik_soh_sales_at" timestamp,
	"five_r_by" text,
	"five_r_at" timestamp,
	"five_r_kasir_by" text,
	"five_r_kasir_at" timestamp,
	"five_r_depan_by" text,
	"five_r_depan_at" timestamp,
	"five_r_kanan_by" text,
	"five_r_kanan_at" timestamp,
	"five_r_kiri_by" text,
	"five_r_kiri_at" timestamp,
	"five_r_gudang_by" text,
	"five_r_gudang_at" timestamp,
	"cek_lamp_by" text,
	"cek_lamp_at" timestamp,
	"cek_sound_system_by" text,
	"cek_sound_system_at" timestamp,
	"cash_drawer_by" text,
	"cash_drawer_at" timestamp,
	"completed_by" text,
	"completed_by_schedule_id" integer,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_opening_tasks_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "vm_checklist_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"shoe_lace_shoe_filler_price_tag_hangtag_label_k3l" boolean DEFAULT false NOT NULL,
	"last_pair_and_pigskin_hangtag" boolean DEFAULT false NOT NULL,
	"pop_promo_update" boolean DEFAULT false NOT NULL,
	"display_table_wall_shelving_showcase_hangbar_stacking_pedestal" boolean DEFAULT false NOT NULL,
	"floor_display_cleanliness" boolean DEFAULT false NOT NULL,
	"vm_tools_storage" boolean DEFAULT false NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vm_checklist_tasks_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_sessions" ADD CONSTRAINT "break_sessions_attendance_id_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_sessions" ADD CONSTRAINT "break_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_sessions" ADD CONSTRAINT "break_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_monthly_schedule_id_monthly_schedules_id_fk" FOREIGN KEY ("monthly_schedule_id") REFERENCES "public"."monthly_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_monthly_schedule_entry_id_monthly_schedule_entries_id_fk" FOREIGN KEY ("monthly_schedule_entry_id") REFERENCES "public"."monthly_schedule_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_user_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_type_id_employee_types_id_fk" FOREIGN KEY ("employee_type_id") REFERENCES "public"."employee_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_store_id_stores_id_fk" FOREIGN KEY ("home_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_task_bins" ADD CONSTRAINT "cek_bin_task_bins_task_id_cek_bin_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."cek_bin_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_task_bins" ADD CONSTRAINT "cek_bin_task_bins_bin_id_store_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."store_bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_reconciliation_tasks" ADD CONSTRAINT "edc_reconciliation_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_reconciliation_tasks" ADD CONSTRAINT "edc_reconciliation_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_reconciliation_tasks" ADD CONSTRAINT "edc_reconciliation_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_reconciliation_tasks" ADD CONSTRAINT "edc_reconciliation_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_reconciliation_tasks" ADD CONSTRAINT "edc_reconciliation_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_transaction_rows" ADD CONSTRAINT "edc_transaction_rows_edc_task_id_edc_reconciliation_tasks_id_fk" FOREIGN KEY ("edc_task_id") REFERENCES "public"."edc_reconciliation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_z_report_tasks" ADD CONSTRAINT "eod_z_report_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_z_report_tasks" ADD CONSTRAINT "eod_z_report_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_z_report_tasks" ADD CONSTRAINT "eod_z_report_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_z_report_tasks" ADD CONSTRAINT "eod_z_report_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_z_report_tasks" ADD CONSTRAINT "eod_z_report_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_task_id_item_dropping_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."item_dropping_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_promo_name_by_users_id_fk" FOREIGN KEY ("promo_name_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_promo_period_by_users_id_fk" FOREIGN KEY ("promo_period_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_promo_mechanism_by_users_id_fk" FOREIGN KEY ("promo_mechanism_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_random_shoe_items_by_users_id_fk" FOREIGN KEY ("random_shoe_items_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_random_non_shoe_items_by_users_id_fk" FOREIGN KEY ("random_non_shoe_items_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_sell_tag_by_users_id_fk" FOREIGN KEY ("sell_tag_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_notes_by_users_id_fk" FOREIGN KEY ("notes_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_check_tasks" ADD CONSTRAINT "marketing_check_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_task_id_setoran_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."setoran_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_actual_received_amount_by_users_id_fk" FOREIGN KEY ("actual_received_amount_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_stored_amount_by_users_id_fk" FOREIGN KEY ("stored_amount_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_resi_photo_by_users_id_fk" FOREIGN KEY ("resi_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_atm_card_selfie_photo_by_users_id_fk" FOREIGN KEY ("atm_card_selfie_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_notes_by_users_id_fk" FOREIGN KEY ("notes_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_money_storage" ADD CONSTRAINT "setoran_money_storage_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_actual_received_amount_by_users_id_fk" FOREIGN KEY ("actual_received_amount_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_stored_amount_by_users_id_fk" FOREIGN KEY ("stored_amount_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_resi_photo_by_users_id_fk" FOREIGN KEY ("resi_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_atm_card_selfie_photo_by_users_id_fk" FOREIGN KEY ("atm_card_selfie_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_notes_by_users_id_fk" FOREIGN KEY ("notes_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_bins" ADD CONSTRAINT "store_bins_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front_tasks" ADD CONSTRAINT "store_front_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_login_pos_by_users_id_fk" FOREIGN KEY ("login_pos_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_check_absen_sunfish_by_users_id_fk" FOREIGN KEY ("check_absen_sunfish_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_tarik_soh_sales_by_users_id_fk" FOREIGN KEY ("tarik_soh_sales_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_five_r_by_users_id_fk" FOREIGN KEY ("five_r_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_five_r_kasir_by_users_id_fk" FOREIGN KEY ("five_r_kasir_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_five_r_depan_by_users_id_fk" FOREIGN KEY ("five_r_depan_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_five_r_kanan_by_users_id_fk" FOREIGN KEY ("five_r_kanan_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_five_r_kiri_by_users_id_fk" FOREIGN KEY ("five_r_kiri_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_five_r_gudang_by_users_id_fk" FOREIGN KEY ("five_r_gudang_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_cek_lamp_by_users_id_fk" FOREIGN KEY ("cek_lamp_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_cek_sound_system_by_users_id_fk" FOREIGN KEY ("cek_sound_system_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_cash_drawer_by_users_id_fk" FOREIGN KEY ("cash_drawer_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vm_checklist_tasks" ADD CONSTRAINT "vm_checklist_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vm_checklist_tasks" ADD CONSTRAINT "vm_checklist_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vm_checklist_tasks" ADD CONSTRAINT "vm_checklist_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vm_checklist_tasks" ADD CONSTRAINT "vm_checklist_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vm_checklist_tasks" ADD CONSTRAINT "vm_checklist_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cek_bin_task_bins_task_idx" ON "cek_bin_task_bins" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "cek_bin_tasks_store_date_idx" ON "cek_bin_tasks" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "setoran_money_storage_store_date_idx" ON "setoran_money_storage" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "store_bins_store_idx" ON "store_bins" USING btree ("store_id");
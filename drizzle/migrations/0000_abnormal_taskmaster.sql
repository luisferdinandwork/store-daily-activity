CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."break_type" AS ENUM('lunch', 'dinner');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('reported', 'in_review', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'submitted', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'verified', 'rejected');--> statement-breakpoint
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
	"done" boolean DEFAULT false NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "briefing_tasks_store_id_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "cek_bin_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cek_bin_tasks_store_id_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "edc_settlement_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"edc_settlement_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "edc_settlement_tasks_store_id_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "edc_summary_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"edc_summary_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "edc_summary_tasks_store_id_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "eod_z_report_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"z_report_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eod_z_report_tasks_store_id_date_unique" UNIQUE("store_id","date")
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
	"nails_active" boolean DEFAULT true NOT NULL,
	"accessories_active" boolean DEFAULT true NOT NULL,
	"shoe_active" boolean DEFAULT true NOT NULL,
	"uniform_complete" boolean,
	"hair_groomed" boolean,
	"nails_clean" boolean,
	"accessories_compliant" boolean,
	"shoe_compliant" boolean,
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
CREATE TABLE "open_statement_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"open_statement_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_statement_tasks_store_id_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "product_check_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"display" boolean DEFAULT false NOT NULL,
	"price" boolean DEFAULT false NOT NULL,
	"sale_tag" boolean DEFAULT false NOT NULL,
	"shoe_filler" boolean DEFAULT false NOT NULL,
	"label_indo" boolean DEFAULT false NOT NULL,
	"barcode" boolean DEFAULT false NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_check_tasks_store_id_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "receiving_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"has_receiving" boolean DEFAULT false NOT NULL,
	"receiving_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "receiving_tasks_store_id_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "setoran_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"amount" numeric(12, 2),
	"link_setoran" text,
	"money_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "setoran_tasks_store_id_date_unique" UNIQUE("store_id","date")
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
	"cek_lamp" boolean DEFAULT false NOT NULL,
	"cek_sound_system" boolean DEFAULT false NOT NULL,
	"store_front_photos" text,
	"cash_drawer_photos" text,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_opening_tasks_store_id_date_unique" UNIQUE("store_id","date")
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
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_bin_tasks" ADD CONSTRAINT "cek_bin_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_settlement_tasks" ADD CONSTRAINT "edc_settlement_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_settlement_tasks" ADD CONSTRAINT "edc_settlement_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_settlement_tasks" ADD CONSTRAINT "edc_settlement_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_settlement_tasks" ADD CONSTRAINT "edc_settlement_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_settlement_tasks" ADD CONSTRAINT "edc_settlement_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_summary_tasks" ADD CONSTRAINT "edc_summary_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_summary_tasks" ADD CONSTRAINT "edc_summary_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_summary_tasks" ADD CONSTRAINT "edc_summary_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_summary_tasks" ADD CONSTRAINT "edc_summary_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edc_summary_tasks" ADD CONSTRAINT "edc_summary_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_statement_tasks" ADD CONSTRAINT "open_statement_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_check_tasks" ADD CONSTRAINT "product_check_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_check_tasks" ADD CONSTRAINT "product_check_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_check_tasks" ADD CONSTRAINT "product_check_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_check_tasks" ADD CONSTRAINT "product_check_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_check_tasks" ADD CONSTRAINT "product_check_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_tasks" ADD CONSTRAINT "receiving_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_tasks" ADD CONSTRAINT "receiving_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_tasks" ADD CONSTRAINT "receiving_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_tasks" ADD CONSTRAINT "receiving_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_tasks" ADD CONSTRAINT "receiving_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_tasks" ADD CONSTRAINT "setoran_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_opening_tasks" ADD CONSTRAINT "store_opening_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
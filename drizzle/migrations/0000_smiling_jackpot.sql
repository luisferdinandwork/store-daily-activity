CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."break_type" AS ENUM('lunch', 'dinner', 'full_day_lunch', 'full_day_dinner');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('draft', 'reported', 'in_review', 'solved', 'completed');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('not_started', 'in_progress', 'completed', 'pending');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('credit', 'debit', 'qris', 'ewallet', 'cash');--> statement-breakpoint
CREATE TYPE "public"."impact_visit_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
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
CREATE TABLE "business_central_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text DEFAULT 'sales_entries' NOT NULL,
	"name" text DEFAULT 'Business Central Sales Entries' NOT NULL,
	"api_url" text NOT NULL,
	"username" text,
	"password" text,
	"bearer_token" text,
	"auth_type" text DEFAULT 'basic' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_central_settings_code_unique" UNIQUE("code")
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
CREATE TABLE "issue_role_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_role_assignments_issue_role_unique" UNIQUE("issue_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"assigned_to_role_id" integer NOT NULL,
	"status" "issue_status" DEFAULT 'reported' NOT NULL,
	"attachment_urls" text,
	"ba_attachment_urls" text,
	"ba_uploaded_by" text,
	"ba_uploaded_at" timestamp,
	"solved_by" text,
	"solved_at" timestamp,
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
	"store_no" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"geofence_radius_m" numeric(8, 2) DEFAULT '100',
	"area_id" integer NOT NULL,
	"petty_cash_balance" numeric(12, 2) DEFAULT '1000000',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stores_store_no_unique" UNIQUE("store_no")
);
--> statement-breakpoint
CREATE TABLE "user_store_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"area_id" integer,
	"role_id" integer NOT NULL,
	"employee_type_id" integer,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_temporary" boolean DEFAULT false NOT NULL,
	"previous_store_id" integer,
	"previous_area_id" integer,
	"previous_role_id" integer,
	"previous_employee_type_id" integer,
	"reverted_at" timestamp,
	"assigned_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"nik" text NOT NULL,
	"name" text NOT NULL,
	"password" text NOT NULL,
	"role_id" integer NOT NULL,
	"employee_type_id" integer,
	"switched_from_role_id" integer,
	"switched_from_employee_type_id" integer,
	"home_store_id" integer,
	"area_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_nik_unique" UNIQUE("nik")
);
--> statement-breakpoint
CREATE TABLE "impact_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"visited_by" text NOT NULL,
	"visit_date" timestamp NOT NULL,
	"target_bulan_berjalan" text,
	"periode_tanggal" text,
	"pencapaian_pct" numeric(5, 2),
	"checklist_responses" text,
	"checklist_score" integer DEFAULT 0 NOT NULL,
	"checklist_max_score" integer DEFAULT 100 NOT NULL,
	"checklist_grade" text,
	"cash_money_data" text,
	"vm_checklist_responses" text,
	"vm_checklist_score" integer DEFAULT 0 NOT NULL,
	"vm_checklist_max_score" integer DEFAULT 70 NOT NULL,
	"vm_checklist_grade" text,
	"notes" text,
	"status" "impact_visit_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"accent" text,
	"icon" text,
	"breaks" jsonb,
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
	"can_receive_issues" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "petty_cash_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"opening_balance" numeric(12, 2) DEFAULT '1000000' NOT NULL,
	"current_balance" numeric(12, 2) DEFAULT '1000000' NOT NULL,
	"closing_balance" numeric(12, 2),
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by" text,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "pcp_store_month_unique" UNIQUE("store_id","year_month")
);
--> statement-breakpoint
CREATE TABLE "petty_cash_refill_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"balance_before" numeric(12, 2),
	"balance_after" numeric(12, 2),
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"drawer_photo_url" text,
	"signature_photo_url" text,
	"proof_uploaded_by" text,
	"proof_uploaded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petty_cash_refills" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"next_year_month" text NOT NULL,
	"refill_amount" numeric(12, 2) NOT NULL,
	"balance_before" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"refill_by" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pcr_store_month_unique" UNIQUE("store_id","year_month")
);
--> statement-breakpoint
CREATE TABLE "petty_cash_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_id" integer,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"status" text DEFAULT 'pending_ops' NOT NULL,
	"image_url" text,
	"image_key" text,
	"year_month" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "briefing_tasks_store_date_shift_unique" UNIQUE("store_id","date","shift_id")
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cek_bin_tasks_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "cek_uang_modal_denominations" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"denomination_value" integer NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cek_uang_modal_task_denomination_unique" UNIQUE("task_id","denomination_value")
);
--> statement-breakpoint
CREATE TABLE "cek_uang_modal_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"max_amount" numeric(12, 2) DEFAULT '500000' NOT NULL,
	"remaining_amount" numeric(12, 2) DEFAULT '500000' NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cek_uang_modal_tasks_store_date_shift_unique" UNIQUE("store_id","date","shift_id")
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
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
	"transfer_order_id" integer,
	"qty_ordered" integer,
	"qty_counted" integer,
	"courier_sign_photo" text,
	"submitted_at" timestamp,
	"submitted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_dropping_entries_transfer_order_unique" UNIQUE("transfer_order_id")
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_dropping_tasks_store_date_shift_unique" UNIQUE("store_id","date","shift_id")
);
--> statement-breakpoint
CREATE TABLE "item_return_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"return_number" text NOT NULL,
	"description" text,
	"expected_at" timestamp,
	"quantity" integer DEFAULT 0 NOT NULL,
	"return_time" timestamp NOT NULL,
	"return_photos" text,
	"notes" text,
	"transfer_order_id" integer,
	"qty_ordered" integer,
	"qty_counted" integer,
	"courier_sign_photo" text,
	"submitted_at" timestamp,
	"submitted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_return_entries_transfer_order_unique" UNIQUE("transfer_order_id")
);
--> statement-breakpoint
CREATE TABLE "item_return_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"has_return" boolean DEFAULT false NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_return_tasks_store_date_shift_unique" UNIQUE("store_id","date","shift_id")
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
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
CREATE TABLE "serah_terima_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"message" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_schedule_id" integer NOT NULL,
	"created_by_shift_id" integer NOT NULL,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_by_user_id" text,
	"completed_by_schedule_id" integer,
	"completed_by_shift_id" integer,
	"completed_at" timestamp,
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
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
CREATE TABLE "store_closing_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"eod_z_report_done" boolean DEFAULT false NOT NULL,
	"eod_z_report_by" text,
	"eod_z_report_at" timestamp,
	"eod_edc_settlement_photo" text,
	"eod_edc_settlement_photo_by" text,
	"eod_edc_settlement_photo_at" timestamp,
	"edc_settlement_done" boolean DEFAULT false NOT NULL,
	"edc_settlement_notes" text,
	"edc_settlement_by" text,
	"edc_settlement_at" timestamp,
	"edc_summary_done" boolean DEFAULT false NOT NULL,
	"edc_summary_notes" text,
	"edc_summary_by" text,
	"edc_summary_at" timestamp,
	"open_statement_decision" text,
	"open_statement_hold_reason" text,
	"open_statement_by" text,
	"open_statement_at" timestamp,
	"is_on_hold" boolean DEFAULT false NOT NULL,
	"hold_issue_id" integer,
	"held_by" text,
	"held_at" timestamp,
	"hold_resolved_at" timestamp,
	"reopened_at" timestamp,
	"completed_by" text,
	"completed_by_schedule_id" integer,
	"submitted_lat" numeric(10, 7),
	"submitted_lng" numeric(10, 7),
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_closing_tasks_store_date_unique" UNIQUE("store_id","date")
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
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
	"five_r_area_kasir_photo_actors" text,
	"five_r_depan_by" text,
	"five_r_depan_at" timestamp,
	"five_r_area_depan_photo_actors" text,
	"five_r_kanan_by" text,
	"five_r_kanan_at" timestamp,
	"five_r_area_kanan_photo_actors" text,
	"five_r_kiri_by" text,
	"five_r_kiri_at" timestamp,
	"five_r_area_kiri_photo_actors" text,
	"five_r_gudang_by" text,
	"five_r_gudang_at" timestamp,
	"five_r_area_gudang_photo_actors" text,
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
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
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vm_checklist_tasks_store_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "shift_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift_id" integer NOT NULL,
	"task_definition_id" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"is_sequenced" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"assigned_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shift_tasks_shift_task_unique" UNIQUE("shift_id","task_definition_id")
);
--> statement-breakpoint
CREATE TABLE "task_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon" text,
	"accent" text,
	"is_personal" boolean DEFAULT false NOT NULL,
	"requires_location" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_definitions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "employee_monthly_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_monthly_target_id" integer,
	"user_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"target_role_code" text DEFAULT 'SA' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_percentage_overridden" boolean DEFAULT false NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_monthly_targets_user_store_month_unique" UNIQUE("user_id","store_id","year_month")
);
--> statement-breakpoint
CREATE TABLE "store_monthly_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"year_month" text NOT NULL,
	"monthly_sales_target" numeric(14, 2) DEFAULT '0' NOT NULL,
	"monthly_transaction_target" integer DEFAULT 0 NOT NULL,
	"target_source" text DEFAULT 'manual' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_monthly_targets_store_month_unique" UNIQUE("store_id","year_month")
);
--> statement-breakpoint
CREATE TABLE "target_allocation_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"headcount" integer NOT NULL,
	"slot_code" text NOT NULL,
	"percentage" numeric(5, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "target_allocation_templates_headcount_slot_unique" UNIQUE("headcount","slot_code")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"file_url" text NOT NULL,
	"file_type" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_transfer_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"toa_no" text NOT NULL,
	"transfer_from_code" text NOT NULL,
	"transfer_to_code" text NOT NULL,
	"from_store_id" integer,
	"to_store_id" integer,
	"qty_ordered" integer DEFAULT 0 NOT NULL,
	"bc_status" text,
	"posting_date" timestamp,
	"return_detected_at" timestamp,
	"return_submitted_at" timestamp,
	"whse_shipment_no" text,
	"whse_shipment_lines" text,
	"dropping_detected_at" timestamp,
	"dropping_submitted_at" timestamp,
	"received_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_transfer_orders_toa_no_unique" UNIQUE("toa_no")
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
ALTER TABLE "business_central_settings" ADD CONSTRAINT "business_central_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_central_settings" ADD CONSTRAINT "business_central_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_role_assignments" ADD CONSTRAINT "issue_role_assignments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_role_assignments" ADD CONSTRAINT "issue_role_assignments_role_id_user_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."user_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assigned_to_role_id_user_roles_id_fk" FOREIGN KEY ("assigned_to_role_id") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_ba_uploaded_by_users_id_fk" FOREIGN KEY ("ba_uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_solved_by_users_id_fk" FOREIGN KEY ("solved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_monthly_schedule_id_monthly_schedules_id_fk" FOREIGN KEY ("monthly_schedule_id") REFERENCES "public"."monthly_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_monthly_schedule_entry_id_monthly_schedule_entries_id_fk" FOREIGN KEY ("monthly_schedule_entry_id") REFERENCES "public"."monthly_schedule_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_role_id_user_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_employee_type_id_employee_types_id_fk" FOREIGN KEY ("employee_type_id") REFERENCES "public"."employee_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_previous_store_id_stores_id_fk" FOREIGN KEY ("previous_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_previous_area_id_areas_id_fk" FOREIGN KEY ("previous_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_previous_role_id_user_roles_id_fk" FOREIGN KEY ("previous_role_id") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_previous_employee_type_id_employee_types_id_fk" FOREIGN KEY ("previous_employee_type_id") REFERENCES "public"."employee_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_assignments" ADD CONSTRAINT "user_store_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_user_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_type_id_employee_types_id_fk" FOREIGN KEY ("employee_type_id") REFERENCES "public"."employee_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_switched_from_role_id_user_roles_id_fk" FOREIGN KEY ("switched_from_role_id") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_switched_from_employee_type_id_employee_types_id_fk" FOREIGN KEY ("switched_from_employee_type_id") REFERENCES "public"."employee_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_store_id_stores_id_fk" FOREIGN KEY ("home_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_visits" ADD CONSTRAINT "impact_visits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_visits" ADD CONSTRAINT "impact_visits_visited_by_users_id_fk" FOREIGN KEY ("visited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_periods" ADD CONSTRAINT "petty_cash_periods_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_periods" ADD CONSTRAINT "petty_cash_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_refill_requests" ADD CONSTRAINT "petty_cash_refill_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_refill_requests" ADD CONSTRAINT "petty_cash_refill_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_refill_requests" ADD CONSTRAINT "petty_cash_refill_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_refill_requests" ADD CONSTRAINT "petty_cash_refill_requests_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_refill_requests" ADD CONSTRAINT "petty_cash_refill_requests_proof_uploaded_by_users_id_fk" FOREIGN KEY ("proof_uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_refills" ADD CONSTRAINT "petty_cash_refills_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_refills" ADD CONSTRAINT "petty_cash_refills_refill_by_users_id_fk" FOREIGN KEY ("refill_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_period_id_petty_cash_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."petty_cash_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "cek_uang_modal_denominations" ADD CONSTRAINT "cek_uang_modal_denominations_task_id_cek_uang_modal_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."cek_uang_modal_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_uang_modal_denominations" ADD CONSTRAINT "cek_uang_modal_denominations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_uang_modal_denominations" ADD CONSTRAINT "cek_uang_modal_denominations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_uang_modal_tasks" ADD CONSTRAINT "cek_uang_modal_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_uang_modal_tasks" ADD CONSTRAINT "cek_uang_modal_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_uang_modal_tasks" ADD CONSTRAINT "cek_uang_modal_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_uang_modal_tasks" ADD CONSTRAINT "cek_uang_modal_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_uang_modal_tasks" ADD CONSTRAINT "cek_uang_modal_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grooming_tasks" ADD CONSTRAINT "grooming_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_task_id_item_dropping_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."item_dropping_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_transfer_order_id_item_transfer_orders_id_fk" FOREIGN KEY ("transfer_order_id") REFERENCES "public"."item_transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_entries" ADD CONSTRAINT "item_dropping_entries_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_entries" ADD CONSTRAINT "item_return_entries_task_id_item_return_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."item_return_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_entries" ADD CONSTRAINT "item_return_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_entries" ADD CONSTRAINT "item_return_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_entries" ADD CONSTRAINT "item_return_entries_transfer_order_id_item_transfer_orders_id_fk" FOREIGN KEY ("transfer_order_id") REFERENCES "public"."item_transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_entries" ADD CONSTRAINT "item_return_entries_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_tasks" ADD CONSTRAINT "item_return_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_tasks" ADD CONSTRAINT "item_return_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_tasks" ADD CONSTRAINT "item_return_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_tasks" ADD CONSTRAINT "item_return_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_return_tasks" ADD CONSTRAINT "item_return_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_created_by_schedule_id_schedules_id_fk" FOREIGN KEY ("created_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_created_by_shift_id_shifts_id_fk" FOREIGN KEY ("created_by_shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serah_terima_entries" ADD CONSTRAINT "serah_terima_entries_completed_by_shift_id_shifts_id_fk" FOREIGN KEY ("completed_by_shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_eod_z_report_by_users_id_fk" FOREIGN KEY ("eod_z_report_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_eod_edc_settlement_photo_by_users_id_fk" FOREIGN KEY ("eod_edc_settlement_photo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_edc_settlement_by_users_id_fk" FOREIGN KEY ("edc_settlement_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_edc_summary_by_users_id_fk" FOREIGN KEY ("edc_summary_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_open_statement_by_users_id_fk" FOREIGN KEY ("open_statement_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_hold_issue_id_issues_id_fk" FOREIGN KEY ("hold_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_held_by_users_id_fk" FOREIGN KEY ("held_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_completed_by_schedule_id_schedules_id_fk" FOREIGN KEY ("completed_by_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "shift_tasks" ADD CONSTRAINT "shift_tasks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_tasks" ADD CONSTRAINT "shift_tasks_task_definition_id_task_definitions_id_fk" FOREIGN KEY ("task_definition_id") REFERENCES "public"."task_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_tasks" ADD CONSTRAINT "shift_tasks_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_store_monthly_target_id_store_monthly_targets_id_fk" FOREIGN KEY ("store_monthly_target_id") REFERENCES "public"."store_monthly_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_monthly_targets" ADD CONSTRAINT "store_monthly_targets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_monthly_targets" ADD CONSTRAINT "store_monthly_targets_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_monthly_targets" ADD CONSTRAINT "store_monthly_targets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_monthly_targets" ADD CONSTRAINT "store_monthly_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuals" ADD CONSTRAINT "manuals_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_transfer_orders" ADD CONSTRAINT "item_transfer_orders_from_store_id_stores_id_fk" FOREIGN KEY ("from_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_transfer_orders" ADD CONSTRAINT "item_transfer_orders_to_store_id_stores_id_fk" FOREIGN KEY ("to_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_central_settings_active_idx" ON "business_central_settings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "issue_role_assignments_issue_idx" ON "issue_role_assignments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_role_assignments_role_idx" ON "issue_role_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "issues_reporter_idx" ON "issues" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "issues_store_idx" ON "issues" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "issues_assigned_role_idx" ON "issues" USING btree ("assigned_to_role_id");--> statement-breakpoint
CREATE INDEX "issues_status_idx" ON "issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stores_area_idx" ON "stores" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "user_store_assignments_user_active_idx" ON "user_store_assignments" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "user_store_assignments_store_active_idx" ON "user_store_assignments" USING btree ("store_id","is_active");--> statement-breakpoint
CREATE INDEX "user_store_assignments_temp_expiry_idx" ON "user_store_assignments" USING btree ("is_temporary","is_active","effective_to");--> statement-breakpoint
CREATE INDEX "users_nik_idx" ON "users" USING btree ("nik");--> statement-breakpoint
CREATE INDEX "users_home_store_idx" ON "users" USING btree ("home_store_id");--> statement-breakpoint
CREATE INDEX "users_area_idx" ON "users" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "impact_visits_store_idx" ON "impact_visits" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "impact_visits_visited_by_idx" ON "impact_visits" USING btree ("visited_by");--> statement-breakpoint
CREATE INDEX "impact_visits_status_idx" ON "impact_visits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pcp_store_month_idx" ON "petty_cash_periods" USING btree ("store_id","year_month");--> statement-breakpoint
CREATE INDEX "pcp_status_idx" ON "petty_cash_periods" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pcrr_store_month_idx" ON "petty_cash_refill_requests" USING btree ("store_id","year_month");--> statement-breakpoint
CREATE INDEX "pcrr_status_idx" ON "petty_cash_refill_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pcr_store_month_idx" ON "petty_cash_refills" USING btree ("store_id","year_month");--> statement-breakpoint
CREATE INDEX "pcr_next_month_idx" ON "petty_cash_refills" USING btree ("next_year_month");--> statement-breakpoint
CREATE INDEX "pct_period_idx" ON "petty_cash_transactions" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "pct_store_month_idx" ON "petty_cash_transactions" USING btree ("store_id","year_month");--> statement-breakpoint
CREATE INDEX "pct_status_idx" ON "petty_cash_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pct_year_month_idx" ON "petty_cash_transactions" USING btree ("year_month");--> statement-breakpoint
CREATE INDEX "cek_bin_task_bins_task_idx" ON "cek_bin_task_bins" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "cek_bin_tasks_store_date_idx" ON "cek_bin_tasks" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "cek_uang_modal_denominations_task_idx" ON "cek_uang_modal_denominations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "cek_uang_modal_tasks_store_date_idx" ON "cek_uang_modal_tasks" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "cek_uang_modal_tasks_status_idx" ON "cek_uang_modal_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "item_return_entries_task_idx" ON "item_return_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "item_return_entries_return_number_idx" ON "item_return_entries" USING btree ("return_number");--> statement-breakpoint
CREATE INDEX "item_return_tasks_store_date_idx" ON "item_return_tasks" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "serah_terima_entries_store_idx" ON "serah_terima_entries" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "serah_terima_entries_store_completed_idx" ON "serah_terima_entries" USING btree ("store_id","is_completed");--> statement-breakpoint
CREATE INDEX "setoran_money_storage_store_date_idx" ON "setoran_money_storage" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "store_bins_store_idx" ON "store_bins" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_closing_tasks_store_date_idx" ON "store_closing_tasks" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "store_closing_tasks_hold_issue_idx" ON "store_closing_tasks" USING btree ("hold_issue_id");--> statement-breakpoint
CREATE INDEX "store_closing_tasks_status_idx" ON "store_closing_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shift_tasks_shift_idx" ON "shift_tasks" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shift_tasks_task_def_idx" ON "shift_tasks" USING btree ("task_definition_id");--> statement-breakpoint
CREATE INDEX "task_definitions_active_idx" ON "task_definitions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "employee_monthly_targets_user_store_month_idx" ON "employee_monthly_targets" USING btree ("user_id","store_id","year_month");--> statement-breakpoint
CREATE INDEX "employee_monthly_targets_store_month_idx" ON "employee_monthly_targets" USING btree ("store_id","year_month");--> statement-breakpoint
CREATE INDEX "employee_monthly_targets_plan_idx" ON "employee_monthly_targets" USING btree ("store_monthly_target_id");--> statement-breakpoint
CREATE INDEX "employee_monthly_targets_role_idx" ON "employee_monthly_targets" USING btree ("target_role_code");--> statement-breakpoint
CREATE INDEX "employee_monthly_targets_active_idx" ON "employee_monthly_targets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "store_monthly_targets_store_month_idx" ON "store_monthly_targets" USING btree ("store_id","year_month");--> statement-breakpoint
CREATE INDEX "store_monthly_targets_active_idx" ON "store_monthly_targets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "target_allocation_templates_headcount_idx" ON "target_allocation_templates" USING btree ("headcount");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "item_transfer_orders_from_store_idx" ON "item_transfer_orders" USING btree ("from_store_id");--> statement-breakpoint
CREATE INDEX "item_transfer_orders_to_store_idx" ON "item_transfer_orders" USING btree ("to_store_id");--> statement-breakpoint
CREATE INDEX "item_transfer_orders_whse_shipment_no_idx" ON "item_transfer_orders" USING btree ("whse_shipment_no");
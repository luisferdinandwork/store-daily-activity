CREATE TABLE "audit_cash_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"check_date" date NOT NULL,
	"doc_seq" integer NOT NULL,
	"doc_number" text NOT NULL,
	"sign_city" text NOT NULL,
	"sign_date" date NOT NULL,
	"holder_user_id" text,
	"holder_name" text DEFAULT '' NOT NULL,
	"holder_caption" text DEFAULT '' NOT NULL,
	"auditor_user_id" text,
	"auditor_name" text DEFAULT '' NOT NULL,
	"auditor_caption" text DEFAULT 'Tim Audit' NOT NULL,
	"known_name" text DEFAULT '' NOT NULL,
	"known_title" text DEFAULT '' NOT NULL,
	"approved_name" text DEFAULT '' NOT NULL,
	"approved_title" text DEFAULT '' NOT NULL,
	"modal_book" integer DEFAULT 0 NOT NULL,
	"sales_cash" integer DEFAULT 0 NOT NULL,
	"sales_debit" integer DEFAULT 0 NOT NULL,
	"sales_credit" integer DEFAULT 0 NOT NULL,
	"sales_voucher" integer DEFAULT 0 NOT NULL,
	"modal_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"modal_notes" text,
	"modal_checked_at" timestamp,
	"modal_checked_by" text,
	"petty_fund" integer DEFAULT 1000000 NOT NULL,
	"petty_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"petty_extras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"petty_pending_refill" integer DEFAULT 0 NOT NULL,
	"petty_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"petty_notes" text,
	"petty_system_balance" integer,
	"petty_checked_at" timestamp,
	"petty_checked_by" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audit_cash_checks_store_day_unique" UNIQUE("store_id","check_date")
);
--> statement-breakpoint
ALTER TABLE "audit_cash_checks" ADD CONSTRAINT "audit_cash_checks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cash_checks" ADD CONSTRAINT "audit_cash_checks_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cash_checks" ADD CONSTRAINT "audit_cash_checks_auditor_user_id_users_id_fk" FOREIGN KEY ("auditor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cash_checks" ADD CONSTRAINT "audit_cash_checks_modal_checked_by_users_id_fk" FOREIGN KEY ("modal_checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cash_checks" ADD CONSTRAINT "audit_cash_checks_petty_checked_by_users_id_fk" FOREIGN KEY ("petty_checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cash_checks" ADD CONSTRAINT "audit_cash_checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_cash_checks_date_idx" ON "audit_cash_checks" USING btree ("check_date");
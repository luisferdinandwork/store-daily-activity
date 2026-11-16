CREATE TABLE "audit_stock_opnames" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"so_date" date NOT NULL,
	"doc_seq" integer NOT NULL,
	"doc_number" text NOT NULL,
	"sign_city" text NOT NULL,
	"sign_date" date NOT NULL,
	"store_title" text NOT NULL,
	"soh_bc" integer DEFAULT 0 NOT NULL,
	"scan_qty" integer DEFAULT 0 NOT NULL,
	"shopping_bag_qty" integer DEFAULT 0 NOT NULL,
	"trans_sales_qty" integer DEFAULT 0 NOT NULL,
	"value_plus" bigint,
	"value_minus" bigint,
	"value_source" text,
	"bins_total" integer DEFAULT 0 NOT NULL,
	"bins_match" integer DEFAULT 0 NOT NULL,
	"bins_mismatch" integer DEFAULT 0 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bc_snapshot" jsonb,
	"notes" text,
	"surat_city" text DEFAULT '' NOT NULL,
	"surat_brand" text DEFAULT '' NOT NULL,
	"surat_location" text DEFAULT '' NOT NULL,
	"holder_user_id" text,
	"holder_name" text DEFAULT '' NOT NULL,
	"holder_caption" text DEFAULT '' NOT NULL,
	"holder_title" text DEFAULT 'Head Store' NOT NULL,
	"auditor_user_id" text,
	"auditor_name" text DEFAULT '' NOT NULL,
	"auditor_caption" text DEFAULT 'Tim Audit' NOT NULL,
	"known_name" text DEFAULT '' NOT NULL,
	"known_title" text DEFAULT '' NOT NULL,
	"approved_name" text DEFAULT '' NOT NULL,
	"approved_title" text DEFAULT '' NOT NULL,
	"checked_at" timestamp,
	"checked_by" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audit_stock_opnames_store_day_unique" UNIQUE("store_id","so_date")
);
--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD CONSTRAINT "audit_stock_opnames_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD CONSTRAINT "audit_stock_opnames_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD CONSTRAINT "audit_stock_opnames_auditor_user_id_users_id_fk" FOREIGN KEY ("auditor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD CONSTRAINT "audit_stock_opnames_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_stock_opnames" ADD CONSTRAINT "audit_stock_opnames_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_stock_opnames_date_idx" ON "audit_stock_opnames" USING btree ("so_date");
CREATE TABLE "store_closing_hold_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_closing_hold_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "store_closing_hold_template" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "open_statement_hold_category_id" integer;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD COLUMN "open_statement_hold_category" text;--> statement-breakpoint
ALTER TABLE "store_closing_hold_template" ADD CONSTRAINT "store_closing_hold_template_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ADD CONSTRAINT "store_closing_tasks_open_statement_hold_category_id_store_closing_hold_categories_id_fk" FOREIGN KEY ("open_statement_hold_category_id") REFERENCES "public"."store_closing_hold_categories"("id") ON DELETE set null ON UPDATE no action;
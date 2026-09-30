CREATE TYPE "public"."store_status" AS ENUM('active', 'close', 'ready_to_open');--> statement-breakpoint
CREATE TABLE "store_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"from_status" "store_status",
	"to_status" "store_status" NOT NULL,
	"changed_by" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "dept_code" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "status" "store_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "status_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "store_status_history" ADD CONSTRAINT "store_status_history_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_status_history" ADD CONSTRAINT "store_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_status_history_store_idx" ON "store_status_history" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_dept_code_unique" UNIQUE("dept_code");
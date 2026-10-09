CREATE TYPE "public"."impact_follow_up_status" AS ENUM('needs_fix', 'not_done', 'verified');--> statement-breakpoint
CREATE TABLE "impact_visit_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"visit_id" integer NOT NULL,
	"item_id" text NOT NULL,
	"status" "impact_follow_up_status" NOT NULL,
	"note" text,
	"checked_by" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "impact_visit_checks" ADD CONSTRAINT "impact_visit_checks_visit_id_impact_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."impact_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_visit_checks" ADD CONSTRAINT "impact_visit_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "impact_visit_checks_latest_idx" ON "impact_visit_checks" USING btree ("visit_id","item_id","checked_at","id");
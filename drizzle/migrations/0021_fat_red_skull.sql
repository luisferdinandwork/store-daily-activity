CREATE TABLE "setoran_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"reason" text NOT NULL,
	"before_received" numeric(12, 2) NOT NULL,
	"before_stored" numeric(12, 2) NOT NULL,
	"before_unpaid" numeric(12, 2) NOT NULL,
	"after_received" numeric(12, 2) NOT NULL,
	"after_stored" numeric(12, 2) NOT NULL,
	"after_unpaid" numeric(12, 2) NOT NULL,
	"was_verified" boolean DEFAULT false NOT NULL,
	"cascade" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrected_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setoran_corrections" ADD CONSTRAINT "setoran_corrections_task_id_setoran_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."setoran_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_corrections" ADD CONSTRAINT "setoran_corrections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoran_corrections" ADD CONSTRAINT "setoran_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setoran_corrections_store_idx" ON "setoran_corrections" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "setoran_corrections_task_idx" ON "setoran_corrections" USING btree ("task_id");
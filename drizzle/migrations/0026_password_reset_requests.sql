-- "Lupa password": stores get their shared mailbox (stores.email, IT fills it
-- in / imports it) and a password_reset_requests table for the NIK + store-email
-- request -> IT verifies -> one-time link flow (lib/db/utils/password-reset.ts).
-- Additive only (new table + nullable column) — safe to run before deploying.

CREATE TABLE "password_reset_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nik" text NOT NULL,
	"store_id" integer,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_ip" text,
	"user_agent" text,
	"token_hash" text,
	"token_expires_at" timestamp,
	"link_sent_at" timestamp,
	"link_sent_by" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"completed_ip" text,
	"rejected_at" timestamp,
	"rejected_by" text,
	"reject_reason" text,
	"last_email_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_link_sent_by_users_id_fk" FOREIGN KEY ("link_sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_requests_user_idx" ON "password_reset_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_requests_status_idx" ON "password_reset_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_requests_token_hash_unique" ON "password_reset_requests" USING btree ("token_hash");
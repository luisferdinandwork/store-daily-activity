ALTER TABLE "email_templates" ADD COLUMN "mode" text DEFAULT 'html' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "fields" jsonb;
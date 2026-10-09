CREATE TABLE "sales_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"receipt_number" text NOT NULL,
	"image_urls" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_returns_store_created_idx" ON "sales_returns" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_returns_created_idx" ON "sales_returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sales_returns_receipt_idx" ON "sales_returns" USING btree ("receipt_number");
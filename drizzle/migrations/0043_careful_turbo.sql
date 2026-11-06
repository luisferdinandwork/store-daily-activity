CREATE TABLE "warehouse_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_codes_code_unique" UNIQUE("code")
);

-- Hitung Kas Kasir: one count per store/day per SOP session (Pagi, Siang 1,
-- Siang 2, Sore, Malam) instead of one per store/day. Rows recorded before
-- this were the single daily count done by the opening shift → 'pagi'. The
-- default stays so an app build from before sessions (which doesn't send one)
-- keeps saving its once-a-day count as Pagi while the new build rolls out.
CREATE TYPE "public"."cash_count_session" AS ENUM('pagi', 'siang_1', 'siang_2', 'sore', 'malam');--> statement-breakpoint
ALTER TABLE "store_cash_counts" DROP CONSTRAINT "store_cash_counts_store_date_unique";--> statement-breakpoint
ALTER TABLE "store_cash_counts" ADD COLUMN "session" "cash_count_session" DEFAULT 'pagi' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_cash_counts" ADD CONSTRAINT "store_cash_counts_store_date_session_unique" UNIQUE("store_id","date","session");

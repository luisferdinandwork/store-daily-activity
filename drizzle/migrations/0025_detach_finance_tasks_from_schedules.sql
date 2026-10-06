-- Ops "Delete schedule → delete everything, including history" removes a month's
-- schedules, attendance and task progress, but the money records Finance reviews
-- stay: they are unlinked from the deleted day instead (lib/schedule-utils.ts,
-- removeSchedulesWithin). setoran_tasks.schedule_id is already nullable (0022);
-- this does the same for the cek uang modal and store closing rows.
-- Only relaxes a constraint — no data changes, safe to run before deploying.

ALTER TABLE "cek_uang_modal_tasks" ALTER COLUMN "schedule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "store_closing_tasks" ALTER COLUMN "schedule_id" DROP NOT NULL;

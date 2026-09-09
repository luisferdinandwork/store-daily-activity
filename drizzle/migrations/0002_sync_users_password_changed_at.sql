-- Custom SQL migration file, put your code below! --

-- Schema drift fix: `users.password_changed_at` (added for the 90-day
-- password-change nudge) was declared in lib/db/schema but never reached this
-- database — every query that SELECTs the whole `users` row (e.g.
-- getMonthlySchedule) was failing with "column users.password_changed_at does
-- not exist". Backfill existing rows with now() so NOT NULL is satisfied.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp DEFAULT now() NOT NULL;

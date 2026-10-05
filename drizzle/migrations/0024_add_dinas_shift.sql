-- Dinas (D) — working outside any store.
--
-- Scheduled like a shift so it shows on the roster, but it has no hours and no
-- shift_tasks rows (nothing to do in a store). Scheduling it records the
-- employee's attendance as "dinas" automatically (lib/schedule-utils.ts).
-- Idempotent: an existing 'dinas' row is left untouched.

INSERT INTO "shifts" ("code", "label", "description", "start_time", "end_time", "accent", "icon", "breaks", "sort_order")
VALUES
  ('dinas', 'Dinas', 'Dinas — bekerja di luar toko (tanpa task, absensi tercatat otomatis)', NULL, NULL, 'slate', 'clock', '[]'::jsonb, 60)
ON CONFLICT ("code") DO NOTHING;

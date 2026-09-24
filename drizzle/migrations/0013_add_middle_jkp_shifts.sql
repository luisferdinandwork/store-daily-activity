-- Middle (M) and Jam Kerja Pendek (JP / JS) shifts.
--
--   middle       12:00–20:00  briefing, grooming, serah terima only
--   jkp_morning  08:30–14:30  JKP Pagi  — same tasks as morning (copied below)
--   jkp_evening  16:00–22:00  JKP Siang — same tasks as evening (copied below)
--
-- Code treats jkp_morning / jkp_evening as morning / evening for store-level
-- task rows and gates (SHIFT_BASE_CODE in lib/shift-tasks.ts). Idempotent:
-- existing shift rows / assignments are left untouched.

INSERT INTO "shifts" ("code", "label", "description", "start_time", "end_time", "accent", "icon", "breaks", "sort_order")
VALUES
  ('middle',      'Middle',    'Middle shift 12.00–20.00 (briefing, grooming, serah terima)', '12:00:00', '20:00:00', 'emerald', 'clock',   '[{"type":"lunch","label":"Lunch","accent":"emerald"}]'::jsonb, 15),
  ('jkp_morning', 'JKP Pagi',  'Jam Kerja Pendek pagi 08.30–14.30 (tasks shift pagi)',          '08:30:00', '14:30:00', 'amber',   'sunrise', '[{"type":"lunch","label":"Lunch","accent":"amber"}]'::jsonb,   40),
  ('jkp_evening', 'JKP Siang', 'Jam Kerja Pendek siang 16.00–22.00 (tasks shift siang)',        '16:00:00', '22:00:00', 'violet',  'coffee',  '[{"type":"dinner","label":"Dinner","accent":"violet"}]'::jsonb, 50)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- JKP Pagi / JKP Siang: copy the live morning / evening task config as IT has
-- it today (required, fixed order, sort order).
INSERT INTO "shift_tasks" ("shift_id", "task_definition_id", "is_required", "is_sequenced", "is_active", "sort_order")
SELECT target.id, st."task_definition_id", st."is_required", st."is_sequenced", st."is_active", st."sort_order"
FROM "shift_tasks" st
JOIN "shifts" base ON base.id = st."shift_id"
JOIN "shifts" target ON (base.code, target.code) IN (('morning', 'jkp_morning'), ('evening', 'jkp_evening'))
ON CONFLICT ON CONSTRAINT "shift_tasks_shift_task_unique" DO NOTHING;
--> statement-breakpoint

-- Middle: grooming → briefing → serah terima, all anytime (not fixed order).
INSERT INTO "shift_tasks" ("shift_id", "task_definition_id", "is_required", "is_sequenced", "is_active", "sort_order")
SELECT s.id, td.id, true, false, true, v.sort_order
FROM "shifts" s
JOIN (VALUES ('grooming', 10), ('briefing', 20), ('serah_terima', 30)) AS v(code, sort_order) ON true
JOIN "task_definitions" td ON td.code = v.code
WHERE s.code = 'middle'
ON CONFLICT ON CONSTRAINT "shift_tasks_shift_task_unique" DO NOTHING;

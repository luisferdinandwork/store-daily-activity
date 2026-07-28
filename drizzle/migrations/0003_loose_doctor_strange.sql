ALTER TABLE "shift_tasks" ADD COLUMN "is_sequenced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- One-time bootstrap: mark the default fixed-order tasks as sequenced for
-- every shift they're already assigned to, so existing shift_tasks rows
-- (created before this column existed) don't silently lose the priority
-- order on migrate. IT can add/remove/reorder from OPS → Shift & Tasks →
-- Fixed Order after this.
UPDATE "shift_tasks" AS st
SET "is_sequenced" = true
FROM "task_definitions" AS td
WHERE st.task_definition_id = td.id
  AND td.code IN ('store_front', 'setoran', 'store_opening', 'cek_uang_modal', 'cek_bin', 'grooming');
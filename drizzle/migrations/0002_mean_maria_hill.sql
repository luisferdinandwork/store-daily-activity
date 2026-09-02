-- Item Return / Item Dropping tasks become ONE row per (store, day), shared
-- by every shift. Collapse any existing per-shift duplicates first so the new
-- UNIQUE(store_id, date) constraint can be added on a live DB:
--   1. drop entries on a non-surviving task that duplicate one the surviving
--      task already has (transfer_order_id is unique),
--   2. re-parent the rest to the earliest (surviving) task,
--   3. delete the now-empty duplicate tasks.

-- ── item_return_tasks ──────────────────────────────────────────────────────
DELETE FROM item_return_entries e
USING item_return_tasks t,
     (SELECT store_id, date::date AS d, MIN(id) AS keep_id
        FROM item_return_tasks GROUP BY store_id, date::date) k
WHERE e.task_id = t.id
  AND t.store_id = k.store_id AND t.date::date = k.d AND t.id <> k.keep_id
  AND e.transfer_order_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM item_return_entries e2
              WHERE e2.task_id = k.keep_id AND e2.transfer_order_id = e.transfer_order_id);
--> statement-breakpoint
UPDATE item_return_entries e
SET task_id = k.keep_id
FROM item_return_tasks t,
     (SELECT store_id, date::date AS d, MIN(id) AS keep_id
        FROM item_return_tasks GROUP BY store_id, date::date) k
WHERE e.task_id = t.id
  AND t.store_id = k.store_id AND t.date::date = k.d AND t.id <> k.keep_id;
--> statement-breakpoint
DELETE FROM item_return_tasks t
USING (SELECT store_id, date::date AS d, MIN(id) AS keep_id
         FROM item_return_tasks GROUP BY store_id, date::date) k
WHERE t.store_id = k.store_id AND t.date::date = k.d AND t.id <> k.keep_id;
--> statement-breakpoint

-- ── item_dropping_tasks ────────────────────────────────────────────────────
DELETE FROM item_dropping_entries e
USING item_dropping_tasks t,
     (SELECT store_id, date::date AS d, MIN(id) AS keep_id
        FROM item_dropping_tasks GROUP BY store_id, date::date) k
WHERE e.task_id = t.id
  AND t.store_id = k.store_id AND t.date::date = k.d AND t.id <> k.keep_id
  AND e.transfer_order_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM item_dropping_entries e2
              WHERE e2.task_id = k.keep_id AND e2.transfer_order_id = e.transfer_order_id);
--> statement-breakpoint
UPDATE item_dropping_entries e
SET task_id = k.keep_id
FROM item_dropping_tasks t,
     (SELECT store_id, date::date AS d, MIN(id) AS keep_id
        FROM item_dropping_tasks GROUP BY store_id, date::date) k
WHERE e.task_id = t.id
  AND t.store_id = k.store_id AND t.date::date = k.d AND t.id <> k.keep_id;
--> statement-breakpoint
DELETE FROM item_dropping_tasks t
USING (SELECT store_id, date::date AS d, MIN(id) AS keep_id
         FROM item_dropping_tasks GROUP BY store_id, date::date) k
WHERE t.store_id = k.store_id AND t.date::date = k.d AND t.id <> k.keep_id;
--> statement-breakpoint

ALTER TABLE "item_dropping_tasks" DROP CONSTRAINT "item_dropping_tasks_store_date_shift_unique";--> statement-breakpoint
ALTER TABLE "item_return_tasks" DROP CONSTRAINT "item_return_tasks_store_date_shift_unique";--> statement-breakpoint
ALTER TABLE "item_dropping_tasks" ADD CONSTRAINT "item_dropping_tasks_store_date_unique" UNIQUE("store_id","date");--> statement-breakpoint
ALTER TABLE "item_return_tasks" ADD CONSTRAINT "item_return_tasks_store_date_unique" UNIQUE("store_id","date");

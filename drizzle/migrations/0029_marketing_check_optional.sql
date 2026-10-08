ALTER TABLE "marketing_check_tasks" ADD COLUMN "has_marketing_check" boolean;--> statement-breakpoint
-- Everything submitted before this choice existed was a full checklist; rows
-- with ticks already started one. Untouched rows stay NULL (not answered yet).
UPDATE "marketing_check_tasks" SET "has_marketing_check" = true
WHERE "status" = 'completed'
   OR "promo_name" OR "promo_period" OR "promo_mechanism"
   OR "random_shoe_items" OR "random_non_shoe_items" OR "sell_tag";

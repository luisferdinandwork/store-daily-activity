-- Perlu Perbaikan no longer makes a NEW request (2026-11-13): Finance sends the SAME request back to PIC 1 as a
-- 'draft', PIC 1 fixes it and sends it to OPS again (lib/db/utils/petty-cash-re-request.ts). Requests sent back
-- under the old flow and never filed again (still 'completed' + 'needs_fix', no re-request pointing at them) become
-- such drafts, so PIC 1 can fix them the new way. Their amount was already given back to the balance when Finance
-- sent them back; a draft left in a period that has ended moves to the period in use when PIC 1 sends it.
-- Old-style re-requests (rows with re_request_of_id) and their originals are left as they are.
UPDATE "petty_cash_transactions" AS t
SET "status" = 'draft', "is_re_request" = true, "updated_at" = now()
WHERE t."status" = 'completed'
  AND t."finance_review" = 'needs_fix'
  AND NOT EXISTS (
    SELECT 1 FROM "petty_cash_transactions" AS r WHERE r."re_request_of_id" = t."id"
  );

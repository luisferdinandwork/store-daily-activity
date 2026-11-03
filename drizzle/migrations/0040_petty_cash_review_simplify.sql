-- The in-place "Perbaiki & kirim ulang" fix is retired: Finance only reviews once a month, so a request marked
-- Perlu Perbaikan is filed again next month as a Re-request instead. A request PIC 1 had already corrected and
-- sent back ('resubmitted') goes back to Perlu Perbaikan (it can be re-requested); "Ditolak" stays final.
UPDATE "petty_cash_transactions" SET "finance_review" = 'needs_fix' WHERE "finance_review" = 'resubmitted';

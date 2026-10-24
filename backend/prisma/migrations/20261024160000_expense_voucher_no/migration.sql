ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "voucherNo" TEXT;

UPDATE "Expense"
SET "voucherNo" = 'EXP-' || UPPER(RIGHT("id", 8))
WHERE "voucherNo" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_voucherNo_key" ON "Expense"("voucherNo");

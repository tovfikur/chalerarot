ALTER TABLE "Expense" ADD COLUMN "capitalized" BOOLEAN NOT NULL DEFAULT false;

-- These rows were already added to PurchaseItem.unitCost and AVCO inventory.
-- Preserve the expense and money movement records while classifying them so
-- they are not deducted a second time as operating expenses.
UPDATE "Expense"
SET "capitalized" = true
WHERE "category" = 'loading'
  AND "note" LIKE '[ধরন: ল্যান্ডিং] ক্রয় #%';

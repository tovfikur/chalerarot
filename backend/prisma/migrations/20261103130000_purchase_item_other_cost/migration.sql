-- Preserve the per-entered-unit landing cost separately from the final landed
-- unit cost stored on PurchaseItem.unitCost.
ALTER TABLE "PurchaseItem"
ADD COLUMN IF NOT EXISTS "otherCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

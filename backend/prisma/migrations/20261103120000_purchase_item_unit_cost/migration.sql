-- PurchaseItem.unitCost is used by the Prisma schema and purchase route to
-- persist landed inventory cost. Earlier deployments may have missed it.
ALTER TABLE "PurchaseItem"
ADD COLUMN IF NOT EXISTS "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

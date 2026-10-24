-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "code" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "code" TEXT;

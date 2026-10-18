-- AlterTable
ALTER TABLE "CustomerPayment" ADD COLUMN     "returnId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "damagedQtyKg" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VendorPayment" ADD COLUMN     "returnId" TEXT;

-- CreateTable
CREATE TABLE "ProductReturn" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT,
    "kind" TEXT NOT NULL,
    "saleId" TEXT,
    "purchaseId" TEXT,
    "customerId" TEXT,
    "vendorId" TEXT,
    "date" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "settlement" TEXT NOT NULL DEFAULT 'credit',
    "refundAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleItemId" TEXT,
    "purchaseItemId" TEXT,
    "productId" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "enteredQty" DOUBLE PRECISION NOT NULL,
    "qtyKg" DOUBLE PRECISION NOT NULL,
    "goodKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damagedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "damageReason" TEXT,
    "note" TEXT,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProductReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductReturn_returnNo_key" ON "ProductReturn"("returnNo");

-- CreateIndex
CREATE INDEX "ProductReturn_kind_idx" ON "ProductReturn"("kind");

-- CreateIndex
CREATE INDEX "ProductReturn_saleId_idx" ON "ProductReturn"("saleId");

-- CreateIndex
CREATE INDEX "ProductReturn_purchaseId_idx" ON "ProductReturn"("purchaseId");

-- CreateIndex
CREATE INDEX "ProductReturn_date_idx" ON "ProductReturn"("date");

-- CreateIndex
CREATE INDEX "ProductReturnItem_returnId_idx" ON "ProductReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "ProductReturnItem_productId_idx" ON "ProductReturnItem"("productId");

-- AddForeignKey
ALTER TABLE "ProductReturn" ADD CONSTRAINT "ProductReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReturn" ADD CONSTRAINT "ProductReturn_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReturnItem" ADD CONSTRAINT "ProductReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ProductReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReturnItem" ADD CONSTRAINT "ProductReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Sale" ADD COLUMN "advanceAllocationControlled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Purchase" ADD COLUMN "advanceAllocationControlled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerPayment" ADD COLUMN "allocationLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VendorPayment" ADD COLUMN "allocationLocked" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CustomerPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerPaymentAllocation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "VendorPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorPaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerPaymentAllocation_paymentId_saleId_key" ON "CustomerPaymentAllocation"("paymentId", "saleId");
CREATE INDEX "CustomerPaymentAllocation_saleId_idx" ON "CustomerPaymentAllocation"("saleId");
CREATE UNIQUE INDEX "VendorPaymentAllocation_paymentId_purchaseId_key" ON "VendorPaymentAllocation"("paymentId", "purchaseId");
CREATE INDEX "VendorPaymentAllocation_purchaseId_idx" ON "VendorPaymentAllocation"("purchaseId");

ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CustomerPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorPaymentAllocation" ADD CONSTRAINT "VendorPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "VendorPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorPaymentAllocation" ADD CONSTRAINT "VendorPaymentAllocation_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

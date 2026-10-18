-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "invoiceNo" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "invoiceNo" TEXT;

-- CreateTable
CREATE TABLE "Sequence" (
    "key" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_invoiceNo_key" ON "Purchase"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_invoiceNo_key" ON "Sale"("invoiceNo");


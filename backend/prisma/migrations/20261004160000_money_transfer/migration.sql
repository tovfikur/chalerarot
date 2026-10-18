-- AlterTable
ALTER TABLE "MoneyMovement" ADD COLUMN     "transferId" TEXT;

-- CreateTable
CREATE TABLE "MoneyTransfer" (
    "id" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL,
    "fromMethod" TEXT NOT NULL,
    "toMethod" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoneyTransfer_transferNo_key" ON "MoneyTransfer"("transferNo");

-- CreateIndex
CREATE INDEX "MoneyTransfer_date_idx" ON "MoneyTransfer"("date");

-- CreateIndex
CREATE INDEX "MoneyMovement_transferId_idx" ON "MoneyMovement"("transferId");

-- AddForeignKey
ALTER TABLE "MoneyMovement" ADD CONSTRAINT "MoneyMovement_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "MoneyTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


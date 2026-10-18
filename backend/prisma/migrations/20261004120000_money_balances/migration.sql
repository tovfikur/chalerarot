-- CreateTable
CREATE TABLE "MoneyAccount" (
    "method" TEXT NOT NULL,
    "openingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyAccount_pkey" PRIMARY KEY ("method")
);

-- CreateTable
CREATE TABLE "MoneyMovement" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoneyMovement_method_idx" ON "MoneyMovement"("method");

-- CreateIndex
CREATE INDEX "MoneyMovement_date_idx" ON "MoneyMovement"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyMovement_sourceType_sourceId_key" ON "MoneyMovement"("sourceType", "sourceId");


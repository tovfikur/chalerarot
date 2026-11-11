CREATE TABLE "Labourer" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Labourer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LabourCost" (
  "id" TEXT NOT NULL,
  "labourerId" TEXT NOT NULL,
  "pricePerBag" DOUBLE PRECISION NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "direction" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "date" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabourCost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LabourPayment" (
  "id" TEXT NOT NULL,
  "labourerId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "date" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabourPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Labourer_nameKey_key" ON "Labourer"("nameKey");
CREATE INDEX "LabourCost_labourerId_date_idx" ON "LabourCost"("labourerId", "date");
CREATE INDEX "LabourCost_date_idx" ON "LabourCost"("date");
CREATE INDEX "LabourPayment_labourerId_date_idx" ON "LabourPayment"("labourerId", "date");
CREATE INDEX "LabourPayment_accountId_date_idx" ON "LabourPayment"("accountId", "date");
ALTER TABLE "LabourCost" ADD CONSTRAINT "LabourCost_labourerId_fkey" FOREIGN KEY ("labourerId") REFERENCES "Labourer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabourPayment" ADD CONSTRAINT "LabourPayment_labourerId_fkey" FOREIGN KEY ("labourerId") REFERENCES "Labourer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabourPayment" ADD CONSTRAINT "LabourPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

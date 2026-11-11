ALTER TABLE "LabourCost" ADD COLUMN "advanceApplied" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "LabourAdvance" (
  "id" TEXT NOT NULL,
  "labourerId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "appliedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "date" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabourAdvance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LabourAdvance_labourerId_date_idx" ON "LabourAdvance"("labourerId", "date");
CREATE INDEX "LabourAdvance_accountId_date_idx" ON "LabourAdvance"("accountId", "date");
ALTER TABLE "LabourAdvance" ADD CONSTRAINT "LabourAdvance_labourerId_fkey" FOREIGN KEY ("labourerId") REFERENCES "Labourer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabourAdvance" ADD CONSTRAINT "LabourAdvance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

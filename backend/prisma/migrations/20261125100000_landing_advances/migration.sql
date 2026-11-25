CREATE TABLE "LandingAdvance" (
    "id" TEXT NOT NULL,
    "landingType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingAdvance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LandingAdvance_landingType_date_idx" ON "LandingAdvance"("landingType", "date");
CREATE INDEX "LandingAdvance_accountId_date_idx" ON "LandingAdvance"("accountId", "date");
ALTER TABLE "LandingAdvance" ADD CONSTRAINT "LandingAdvance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

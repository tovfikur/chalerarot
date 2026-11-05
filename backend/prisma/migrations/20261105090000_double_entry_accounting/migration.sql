CREATE TABLE "ChartAccount" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "system" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChartAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChartAccount_code_key" ON "ChartAccount"("code");
CREATE UNIQUE INDEX "ChartAccount_name_key" ON "ChartAccount"("name");
CREATE INDEX "ChartAccount_type_active_idx" ON "ChartAccount"("type", "active");

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL,
  "entryNo" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "memo" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'manual',
  "sourceId" TEXT,
  "sourceRef" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JournalEntry_entryNo_key" ON "JournalEntry"("entryNo");
CREATE INDEX "JournalEntry_date_idx" ON "JournalEntry"("date");
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");
CREATE INDEX "JournalEntry_active_idx" ON "JournalEntry"("active");

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");
ALTER TABLE "ChartAccount" ADD COLUMN "moneyAccountId" TEXT;
CREATE UNIQUE INDEX "ChartAccount_moneyAccountId_key" ON "ChartAccount"("moneyAccountId");
ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_moneyAccountId_fkey" FOREIGN KEY ("moneyAccountId") REFERENCES "MoneyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

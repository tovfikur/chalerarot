-- Evolve MoneyAccount from "one row per payment method" into real, configurable
-- money accounts (Main Cash, BRAC Bank, bKash Merchant, ...). Existing rows keep
-- their identity: the old method value becomes the new account id, so every
-- historical MoneyMovement keeps pointing at the right account.

ALTER TABLE "MoneyAccount" RENAME COLUMN "method" TO "legacyMethod";
ALTER TABLE "MoneyAccount" RENAME COLUMN "openingAmount" TO "openingBalance";
ALTER TABLE "MoneyAccount" ADD COLUMN "id" TEXT;
ALTER TABLE "MoneyAccount" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MoneyAccount" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE "MoneyAccount" ADD COLUMN "openingDate" TEXT;
ALTER TABLE "MoneyAccount" ADD COLUMN "bankName" TEXT;
ALTER TABLE "MoneyAccount" ADD COLUMN "accountNumber" TEXT;
ALTER TABLE "MoneyAccount" ADD COLUMN "branch" TEXT;
ALTER TABLE "MoneyAccount" ADD COLUMN "mobileNumber" TEXT;
ALTER TABLE "MoneyAccount" ADD COLUMN "note" TEXT;
ALTER TABLE "MoneyAccount" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "MoneyAccount" SET "id" = "legacyMethod" WHERE "id" IS NULL;
UPDATE "MoneyAccount" SET "type" = "legacyMethod";
UPDATE "MoneyAccount" SET "name" = CASE "legacyMethod"
  WHEN 'cash' THEN 'Main Cash'
  WHEN 'bkash' THEN 'bKash'
  WHEN 'nagad' THEN 'Nagad'
  WHEN 'bank' THEN 'Main Bank'
  ELSE "legacyMethod" END;
-- Opening baseline is dated from the account's own first movement so period
-- balances stay correct; falls back to today when there is no movement yet.
UPDATE "MoneyAccount" a SET "openingDate" = COALESCE(
  (SELECT MIN(m."date") FROM "MoneyMovement" m WHERE m."method" = a."legacyMethod"),
  to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD'));

ALTER TABLE "MoneyAccount" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "MoneyAccount" DROP CONSTRAINT "MoneyAccount_pkey";
ALTER TABLE "MoneyAccount" ADD CONSTRAINT "MoneyAccount_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "MoneyAccount_legacyMethod_key" ON "MoneyAccount"("legacyMethod");
CREATE INDEX "MoneyAccount_type_idx" ON "MoneyAccount"("type");
CREATE INDEX "MoneyAccount_active_idx" ON "MoneyAccount"("active");

-- Every existing movement keeps its history and gains its account reference.
ALTER TABLE "MoneyMovement" ADD COLUMN "moneyAccountId" TEXT;
UPDATE "MoneyMovement" SET "moneyAccountId" = "method"
  WHERE "moneyAccountId" IS NULL
    AND EXISTS (SELECT 1 FROM "MoneyAccount" a WHERE a."legacyMethod" = "MoneyMovement"."method");
CREATE INDEX "MoneyMovement_moneyAccountId_date_idx" ON "MoneyMovement"("moneyAccountId", "date");
ALTER TABLE "MoneyMovement" ADD CONSTRAINT "MoneyMovement_moneyAccountId_fkey"
  FOREIGN KEY ("moneyAccountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MoneyTransfer" ADD COLUMN "fromAccountId" TEXT;
ALTER TABLE "MoneyTransfer" ADD COLUMN "toAccountId" TEXT;
UPDATE "MoneyTransfer" SET "fromAccountId" = "fromMethod";
UPDATE "MoneyTransfer" SET "toAccountId" = "toMethod";
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_fromAccountId_fkey"
  FOREIGN KEY ("fromAccountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_toAccountId_fkey"
  FOREIGN KEY ("toAccountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

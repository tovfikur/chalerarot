-- Only the one migrated legacy account per method keeps legacyMethod; any extra
-- cash/bank/bKash/Nagad/Rocket account must be able to store NULL there.
ALTER TABLE "MoneyAccount" ALTER COLUMN "legacyMethod" DROP NOT NULL;

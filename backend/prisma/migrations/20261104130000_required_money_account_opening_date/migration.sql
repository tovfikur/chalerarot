-- Keep legacy accounts usable by assigning a deterministic baseline date from
-- the account's creation timestamp before making the date mandatory.
UPDATE "MoneyAccount"
SET "openingDate" = to_char("createdAt"::date, 'YYYY-MM-DD')
WHERE "openingDate" IS NULL;

ALTER TABLE "MoneyAccount"
ALTER COLUMN "openingDate" SET NOT NULL;

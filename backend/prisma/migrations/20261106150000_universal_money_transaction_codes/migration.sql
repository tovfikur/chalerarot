ALTER TABLE "MoneyMovement" ADD COLUMN "transactionNo" TEXT;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM "MoneyMovement"
)
UPDATE "MoneyMovement" m
SET "transactionNo" = 'TXN-' || LPAD(n.n::text, 6, '0')
FROM numbered n
WHERE n."id" = m."id";

ALTER TABLE "MoneyMovement" ALTER COLUMN "transactionNo" SET NOT NULL;
CREATE UNIQUE INDEX "MoneyMovement_transactionNo_key" ON "MoneyMovement"("transactionNo");

INSERT INTO "Sequence"("key", "last")
SELECT 'TXN', COUNT(*)::int FROM "MoneyMovement"
ON CONFLICT ("key") DO UPDATE SET "last" = GREATEST("Sequence"."last", EXCLUDED."last");

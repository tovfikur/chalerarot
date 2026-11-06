WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM "CustomerPayment"
)
UPDATE "CustomerPayment" p
SET "paymentNo" = 'REC-' || LPAD(n.n::text, 3, '0')
FROM numbered n
WHERE n."id" = p."id";

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM "VendorPayment"
)
UPDATE "VendorPayment" p
SET "paymentNo" = 'PAY-' || LPAD(n.n::text, 3, '0')
FROM numbered n
WHERE n."id" = p."id";

INSERT INTO "Sequence"("key", "last")
SELECT 'REC', COUNT(*)::int FROM "CustomerPayment"
ON CONFLICT ("key") DO UPDATE SET "last" = GREATEST("Sequence"."last", EXCLUDED."last");

INSERT INTO "Sequence"("key", "last")
SELECT 'PAY', COUNT(*)::int FROM "VendorPayment"
ON CONFLICT ("key") DO UPDATE SET "last" = GREATEST("Sequence"."last", EXCLUDED."last");

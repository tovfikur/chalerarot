ALTER TABLE "CustomerPayment" ADD COLUMN "paymentNo" TEXT;
ALTER TABLE "VendorPayment" ADD COLUMN "paymentNo" TEXT;

WITH payment_rows AS (
  SELECT 'customer'::text AS "kind", "id", "createdAt" FROM "CustomerPayment"
  UNION ALL
  SELECT 'vendor'::text AS "kind", "id", "createdAt" FROM "VendorPayment"
), numbered AS (
  SELECT "kind", "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id", "kind") AS n
  FROM payment_rows
)
UPDATE "CustomerPayment" p SET "paymentNo" = 'PAY-' || LPAD(n.n::text, 3, '0')
FROM numbered n WHERE n."kind" = 'customer' AND n."id" = p."id";

WITH payment_rows AS (
  SELECT 'customer'::text AS "kind", "id", "createdAt" FROM "CustomerPayment"
  UNION ALL
  SELECT 'vendor'::text AS "kind", "id", "createdAt" FROM "VendorPayment"
), numbered AS (
  SELECT "kind", "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id", "kind") AS n
  FROM payment_rows
)
UPDATE "VendorPayment" p SET "paymentNo" = 'PAY-' || LPAD(n.n::text, 3, '0')
FROM numbered n WHERE n."kind" = 'vendor' AND n."id" = p."id";

ALTER TABLE "CustomerPayment" ALTER COLUMN "paymentNo" SET NOT NULL;
ALTER TABLE "VendorPayment" ALTER COLUMN "paymentNo" SET NOT NULL;
CREATE UNIQUE INDEX "CustomerPayment_paymentNo_key" ON "CustomerPayment"("paymentNo");
CREATE UNIQUE INDEX "VendorPayment_paymentNo_key" ON "VendorPayment"("paymentNo");

INSERT INTO "Sequence"("key", "last")
SELECT 'PAY', COUNT(*)::int FROM (
  SELECT "id" FROM "CustomerPayment"
  UNION ALL
  SELECT "id" FROM "VendorPayment"
) all_payments
ON CONFLICT ("key") DO UPDATE SET "last" = GREATEST("Sequence"."last", EXCLUDED."last");

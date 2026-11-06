UPDATE "Sequence"
SET "last" = (SELECT COUNT(*)::int FROM "CustomerPayment")
WHERE "key" = 'REC';

UPDATE "Sequence"
SET "last" = (SELECT COUNT(*)::int FROM "VendorPayment")
WHERE "key" = 'PAY';

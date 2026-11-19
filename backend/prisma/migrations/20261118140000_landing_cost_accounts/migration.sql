ALTER TABLE "Expense"
ADD COLUMN IF NOT EXISTS "landingType" TEXT;

-- Keep old linked purchase costs classifiable. The existing single "other"
-- purchase cost is divided evenly between stock-in and stock-out dashboards.
UPDATE "Expense"
SET "landingType" = CASE
  WHEN lower(coalesce("customName", '') || ' ' || coalesce("note", '')) ~ '(transport|পরিবহন)' THEN 'transport'
  WHEN "capitalized" AND coalesce("note", '') LIKE '%#%' THEN 'splitLabour'
  ELSE "landingType"
END
WHERE "landingType" IS NULL;

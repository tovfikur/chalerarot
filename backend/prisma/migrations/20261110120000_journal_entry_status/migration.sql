ALTER TABLE "JournalEntry" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'posted';
UPDATE "JournalEntry" SET "status" = 'cancelled' WHERE "active" = false AND "sourceType" = 'manual';

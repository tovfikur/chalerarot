-- One automatic journal entry per originating source. Multiple manual entries
-- remain allowed because their sourceId is NULL (PostgreSQL unique indexes
-- treat NULL values as distinct).
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key"
ON "JournalEntry"("sourceType", "sourceId");

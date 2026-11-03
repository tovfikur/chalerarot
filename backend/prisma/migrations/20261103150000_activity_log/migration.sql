-- Universal activity log for tracking who did what, and when.
CREATE TABLE "ActivityLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "userName" TEXT NOT NULL,
  "userRole" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "reference" TEXT,
  "amount" DOUBLE PRECISION,
  "summary" TEXT NOT NULL,
  "detail" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");
CREATE INDEX "ActivityLog_entity_createdAt_idx" ON "ActivityLog"("entity", "createdAt");

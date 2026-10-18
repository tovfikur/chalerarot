-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "partyKind" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_read_idx" ON "Notification"("read");

-- CreateIndex
CREATE INDEX "Notification_partyId_idx" ON "Notification"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_refType_refId_occasion_dueDate_key" ON "Notification"("refType", "refId", "occasion", "dueDate");

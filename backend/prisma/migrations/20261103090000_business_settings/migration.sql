CREATE TABLE "BusinessSettings" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "name" TEXT NOT NULL DEFAULT 'চালের আড়ত',
  "address" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "fiscalStartMonth" INTEGER NOT NULL DEFAULT 7,
  "language" TEXT NOT NULL DEFAULT 'bn',
  CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

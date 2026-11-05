-- Preserve the pre-email login identifier so existing users can keep using it.
ALTER TABLE "User" ADD COLUMN "legacyUsername" TEXT;
UPDATE "User" SET "legacyUsername" = "email";
CREATE UNIQUE INDEX "User_legacyUsername_key" ON "User"("legacyUsername");

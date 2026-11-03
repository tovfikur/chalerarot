CREATE TABLE "User" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "phone" TEXT NOT NULL,
 "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
 "role" TEXT NOT NULL DEFAULT 'staff', "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE TABLE "Session" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

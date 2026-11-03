-- Replace the username login identifier with a real email address.
-- The rename preserves existing accounts: whatever was stored in `username`
-- (including legacy non-email values) becomes the email login value.
ALTER TABLE "User" RENAME COLUMN "username" TO "email";
ALTER INDEX "User_username_key" RENAME TO "User_email_key";

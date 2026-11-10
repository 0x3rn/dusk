-- 002_drop_legacy_auth.sql
-- DESTRUCTIVE. Do not run until every existing user has signed in once through Neon Auth
-- (check: SELECT count(*) FROM "User" WHERE "authUserId" IS NULL;  -- must be 0 for real accounts).
--
-- Removes the old home-grown password and Firebase identity data. Password hashes cannot be
-- recovered after this runs.

ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "firebaseUid";
ALTER TABLE "User" DROP COLUMN IF EXISTS "authProvider";
DROP TABLE IF EXISTS "Session";
DROP TYPE IF EXISTS "AuthProvider";

-- 001_neon_auth_identity.sql
-- Additive only: nothing here drops or rewrites existing data.
--
-- Identity moves to Neon Auth (Managed Better Auth). Dusk keeps its own "User" row for
-- product data and links it to neon_auth."user".id through "authUserId".
-- Existing accounts get linked by verified email on their first Neon Auth sign-in.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authUserId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lifetimePurchasedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_authUserId_key" ON "User" ("authUserId");

-- Idempotency ledger for Stripe webhooks: the event id is the primary key.
CREATE TABLE IF NOT EXISTS "StripeEvent" (
  "id"          TEXT         NOT NULL,
  "type"        TEXT         NOT NULL,
  "userId"      TEXT,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

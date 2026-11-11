-- 004_lemonsqueezy.sql
-- ADDITIVE and safe to run more than once. Nothing is dropped or changed in existing columns,
-- so the currently deployed (Stripe) code keeps working until the Lemon Squeezy release is live.
--
-- Run order:  004 (this file) BEFORE deploying the Lemon Squeezy release.
--             006_drop_stripe.sql only AFTER that release is live and verified (destructive).

-- Idempotency ledger for payment webhooks. "id" is the key built by ledgerKeyFor() in
-- lib/billing/lifetime-access.ts; the primary key makes a repeated delivery a no-op.
-- No foreign key to "User" on purpose: payment history must survive an account deletion.
CREATE TABLE IF NOT EXISTS "PaymentEvent" (
  "id"          TEXT         NOT NULL,
  "provider"    TEXT         NOT NULL DEFAULT 'lemonsqueezy',
  "eventName"   TEXT         NOT NULL,
  "orderId"     TEXT         NOT NULL,
  "userId"      TEXT,
  "outcome"     TEXT         NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentEvent_outcome_check"
    CHECK ("outcome" IN ('GRANTED', 'SKIPPED_REFUNDED', 'REFUNDED', 'PARTIAL_REFUND'))
);
CREATE INDEX IF NOT EXISTS "PaymentEvent_orderId_idx" ON "PaymentEvent" ("orderId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_userId_idx" ON "PaymentEvent" ("userId");

-- Lemon Squeezy customer id of the buyer (informational, not unique).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lemonSqueezyCustomerId" TEXT;

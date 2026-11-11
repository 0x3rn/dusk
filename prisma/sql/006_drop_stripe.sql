-- 006_drop_stripe.sql
-- ############################################################################
-- #  DESTRUCTIVE. NOT RUN ANYWHERE. DO NOT RUN until ALL of these are true:  #
-- #   1. 004_lemonsqueezy.sql has been applied to this database.             #
-- #   2. The Lemon Squeezy release is deployed and a real purchase/refund    #
-- #      has been verified end to end.                                       #
-- #   3. You no longer need the old Stripe records (export them first if     #
-- #      you do: SELECT * FROM "StripeEvent"; and "User"."stripeCustomerId").#
-- #  Dropping is permanent. Take a Neon snapshot/branch before running.      #
-- ############################################################################

BEGIN;
DROP TABLE IF EXISTS "StripeEvent";
ALTER TABLE "User" DROP COLUMN IF EXISTS "stripeCustomerId";
COMMIT;

-- 003_rate_limit.sql
-- Additive. Shared, serverless-safe fixed-window rate limiting (an in-memory limiter does not
-- work when every request can land on a different instance).
CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
  "key"         TEXT         NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count"       INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key", "windowStart")
);
CREATE INDEX IF NOT EXISTS "RateLimitBucket_windowStart_idx" ON "RateLimitBucket" ("windowStart");

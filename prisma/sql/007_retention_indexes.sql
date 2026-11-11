-- 007_retention_indexes.sql
-- Additive and safe to run any time and more than once. The retention purge
-- (lib/engine/retention.ts) finds old rows by their creation time; without these indexes every
-- scheduler run would read the whole table to find nothing.
CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx" ON "AuditEvent" ("createdAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_createdAt_idx" ON "NotificationDelivery" ("createdAt");
CREATE INDEX IF NOT EXISTS "ReleaseEvent_createdAt_idx" ON "ReleaseEvent" ("createdAt");

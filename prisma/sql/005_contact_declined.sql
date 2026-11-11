-- 005_contact_declined.sql
-- Additive. A contact who opens their invitation and chooses "Decline" gets this status, so the
-- owner can see the difference between "declined" and "removed by me".
-- Existing rows are untouched (contacts already stored as VERIFIED keep working).
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

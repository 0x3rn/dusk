// lib/engine/retention.ts
// Makes the retention promises in the Privacy page true (lib/site-docs.tsx, "How long we keep your
// information"). Run from the scheduler tick, after the sweep. It deletes:
//
//   - AuditEvent rows older than 12 months ("security and activity records")
//   - NotificationDelivery rows older than 12 months ("message records")
//   - ReleaseEvent rows of an estate whose release was more than 12 months ago ("delivery records
//     are kept for 12 months after the release")
//   - RateLimitBucket windows that can no longer matter (not personal data, just housekeeping)
//
// and nothing else. Conservative by design:
//   - Anything tied to a release inside its 12 months is kept. A user whose estate was released
//     less than 12 months ago keeps ALL their audit and message records for now.
//   - ReleaseEvent rows of an estate that has not been released (a live or paused plan, a hold, a
//     verification in progress) are never deleted, whatever their age.
//   - A release event whose link has not expired yet is never deleted.
//
// Safe to run twice, late, or at the same time as itself:
//   - rows are deleted in batches (default 500 per statement) up to a per-run cap, so one run can
//     never lock a table for long and a backlog is cleared over several runs;
//   - a transaction-scoped Postgres advisory lock makes an overlapping run skip instead of racing;
//   - each batch locks its rows with SKIP LOCKED;
//   - deleting a row twice is a no-op, so a repeat run just finds less to do.
// `dryRun` counts what a real run would delete and changes nothing.
//
// The report holds counts only. Never put row contents, emails or ids in it or in logs.
import type { PrismaClient } from "@prisma/client";
import { RATE_LIMIT_POLICIES } from "../security/http-hardening";

/** The Privacy page promises 12 months for activity records and for delivery records after release. */
export const RETENTION_MONTHS = 12;
export const DEFAULT_BATCH_SIZE = 500;
export const DEFAULT_MAX_ROWS_PER_TABLE = 5_000;
const MAX_BATCH_SIZE = 5_000;
const MAX_ROWS_PER_TABLE_LIMIT = 1_000_000;
const HOUR_MS = 3_600_000;

/** Arbitrary constant, different from the sweep's lock (727_274), so a purge never blocks a sweep. */
const RETENTION_LOCK_KEY = 727_275;

export type RetentionTarget =
  | "auditEvents"
  | "notificationDeliveries"
  | "releaseEvents"
  | "rateLimitBuckets";

const TARGETS: readonly RetentionTarget[] = [
  "auditEvents",
  "notificationDeliveries",
  "releaseEvents",
  "rateLimitBuckets",
];

export interface RetentionCutoffs {
  /** Rows created before this moment are past the 12 months. Exactly this moment is kept. */
  retention: Date;
  /** Rate-limit windows that started before this can no longer affect any limit. */
  rateLimit: Date;
  /** The moment of the run. A release link that expires after it is still usable. */
  now: Date;
}

export interface RetentionOptions {
  now?: Date;
  /** Count what would be deleted, change nothing. */
  dryRun?: boolean;
  /** Rows per DELETE statement. */
  batchSize?: number;
  /** Most rows one run deletes per table. A backlog is cleared over several runs. */
  maxRowsPerTable?: number;
}

export type RetentionCounts = Record<RetentionTarget, number>;

export type RetentionReport =
  | { skipped: true }
  | {
      skipped: false;
      dryRun: boolean;
      /** Rows deleted (or, in a dry run, rows that would be deleted). */
      counts: RetentionCounts;
      /** Tables where the per-run cap was reached, so a later run may find more. */
      capped: RetentionTarget[];
    };

/** What the purge needs from a database. The Postgres version is below; tests use a fake. */
export interface RetentionStore {
  /** Deletes up to `limit` eligible rows and returns how many were deleted. */
  deleteBatch(target: RetentionTarget, cutoffs: RetentionCutoffs, limit: number): Promise<number>;
  /** Counts up to `limit` eligible rows without changing anything. */
  countEligible(target: RetentionTarget, cutoffs: RetentionCutoffs, limit: number): Promise<number>;
}

/** Runs `fn` while holding the retention lock, or returns null when another run already holds it. */
export type RetentionLockRunner = <T>(fn: (store: RetentionStore) => Promise<T>) => Promise<T | null>;

/**
 * `date` minus whole calendar months, in UTC, keeping the time of day. When the target month is
 * shorter the day is clamped (31 March minus 1 month is 28 or 29 February, never 3 March).
 */
export function subtractMonthsUtc(date: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 0) throw new RangeError("months must be a whole number, 0 or more.");
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() - months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12;
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCFullYear(year, month, Math.min(date.getUTCDate(), daysInTargetMonth));
  return result;
}

/** Rate-limit windows are at most an hour long; keep two of the longest, and never less than a day. */
export function rateLimitHorizonMs(): number {
  const longest = Math.max(...Object.values(RATE_LIMIT_POLICIES).map((p) => p.windowMs));
  return Math.max(2 * longest, 24 * HOUR_MS);
}

export function computeCutoffs(now: Date): RetentionCutoffs {
  return {
    now,
    retention: subtractMonthsUtc(now, RETENTION_MONTHS),
    rateLimit: new Date(now.getTime() - rateLimitHorizonMs()),
  };
}

function assertPositiveInt(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be a whole number between 1 and ${max}.`);
  }
}

/** The purge itself, over any store. Pure orchestration: batching, caps, dry run. */
export async function purgeWithStore(store: RetentionStore, options: RetentionOptions = {}): Promise<Exclude<RetentionReport, { skipped: true }>> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const cap = options.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE;
  assertPositiveInt("batchSize", batchSize, MAX_BATCH_SIZE);
  assertPositiveInt("maxRowsPerTable", cap, MAX_ROWS_PER_TABLE_LIMIT);
  const dryRun = options.dryRun ?? false;
  const cutoffs = computeCutoffs(options.now ?? new Date());

  const counts: RetentionCounts = {
    auditEvents: 0,
    notificationDeliveries: 0,
    releaseEvents: 0,
    rateLimitBuckets: 0,
  };
  const capped: RetentionTarget[] = [];

  for (const target of TARGETS) {
    if (dryRun) {
      counts[target] = await store.countEligible(target, cutoffs, cap);
      if (counts[target] >= cap) capped.push(target);
      continue;
    }
    let total = 0;
    while (total < cap) {
      const limit = Math.min(batchSize, cap - total);
      const deleted = await store.deleteBatch(target, cutoffs, limit);
      total += deleted;
      // A short batch means nothing eligible is left.
      if (deleted < limit) break;
    }
    counts[target] = total;
    if (total >= cap) capped.push(target);
  }
  return { skipped: false, dryRun, counts, capped };
}

/** Same as purgeWithStore, but only one run at a time. A run that finds the lock taken is skipped. */
export async function runPurge(withLock: RetentionLockRunner, options: RetentionOptions = {}): Promise<RetentionReport> {
  const report = await withLock((store) => purgeWithStore(store, options));
  return report ?? { skipped: true };
}

// ---------------------------------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------------------------------

type Tx = Pick<PrismaClient, "$executeRaw" | "$queryRaw">;

// A user whose estate was released inside the window keeps every audit and message record.
// (A RELEASED schedule always has releasedAt; a missing one is treated as "recent", the safe side.)
async function deleteAudit(tx: Tx, c: RetentionCutoffs, limit: number): Promise<number> {
  return tx.$executeRaw`
    DELETE FROM "AuditEvent" WHERE "id" IN (
      SELECT a."id" FROM "AuditEvent" a
      WHERE a."createdAt" < ${c.retention}
        AND NOT EXISTS (
          SELECT 1 FROM "CheckInSchedule" s
          WHERE s."userId" = a."userId" AND s."state" = 'RELEASED'
            AND (s."releasedAt" IS NULL OR s."releasedAt" >= ${c.retention}))
      ORDER BY a."createdAt" ASC, a."id" ASC
      LIMIT ${limit}
      FOR UPDATE OF a SKIP LOCKED)`;
}

async function deleteNotifications(tx: Tx, c: RetentionCutoffs, limit: number): Promise<number> {
  return tx.$executeRaw`
    DELETE FROM "NotificationDelivery" WHERE "id" IN (
      SELECT n."id" FROM "NotificationDelivery" n
      WHERE n."createdAt" < ${c.retention}
        AND NOT EXISTS (
          SELECT 1 FROM "CheckInSchedule" s
          WHERE s."userId" = n."userId" AND s."state" = 'RELEASED'
            AND (s."releasedAt" IS NULL OR s."releasedAt" >= ${c.retention}))
      ORDER BY n."createdAt" ASC, n."id" ASC
      LIMIT ${limit}
      FOR UPDATE OF n SKIP LOCKED)`;
}

async function deleteReleaseEvents(tx: Tx, c: RetentionCutoffs, limit: number): Promise<number> {
  return tx.$executeRaw`
    DELETE FROM "ReleaseEvent" WHERE "id" IN (
      SELECT e."id" FROM "ReleaseEvent" e
      JOIN "CheckInSchedule" s ON s."id" = e."scheduleId"
      WHERE s."state" = 'RELEASED' AND s."releasedAt" IS NOT NULL AND s."releasedAt" < ${c.retention}
        AND e."createdAt" < ${c.retention}
        AND (e."tokenExpiresAt" IS NULL OR e."tokenExpiresAt" < ${c.now})
      ORDER BY e."createdAt" ASC, e."id" ASC
      LIMIT ${limit}
      FOR UPDATE OF e SKIP LOCKED)`;
}

async function deleteRateLimit(tx: Tx, c: RetentionCutoffs, limit: number): Promise<number> {
  return tx.$executeRaw`
    DELETE FROM "RateLimitBucket" WHERE ("key", "windowStart") IN (
      SELECT b."key", b."windowStart" FROM "RateLimitBucket" b
      WHERE b."windowStart" < ${c.rateLimit}
      ORDER BY b."windowStart" ASC
      LIMIT ${limit}
      FOR UPDATE OF b SKIP LOCKED)`;
}

async function countRows(rows: Promise<Array<{ n: number }>>): Promise<number> {
  const result = await rows;
  return Number(result[0]?.n ?? 0);
}

function postgresStore(tx: Tx): RetentionStore {
  return {
    async deleteBatch(target, c, limit) {
      switch (target) {
        case "auditEvents":
          return deleteAudit(tx, c, limit);
        case "notificationDeliveries":
          return deleteNotifications(tx, c, limit);
        case "releaseEvents":
          return deleteReleaseEvents(tx, c, limit);
        case "rateLimitBuckets":
          return deleteRateLimit(tx, c, limit);
      }
    },
    async countEligible(target, c, limit) {
      switch (target) {
        case "auditEvents":
          return countRows(tx.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM (
              SELECT 1 FROM "AuditEvent" a
              WHERE a."createdAt" < ${c.retention}
                AND NOT EXISTS (
                  SELECT 1 FROM "CheckInSchedule" s
                  WHERE s."userId" = a."userId" AND s."state" = 'RELEASED'
                    AND (s."releasedAt" IS NULL OR s."releasedAt" >= ${c.retention}))
              LIMIT ${limit}) t`);
        case "notificationDeliveries":
          return countRows(tx.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM (
              SELECT 1 FROM "NotificationDelivery" n
              WHERE n."createdAt" < ${c.retention}
                AND NOT EXISTS (
                  SELECT 1 FROM "CheckInSchedule" s
                  WHERE s."userId" = n."userId" AND s."state" = 'RELEASED'
                    AND (s."releasedAt" IS NULL OR s."releasedAt" >= ${c.retention}))
              LIMIT ${limit}) t`);
        case "releaseEvents":
          return countRows(tx.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM (
              SELECT 1 FROM "ReleaseEvent" e
              JOIN "CheckInSchedule" s ON s."id" = e."scheduleId"
              WHERE s."state" = 'RELEASED' AND s."releasedAt" IS NOT NULL AND s."releasedAt" < ${c.retention}
                AND e."createdAt" < ${c.retention}
                AND (e."tokenExpiresAt" IS NULL OR e."tokenExpiresAt" < ${c.now})
              LIMIT ${limit}) t`);
        case "rateLimitBuckets":
          return countRows(tx.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM (
              SELECT 1 FROM "RateLimitBucket" b WHERE b."windowStart" < ${c.rateLimit} LIMIT ${limit}) t`);
      }
    },
  };
}

/** One transaction holds the advisory lock for the whole run; it is released when the run ends or the process dies. */
export function postgresLockRunner(db: PrismaClient): RetentionLockRunner {
  return (fn) =>
    db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_KEY}) AS locked`;
        if (!rows[0]?.locked) return null;
        return fn(postgresStore(tx));
      },
      { maxWait: 5_000, timeout: 60_000 }
    );
}

export async function runRetentionPurge(db: PrismaClient, options: RetentionOptions = {}): Promise<RetentionReport> {
  return runPurge(postgresLockRunner(db), options);
}

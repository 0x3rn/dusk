// lib/security/db-rate-limiter.ts
// Fixed-window rate limiter backed by Postgres, so the limit holds across every serverless
// instance. One atomic upsert per check; no read-then-write race.
import type { PrismaClient } from "@prisma/client";
import { hashIpAddress } from "../auth/security";
import { RateLimitExceededError, type RateLimitPolicy } from "./http-hardening";

export async function consumeRateLimit(
  db: PrismaClient,
  policy: RateLimitPolicy,
  subjectKey: string,
  nowMs = Date.now()
): Promise<{ remainingAttempts: number }> {
  const windowStartMs = Math.floor(nowMs / policy.windowMs) * policy.windowMs;
  const windowStart = new Date(windowStartMs);
  const key = `${policy.bucketName}:${subjectKey.trim().toLowerCase()}`;

  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart")
    DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);

  if (count > policy.maxAttempts) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStartMs + policy.windowMs - nowMs) / 1000)
    );
    throw new RateLimitExceededError(retryAfterSeconds);
  }

  // Tidy up old windows now and then (about 1 in 50 calls) so the table stays small.
  if (Math.random() < 0.02) {
    void db.rateLimitBucket
      .deleteMany({ where: { windowStart: { lt: new Date(nowMs - 2 * policy.windowMs) } } })
      .catch(() => undefined);
  }

  return { remainingAttempts: policy.maxAttempts - count };
}

/** A stable, non-identifying key for the caller's IP (never store raw IPs). */
export function clientKeyFromHeaders(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || "unknown";
  return hashIpAddress(ip);
}

export function clientKeyFromRequest(req: Request): string {
  return clientKeyFromHeaders(req.headers);
}

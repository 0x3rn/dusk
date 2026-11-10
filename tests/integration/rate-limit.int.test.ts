// tests/integration/rate-limit.int.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./helpers";
import { consumeRateLimit } from "@/lib/security/db-rate-limiter";
import { RateLimitExceededError } from "@/lib/security/http-hardening";

const policy = { bucketName: `itest_${randomUUID().slice(0, 6)}`, maxAttempts: 3, windowMs: 60_000 };
afterAll(async () => {
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: policy.bucketName } } });
  await db.$disconnect();
});

describe("consumeRateLimit on Postgres", () => {
  it("allows up to the limit, then blocks with a retry-after, per subject", async () => {
    const t = 1_800_000_000_000;
    expect((await consumeRateLimit(db, policy, "alice", t)).remainingAttempts).toBe(2);
    expect((await consumeRateLimit(db, policy, "alice", t + 1)).remainingAttempts).toBe(1);
    expect((await consumeRateLimit(db, policy, "alice", t + 2)).remainingAttempts).toBe(0);

    const blocked = await consumeRateLimit(db, policy, "alice", t + 3).catch((e) => e);
    expect(blocked).toBeInstanceOf(RateLimitExceededError);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);

    // A different subject is unaffected.
    expect((await consumeRateLimit(db, policy, "bob", t)).remainingAttempts).toBe(2);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const t = 1_800_100_000_000;
    for (let i = 0; i < 3; i++) await consumeRateLimit(db, policy, "carol", t + i);
    await expect(consumeRateLimit(db, policy, "carol", t + 10)).rejects.toBeInstanceOf(RateLimitExceededError);
    expect((await consumeRateLimit(db, policy, "carol", t + 61_000)).remainingAttempts).toBe(2);
  });

  it("is atomic under concurrency: 10 simultaneous calls allow exactly 3", async () => {
    const t = 1_800_200_000_000;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => consumeRateLimit(db, policy, "dave", t))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
  });
});

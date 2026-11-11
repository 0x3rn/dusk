// lib/engine/retention.test.ts
// Unit tests with a fake clock and a fake store. The real SQL is covered by
// tests/integration/retention.int.test.ts against the Neon dev branch.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_ROWS_PER_TABLE,
  computeCutoffs,
  purgeWithStore,
  rateLimitHorizonMs,
  runPurge,
  subtractMonthsUtc,
  type RetentionCutoffs,
  type RetentionStore,
  type RetentionTarget,
} from "./retention";

const iso = (d: Date) => d.toISOString();

describe("subtractMonthsUtc", () => {
  it("subtracts 12 months and keeps the time of day", () => {
    expect(iso(subtractMonthsUtc(new Date("2026-11-11T07:30:15.123Z"), 12))).toBe("2025-11-11T07:30:15.123Z");
  });

  it("crosses a year boundary", () => {
    expect(iso(subtractMonthsUtc(new Date("2026-02-10T00:00:00Z"), 3))).toBe("2025-11-10T00:00:00.000Z");
  });

  it("clamps to the end of a shorter month instead of spilling into the next", () => {
    expect(iso(subtractMonthsUtc(new Date("2026-03-31T12:00:00Z"), 1))).toBe("2026-02-28T12:00:00.000Z");
    expect(iso(subtractMonthsUtc(new Date("2028-03-31T12:00:00Z"), 1))).toBe("2028-02-29T12:00:00.000Z");
  });

  it("29 February minus 12 months is 28 February of the previous year", () => {
    expect(iso(subtractMonthsUtc(new Date("2028-02-29T09:00:00Z"), 12))).toBe("2027-02-28T09:00:00.000Z");
  });

  it("does not change the date it was given", () => {
    const d = new Date("2026-11-11T00:00:00Z");
    subtractMonthsUtc(d, 12);
    expect(iso(d)).toBe("2026-11-11T00:00:00.000Z");
  });

  it("rejects negative and fractional months", () => {
    expect(() => subtractMonthsUtc(new Date(), -1)).toThrow(RangeError);
    expect(() => subtractMonthsUtc(new Date(), 1.5)).toThrow(RangeError);
  });
});

describe("computeCutoffs", () => {
  it("uses the fake clock: 12 months back, and a rate-limit horizon of at least a day", () => {
    const now = new Date("2027-01-31T10:00:00Z");
    const c = computeCutoffs(now);
    expect(iso(c.retention)).toBe("2026-01-31T10:00:00.000Z");
    expect(c.now).toBe(now);
    expect(now.getTime() - c.rateLimit.getTime()).toBe(rateLimitHorizonMs());
    expect(rateLimitHorizonMs()).toBeGreaterThanOrEqual(24 * 3_600_000);
  });
});

/** A store with a fixed number of eligible rows per table. Deleting reduces the number. */
function fakeStore(eligible: Partial<Record<RetentionTarget, number>>) {
  const left: Record<RetentionTarget, number> = {
    auditEvents: 0,
    notificationDeliveries: 0,
    releaseEvents: 0,
    rateLimitBuckets: 0,
    ...eligible,
  };
  const calls: Array<{ target: RetentionTarget; limit: number }> = [];
  const seenCutoffs: RetentionCutoffs[] = [];
  const store: RetentionStore = {
    async deleteBatch(target, cutoffs, limit) {
      calls.push({ target, limit });
      seenCutoffs.push(cutoffs);
      const n = Math.min(limit, left[target]);
      left[target] -= n;
      return n;
    },
    async countEligible(target, cutoffs, limit) {
      seenCutoffs.push(cutoffs);
      return Math.min(limit, left[target]);
    },
  };
  return { store, left, calls, seenCutoffs };
}

const NOW = new Date("2027-06-01T00:00:00Z");

describe("purgeWithStore", () => {
  it("deletes in batches of the requested size until nothing is left", async () => {
    const f = fakeStore({ auditEvents: 1_250 });
    const report = await purgeWithStore(f.store, { now: NOW, batchSize: 500 });
    expect(report).toMatchObject({ skipped: false, dryRun: false, capped: [] });
    expect(report.counts.auditEvents).toBe(1_250);
    expect(f.left.auditEvents).toBe(0);
    expect(f.calls.filter((c) => c.target === "auditEvents").map((c) => c.limit)).toEqual([500, 500, 500]);
  });

  it("defaults to 500 rows per statement", async () => {
    expect(DEFAULT_BATCH_SIZE).toBe(500);
    const f = fakeStore({ notificationDeliveries: 600 });
    await purgeWithStore(f.store, { now: NOW });
    expect(f.calls.filter((c) => c.target === "notificationDeliveries").map((c) => c.limit)).toEqual([500, 500]);
  });

  it("stops at the per-run cap, never asks for more than the cap, and says which table is capped", async () => {
    expect(DEFAULT_MAX_ROWS_PER_TABLE).toBe(5_000);
    const f = fakeStore({ auditEvents: 2_000, releaseEvents: 10 });
    const report = await purgeWithStore(f.store, { now: NOW, batchSize: 500, maxRowsPerTable: 1_200 });
    expect(report.counts.auditEvents).toBe(1_200);
    expect(f.left.auditEvents).toBe(800);
    expect(report.capped).toEqual(["auditEvents"]);
    expect(report.counts.releaseEvents).toBe(10);
    expect(f.calls.filter((c) => c.target === "auditEvents").map((c) => c.limit)).toEqual([500, 500, 200]);
  });

  it("is idempotent: a second run finds nothing, and a capped backlog is cleared by repeat runs", async () => {
    const f = fakeStore({ auditEvents: 1_000, rateLimitBuckets: 3 });
    const first = await purgeWithStore(f.store, { now: NOW, maxRowsPerTable: 600 });
    expect(first.counts.auditEvents).toBe(600);
    const second = await purgeWithStore(f.store, { now: NOW, maxRowsPerTable: 600 });
    expect(second.counts.auditEvents).toBe(400);
    expect(second.capped).toEqual([]);
    const third = await purgeWithStore(f.store, { now: NOW });
    expect(Object.values(third.counts).every((n) => n === 0)).toBe(true);
  });

  it("an exact multiple of the batch size costs one extra empty statement, not an endless loop", async () => {
    const f = fakeStore({ auditEvents: 1_000 });
    const report = await purgeWithStore(f.store, { now: NOW, batchSize: 500 });
    expect(report.counts.auditEvents).toBe(1_000);
    expect(f.calls.filter((c) => c.target === "auditEvents")).toHaveLength(3);
  });

  it("a dry run counts, deletes nothing, and respects the cap", async () => {
    const f = fakeStore({ auditEvents: 900, notificationDeliveries: 4 });
    const report = await purgeWithStore(f.store, { now: NOW, dryRun: true, maxRowsPerTable: 500 });
    expect(report).toMatchObject({ dryRun: true, capped: ["auditEvents"] });
    expect(report.counts).toEqual({ auditEvents: 500, notificationDeliveries: 4, releaseEvents: 0, rateLimitBuckets: 0 });
    expect(f.calls).toEqual([]);
    expect(f.left.auditEvents).toBe(900);
  });

  it("passes the same fake-clock cutoffs to every statement", async () => {
    const f = fakeStore({ auditEvents: 1, releaseEvents: 1 });
    await purgeWithStore(f.store, { now: NOW });
    for (const c of f.seenCutoffs) {
      expect(iso(c.retention)).toBe("2026-06-01T00:00:00.000Z");
      expect(c.now).toBe(NOW);
    }
  });

  it("refuses nonsense limits before touching anything", async () => {
    const f = fakeStore({ auditEvents: 5 });
    for (const bad of [0, -1, 1.5, Number.NaN, 5_001]) {
      await expect(purgeWithStore(f.store, { batchSize: bad })).rejects.toThrow(RangeError);
    }
    await expect(purgeWithStore(f.store, { maxRowsPerTable: 0 })).rejects.toThrow(RangeError);
    expect(f.calls).toEqual([]);
  });

  it("lets a store error through instead of hiding it", async () => {
    const store: RetentionStore = {
      deleteBatch: async () => {
        throw new Error("database down");
      },
      countEligible: async () => 0,
    };
    await expect(purgeWithStore(store, { now: NOW })).rejects.toThrow("database down");
  });
});

describe("runPurge", () => {
  it("reports skipped when another run holds the lock, and does no work", async () => {
    let ran = false;
    const report = await runPurge(async () => {
      ran = true;
      return null;
    });
    expect(report).toEqual({ skipped: true });
    expect(ran).toBe(true); // the lock runner was asked, and said no
  });

  it("runs the purge when the lock is free", async () => {
    const f = fakeStore({ auditEvents: 2 });
    const report = await runPurge((fn) => fn(f.store), { now: NOW });
    expect(report).toMatchObject({ skipped: false });
    expect(f.left.auditEvents).toBe(0);
  });
});

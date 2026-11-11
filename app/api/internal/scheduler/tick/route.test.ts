// A purge failure must never stop the sweep's result from reaching the scheduler, and the
// response and logs carry counts only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(40);

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ CRON_SECRET: SECRET }) }));
vi.mock("@/lib/engine/engine", () => ({ createEngine: () => ({}) }));
vi.mock("@/lib/security/db-rate-limiter", () => ({ consumeRateLimit: async () => ({ remainingAttempts: 1 }) }));

const sweep = vi.fn();
const purge = vi.fn();
vi.mock("@/lib/engine/sweep", () => ({ runSchedulerSweepExclusive: (...a: unknown[]) => sweep(...a) }));
vi.mock("@/lib/engine/retention", () => ({ runRetentionPurge: (...a: unknown[]) => purge(...a) }));

import { POST } from "./route";

const request = () => new Request("http://localhost/api/internal/scheduler/tick", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
const sweepReport = { examined: 2, transitions: [], remindersSent: 1, verifierChallengesIssued: 0, releasesAuthorized: 0, beneficiaryGrantsIssued: 0, errors: [] };

beforeEach(() => {
  sweep.mockReset();
  purge.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/internal/scheduler/tick", () => {
  it("runs the purge after the sweep and reports counts only", async () => {
    sweep.mockResolvedValue({ skipped: false, report: sweepReport });
    purge.mockResolvedValue({ skipped: false, dryRun: false, counts: { auditEvents: 3, notificationDeliveries: 0, releaseEvents: 1, rateLimitBuckets: 9 }, capped: [] });
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.examined).toBe(2);
    expect(body.retention).toEqual({ skipped: false, failed: false, counts: { auditEvents: 3, notificationDeliveries: 0, releaseEvents: 1, rateLimitBuckets: 9 }, capped: [] });
    expect(sweep.mock.invocationCallOrder[0]).toBeLessThan(purge.mock.invocationCallOrder[0]);
  });

  it("a purge error is isolated: the sweep result still comes back, marked failed, with no error text", async () => {
    sweep.mockResolvedValue({ skipped: false, report: sweepReport });
    purge.mockRejectedValue(new Error("connection to ben@example.com refused"));
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.remindersSent).toBe(1);
    expect(body.retention).toEqual({ skipped: false, failed: true });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("example.com");
  });

  it("still runs the purge when another sweep holds the sweep lock", async () => {
    sweep.mockResolvedValue({ skipped: true });
    purge.mockResolvedValue({ skipped: true });
    const body = await (await POST(request())).json();
    expect(body).toEqual({ ok: true, skipped: true, retention: { skipped: true } });
  });

  it("rejects a wrong secret without running either job", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });
});

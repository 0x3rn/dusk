// lib/engine/tick-client.test.ts
import { describe, expect, it } from "vitest";
import { TickFailedError, callSchedulerTick } from "./tick-client";

const base = { appUrl: "https://dusk.app/", cronSecret: "s".repeat(40) };

describe("callSchedulerTick", () => {
  it("POSTs to the tick endpoint with the bearer secret and returns the report", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const result = await callSchedulerTick({
      ...base,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return Response.json({ ok: true, examined: 3, errors: 0 });
      },
    });
    expect(result).toMatchObject({ ok: true, examined: 3 });
    expect(seen!.url).toBe("https://dusk.app/api/internal/scheduler/tick");
    expect(seen!.init?.method).toBe("POST");
    expect((seen!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"s".repeat(40)}`);
  });

  it.each([
    [500, true],
    [502, true],
    [429, true],
    [401, false],
    [503, false],
    [404, false],
  ])("status %i is retryable=%s", async (status, retryable) => {
    const err = await callSchedulerTick({
      ...base,
      fetchImpl: async () => new Response("x", { status }),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TickFailedError);
    expect(err.retryable).toBe(retryable);
  });

  it("treats a network failure as retryable", async () => {
    const err = await callSchedulerTick({
      ...base,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }).catch((e) => e);
    expect(err.retryable).toBe(true);
  });

  it("refuses to run without configuration, and never retries that", async () => {
    const err = await callSchedulerTick({ appUrl: "", cronSecret: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(TickFailedError);
    expect(err.retryable).toBe(false);
  });
});

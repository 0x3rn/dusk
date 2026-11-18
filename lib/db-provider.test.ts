// lib/db-provider.test.ts
import { describe, expect, it, vi } from "vitest";
import { createClientProvider } from "./db-provider";

describe("createClientProvider", () => {
  it("shares one client when there is no request (Node)", () => {
    const create = vi.fn(() => ({ id: Math.random() }));
    const get = createClientProvider({ create, requestKey: () => null });
    expect(get()).toBe(get());
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("gives each request its own client, and the same request the same client", () => {
    const create = vi.fn(() => ({ id: Math.random() }));
    const requestA = {};
    const requestB = {};
    let current: object = requestA;
    const get = createClientProvider({ create, requestKey: () => current });

    const a1 = get();
    const a2 = get();
    current = requestB;
    const b1 = get();
    current = requestA;
    const a3 = get();

    expect(a1).toBe(a2);
    expect(a1).toBe(a3);
    expect(b1).not.toBe(a1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not build a client until it is first used", () => {
    const create = vi.fn(() => ({}));
    createClientProvider({ create, requestKey: () => null });
    expect(create).not.toHaveBeenCalled();
  });

  it("lets a failed create be retried instead of caching the failure", () => {
    let attempts = 0;
    const get = createClientProvider({
      create: () => {
        attempts++;
        if (attempts === 1) throw new Error("no connection string");
        return { ok: true };
      },
      requestKey: () => null,
    });
    expect(() => get()).toThrow("no connection string");
    expect(get()).toEqual({ ok: true });
  });
});

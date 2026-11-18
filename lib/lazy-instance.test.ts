// lib/lazy-instance.test.ts
import { describe, expect, it, vi } from "vitest";
import { lazyInstance } from "./lazy-instance";

describe("lazyInstance", () => {
  it("forwards reads and calls to the current real client, with the right this", () => {
    class Fake {
      name = "real";
      who() {
        return this.name;
      }
      user = { count: () => 7 };
    }
    const fake = new Fake();
    const proxy = lazyInstance(() => fake);
    expect(proxy.name).toBe("real");
    expect(proxy.who()).toBe("real");
    expect(proxy.user.count()).toBe(7);
    expect("name" in proxy).toBe(true);
  });

  it("looks the client up on every use, so a new request sees its own client", () => {
    const first = { value: 1 };
    const second = { value: 2 };
    let current = first;
    const proxy = lazyInstance(() => current);
    expect(proxy.value).toBe(1);
    current = second;
    expect(proxy.value).toBe(2);
  });
});

describe("lazyInstance setup timing", () => {
  it("does not run the setup until the object is first used", () => {
    const create = vi.fn(() => ({ value: 1 }));
    const proxy = lazyInstance(create);
    expect(create).not.toHaveBeenCalled();
    expect(proxy.value).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("lets a setup failure surface at first use, not at import", () => {
    const proxy = lazyInstance((): { value: number } => {
      throw new Error("missing secret");
    });
    expect(() => proxy.value).toThrow("missing secret");
  });
});

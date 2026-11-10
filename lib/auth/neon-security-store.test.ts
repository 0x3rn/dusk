// lib/auth/neon-security-store.test.ts
import { describe, expect, it, vi } from "vitest";

// The store imports the Neon server SDK (needs env). Only the pure helper is tested here.
vi.mock("./server", () => ({ auth: {} }));

import { describeDevice } from "./neon-security-store";

describe("describeDevice", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", "Chrome on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130", "Edge on Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17 Safari/605", "Safari on macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604", "Safari on iOS"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox on Linux"],
    ["curl/8.21.0", "Command line"],
    ["", "Unknown device"],
    [null, "Unknown device"],
    [undefined, "Unknown device"],
  ])("labels %j as %s", (ua, expected) => {
    expect(describeDevice(ua as string | null | undefined)).toBe(expected);
  });
});

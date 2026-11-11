// lib/security/csp.test.ts
import { describe, expect, it } from "vitest";
import { WORKER_SCRIPT_CSP, buildContentSecurityPolicy, generateCspNonce } from "./csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values] as const;
    })
  );
}

describe("generateCspNonce", () => {
  it("returns 128 bits of base64 and a different value every call", () => {
    const nonces = new Set(Array.from({ length: 500 }, () => generateCspNonce()));
    expect(nonces.size).toBe(500);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(nonce).length).toBe(16);
    }
  });
});

describe("buildContentSecurityPolicy", () => {
  const nonce = "dGVzdC1ub25jZS12YWx1ZQ==";
  const prod = directives(buildContentSecurityPolicy({ nonce, isDevelopment: false }));
  const dev = directives(buildContentSecurityPolicy({ nonce, isDevelopment: true }));

  it("allows scripts only by nonce and strict-dynamic, never unsafe-inline", () => {
    for (const policy of [prod, dev]) {
      const script = policy.get("script-src") ?? [];
      expect(script).toContain(`'nonce-${nonce}'`);
      expect(script).toContain("'strict-dynamic'");
      expect(script).toContain("'self'");
      expect(script).not.toContain("'unsafe-inline'");
      expect(script.some((v) => v.startsWith("http"))).toBe(false);
    }
  });

  it("allows WebAssembly compilation (Argon2id) in both modes", () => {
    expect(prod.get("script-src")).toContain("'wasm-unsafe-eval'");
    expect(dev.get("script-src")).toContain("'wasm-unsafe-eval'");
  });

  it("allows unsafe-eval in development only", () => {
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(prod.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("upgrades insecure requests in production only", () => {
    expect(prod.has("upgrade-insecure-requests")).toBe(true);
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });

  it("allows same-origin Web Workers (key derivation) and nothing else for workers", () => {
    for (const policy of [prod, dev]) {
      // 'strict-dynamic' makes browsers ignore 'self' in script-src, so worker-src must say it.
      expect(policy.get("worker-src")).toEqual(["'self'"]);
    }
  });

  it("does not loosen any other directive for the worker (no blob:, data:, wildcard or unsafe-inline)", () => {
    const whole = buildContentSecurityPolicy({ nonce, isDevelopment: false });
    expect(whole).not.toMatch(/blob:/);
    expect(whole).not.toMatch(/(^|[ ;])\*($|[ ;])/);
    expect(prod.get("script-src")).not.toContain("'unsafe-inline'");
    expect(prod.get("default-src")).toEqual(["'self'"]);
  });

  it("keeps the framing, base, form and object protections", () => {
    expect(prod.get("frame-ancestors")).toEqual(["'none'"]);
    expect(prod.get("base-uri")).toEqual(["'self'"]);
    expect(prod.get("form-action")).toEqual(["'self'"]);
    expect(prod.get("object-src")).toEqual(["'none'"]);
    expect(prod.get("default-src")).toEqual(["'self'"]);
  });

  it("keeps the Sentry ingest hosts and no payment-provider hosts", () => {
    const connect = prod.get("connect-src") ?? [];
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://*.ingest.sentry.io");
    expect(connect).toContain("https://*.ingest.us.sentry.io");
    expect(connect).toContain("https://*.ingest.de.sentry.io");
    const whole = buildContentSecurityPolicy({ nonce, isDevelopment: false });
    expect(whole).not.toMatch(/stripe/i);
  });

  it("rejects a nonce that could break out of the directive", () => {
    for (const bad of ["", "short", "abc def ghi jkl mnop", "aaaaaaaaaaaaaaaa'; script-src *", "aaaaaaaaaaaaaaaa;", "aaaaaaaaaaaaaaaa,"]) {
      expect(() => buildContentSecurityPolicy({ nonce: bad, isDevelopment: false })).toThrow();
    }
  });
});

describe("WORKER_SCRIPT_CSP", () => {
  const policy = directives(WORKER_SCRIPT_CSP);

  it("lets the key-derivation worker load its own code and compile WebAssembly, and nothing else", () => {
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });

  it("forbids every network request from the worker", () => {
    expect(policy.get("connect-src")).toEqual(["'none'"]);
    expect(WORKER_SCRIPT_CSP).not.toMatch(/'unsafe-inline'|'unsafe-eval'|https?:|\*/);
  });
});

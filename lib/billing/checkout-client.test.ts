// lib/billing/checkout-client.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_ERROR_MESSAGE,
  CHECKOUT_RATE_LIMITED_MESSAGE,
  afterSignInPath,
  hasCheckoutIntent,
  isResumeCheckout,
  startCheckout,
  withCheckoutIntent,
} from "./checkout-client";

const GOOD_URL = "https://dusk.lemonsqueezy.com/checkout/custom/abc?signature=1";

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("startCheckout", () => {
  it("posts to /api/checkout without sending any user data and returns the payment page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { url: GOOD_URL }));
    expect(await startCheckout({ fetchImpl })).toEqual({ kind: "redirect", url: GOOD_URL });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/checkout");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("sends a signed-out visitor to create an account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(401, { error: "Sign in", code: "AUTHENTICATION_ERROR" }));
    expect(await startCheckout({ fetchImpl })).toEqual({ kind: "needs-account" });
  });

  it("recognises an account that already has lifetime access", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(409, { code: "ALREADY_PURCHASED" }));
    expect(await startCheckout({ fetchImpl })).toEqual({ kind: "already-purchased" });
  });

  it.each([
    [503, { code: "PAYMENTS_UNAVAILABLE" }],
    [502, { code: "CHECKOUT_FAILED" }],
    [504, { code: "CHECKOUT_FAILED" }],
    [500, { code: "INTERNAL_ERROR" }],
    [403, { code: "AUTHORIZATION_ERROR" }],
    [409, { code: "SOMETHING_ELSE" }],
  ])("stays on the page with the plain error message for HTTP %i", async (status, body) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(status, body));
    expect(await startCheckout({ fetchImpl })).toEqual({ kind: "error", message: CHECKOUT_ERROR_MESSAGE });
  });

  it("explains a rate limit separately", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(429, { code: "RATE_LIMITED" }));
    expect(await startCheckout({ fetchImpl })).toEqual({ kind: "error", message: CHECKOUT_RATE_LIMITED_MESSAGE });
  });

  it("never reports success for a missing, malformed or foreign URL", async () => {
    for (const body of [{}, { url: 5 }, { url: "https://evil.example/pay" }, { url: "http://dusk.lemonsqueezy.com/x" }, { url: "javascript:alert(1)" }]) {
      const fetchImpl = vi.fn().mockResolvedValue(reply(200, body));
      expect(await startCheckout({ fetchImpl })).toEqual({ kind: "error", message: CHECKOUT_ERROR_MESSAGE });
    }
  });

  it("handles a response that is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 502 }));
    expect(await startCheckout({ fetchImpl })).toEqual({ kind: "error", message: CHECKOUT_ERROR_MESSAGE });
  });

  it("turns a network failure into the error message instead of throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await startCheckout({ fetchImpl })).toEqual({ kind: "error", message: CHECKOUT_ERROR_MESSAGE });
  });

  it("gives up after the timeout instead of waiting forever", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const started = Date.now();
    const result = await startCheckout({ fetchImpl: fetchImpl as typeof fetch, timeoutMs: 30 });
    expect(result).toEqual({ kind: "error", message: CHECKOUT_ERROR_MESSAGE });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("checkout intent after sign-up or sign-in", () => {
  it("honours exactly next=checkout", () => {
    expect(hasCheckoutIntent("?next=checkout")).toBe(true);
    expect(hasCheckoutIntent("?a=1&next=checkout")).toBe(true);
    expect(afterSignInPath("?next=checkout")).toBe("/?checkout=resume");
  });

  it.each([
    "",
    "?next=",
    "?next=/dashboard",
    "?next=https://evil.example",
    "?next=//evil.example",
    "?next=%2F%2Fevil.example",
    "?next=checkout/../../x",
    "?next=CHECKOUT",
    "?next=checkout&next=https://evil.example",
    "?redirect=checkout",
  ])("ignores %j and goes to the dashboard (no open redirect)", (search) => {
    // The duplicate-parameter case reads the first value, which is still the plain word.
    const expectedIntent = search === "?next=checkout&next=https://evil.example";
    expect(hasCheckoutIntent(search)).toBe(expectedIntent);
    expect(afterSignInPath(search)).toBe(expectedIntent ? "/?checkout=resume" : "/dashboard");
  });

  it("never returns anything but one of two fixed internal paths", () => {
    for (const search of ["?next=https://evil.example", "?next=checkout", ""]) {
      expect(["/dashboard", "/?checkout=resume"]).toContain(afterSignInPath(search));
    }
  });

  it("keeps the intent when switching between sign-in and sign-up", () => {
    expect(withCheckoutIntent("/login", "?next=checkout")).toBe("/login?next=checkout");
    expect(withCheckoutIntent("/register", "?next=https://evil.example")).toBe("/register");
    expect(withCheckoutIntent("/register", "")).toBe("/register");
  });

  it("detects a resumed checkout on the landing page", () => {
    expect(isResumeCheckout("?checkout=resume")).toBe(true);
    expect(isResumeCheckout("?checkout=success")).toBe(false);
    expect(isResumeCheckout("")).toBe(false);
  });
});

// lib/security/http-hardening.test.ts
import { describe, expect, it } from "vitest";
import {
  CsrfViolationError,
  LEGAL_SCOPE_AND_ESTATE_DISCLAIMER,
  RATE_LIMIT_POLICIES,
  RateLimitExceededError,
  SlidingWindowRateLimiter,
  assertCsrfSafeMutationRequest,
  getProductionSecurityHeaders,
} from "./http-hardening";

describe("THE-111: Production Security Headers, CSRF Protection, Rate Limiting & Legal Disclaimers", () => {
  it("1. generates strict static security headers including Referrer-Policy: no-referrer, and leaves the CSP to the per-request proxy", () => {
    const headers = getProductionSecurityHeaders();
    const map = Object.fromEntries(headers.map((h) => [h.key, h.value]));

    expect(map["Referrer-Policy"]).toBe("no-referrer");
    expect(map["X-Frame-Options"]).toBe("DENY");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(map["Permissions-Policy"]).toContain("camera=()");
    expect(map["X-DNS-Prefetch-Control"]).toBe("off");
    // A static CSP here would be sent next to the proxy's nonce CSP and the browser would apply
    // both, so the nonce policy must be the only one.
    expect(map["Content-Security-Policy"]).toBeUndefined();
  });

  it("2. enforces CSRF origin and Sec-Fetch-Site validation on state-mutating requests", () => {
    expect(() =>
      assertCsrfSafeMutationRequest({
        method: "GET",
      })
    ).not.toThrow();

    expect(() =>
      assertCsrfSafeMutationRequest({
        method: "POST",
        originHeader: "https://dusk.app",
        hostHeader: "dusk.app",
        secFetchSiteHeader: "same-origin",
      })
    ).not.toThrow();

    expect(() =>
      assertCsrfSafeMutationRequest({
        method: "POST",
        originHeader: "https://evil.example.com",
        hostHeader: "dusk.app",
        secFetchSiteHeader: "cross-site",
      })
    ).toThrowError(CsrfViolationError);

    expect(() =>
      assertCsrfSafeMutationRequest({
        method: "POST",
        originHeader: "https://attacker.com",
        hostHeader: "dusk.app",
      })
    ).toThrowError(CsrfViolationError);

    expect(() =>
      assertCsrfSafeMutationRequest({
        method: "DELETE",
        hostHeader: "dusk.app",
      })
    ).toThrowError(CsrfViolationError);
  });

  it("3. enforces sliding-window rate limits and calculates retryAfterSeconds", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = RATE_LIMIT_POLICIES.RECOVERY_UNLOCK; // max 3 attempts per hour
    const t0 = 1_700_000_000_000;

    expect(limiter.consume(policy, "usr_123", t0).remainingAttempts).toBe(2);
    expect(limiter.consume(policy, "usr_123", t0 + 1000).remainingAttempts).toBe(1);
    expect(limiter.consume(policy, "usr_123", t0 + 2000).remainingAttempts).toBe(0);

    try {
      limiter.consume(policy, "usr_123", t0 + 3000);
      expect.unreachable("Should have rate limited on 4th attempt");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitExceededError);
      const rateErr = err as RateLimitExceededError;
      expect(rateErr.statusCode).toBe(429);
      expect(rateErr.retryAfterSeconds).toBeGreaterThan(3500);
    }

    const afterFullWindow = t0 + 60 * 60 * 1000 + 2500;
    expect(
      limiter.consume(policy, "usr_123", afterFullWindow).remainingAttempts
    ).toBe(2);
  });

  it("4. defines explicit legal scope disclaimers distinguishing Dusk from a statutory will", () => {
    expect(LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.notALegalWillHeadline).toContain(
      "NOT a legal will"
    );
    expect(LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.zeroKnowledgeCustodyNotice).toContain(
      "zero-knowledge"
    );
  });
});
describe("invitation rate limits", () => {
  it("INVITE_LINK allows 30 opens or answers per 15 minutes per caller, then blocks", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = RATE_LIMIT_POLICIES.INVITE_LINK;
    expect(policy.maxAttempts).toBe(30);
    expect(policy.windowMs).toBe(15 * 60 * 1000);
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 30; i++) limiter.consume(policy, "ip_a", t0 + i);
    expect(() => limiter.consume(policy, "ip_a", t0 + 31)).toThrowError(RateLimitExceededError);
    // Another caller is unaffected.
    expect(limiter.consume(policy, "ip_b", t0 + 31).remainingAttempts).toBe(29);
  });

  it("INVITE_SEND caps invitation emails at 20 per hour per owner", () => {
    expect(RATE_LIMIT_POLICIES.INVITE_SEND.maxAttempts).toBe(20);
    expect(RATE_LIMIT_POLICIES.INVITE_SEND.windowMs).toBe(60 * 60 * 1000);
  });
});

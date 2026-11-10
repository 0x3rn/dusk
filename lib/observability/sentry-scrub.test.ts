// lib/observability/sentry-scrub.test.ts
import { describe, expect, it } from "vitest";
import { scrubSentryEvent, scrubUrl } from "./sentry-scrub";

describe("scrubUrl", () => {
  it.each([
    ["https://dusk.app/checkin/SECRETTOKEN123", "https://dusk.app/checkin/[redacted]"],
    ["https://dusk.app/verify/SECRETTOKEN123?x=1#frag", "https://dusk.app/verify/[redacted]"],
    ["https://dusk.app/unlock/contact_1?token=SECRET#PRIVATEKEY", "https://dusk.app/unlock/[redacted]"],
    ["https://dusk.app/dashboard?tab=vault", "https://dusk.app/dashboard"],
    ["/api/checkin/confirm", "/api/checkin/confirm"],
  ])("%s -> %s", (input, expected) => {
    expect(scrubUrl(input)).toBe(expected);
  });

  it("never leaves a token, query or fragment behind", () => {
    const out = scrubUrl("https://dusk.app/unlock/abc?token=TOP-SECRET#PRIVATE-KEY-MATERIAL");
    expect(out).not.toMatch(/TOP-SECRET|PRIVATE-KEY|token=|abc/);
  });
});

describe("scrubSentryEvent", () => {
  it("removes bodies, cookies, headers and query strings from the request", () => {
    const e = scrubSentryEvent({
      request: {
        url: "https://dusk.app/api/vault?session=abc",
        data: { wrappedMasterKeyCiphertext: "AAAA" },
        cookies: { "neon-auth.session_token": "s3cret" },
        headers: { authorization: "Bearer s3cret", cookie: "x=y" },
        query_string: "session=abc",
        method: "POST",
      },
    });
    expect(e.request).toEqual({ url: "https://dusk.app/api/vault", method: "POST" });
  });

  it("keeps only an opaque user id", () => {
    const e = scrubSentryEvent({
      user: { id: "usr_1", email: "a@b.co", ip_address: "1.2.3.4", username: "ada" },
    });
    expect(e.user).toEqual({ id: "usr_1" });
    expect(scrubSentryEvent({ user: { email: "a@b.co" } }).user).toEqual({});
  });

  it("scrubs breadcrumb urls and drops captured bodies", () => {
    const e = scrubSentryEvent({
      breadcrumbs: [
        { data: { url: "https://dusk.app/verify/TOKEN?x=1", request_body: "secret", response_body: "secret" } },
        { data: { from: "/checkin/TOKEN", to: "/unlock/c1?token=Z" }, message: "navigated to /verify/TOKEN" },
      ],
    });
    expect(JSON.stringify(e)).not.toMatch(/TOKEN|secret|token=Z/);
  });

  it("drops free-form extra data and scrubs the transaction name", () => {
    const e = scrubSentryEvent({ extra: { note: "email a@b.co" }, transaction: "POST /checkin/SECRET" });
    expect(e.extra).toBeUndefined();
    expect(e.transaction).toBe("POST /checkin/[redacted]");
  });

  it("is safe on a nearly empty event", () => {
    expect(scrubSentryEvent({})).toEqual({});
  });
});

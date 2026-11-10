// lib/auth/neon-session.test.ts
import { describe, expect, it } from "vitest";
import { parseNeonSession } from "./neon-session";
import { AuthenticationError } from "./security";

// Shape captured from a live get-session call against the Neon Auth dev branch.
const live = {
  session: {
    expiresAt: "2026-11-17T04:07:09.521Z",
    token: "must-never-be-read",
    createdAt: "2026-11-10T04:07:09.521Z",
    updatedAt: "2026-11-10T04:07:09.521Z",
    ipAddress: "102.219.153.186",
    userAgent: "curl/8.21.0",
    userId: "e74c6424-3301-4866-b7f0-d432ae149462",
    impersonatedBy: null,
    activeOrganizationId: null,
    id: "a39097cc-fd85-4edf-a84e-5697ff5ef89b",
  },
  user: {
    name: "Probe User",
    email: "probe@example.com",
    emailVerified: false,
    image: null,
    role: "user",
    banned: false,
    banReason: null,
    banExpires: null,
    id: "e74c6424-3301-4866-b7f0-d432ae149462",
  },
};

const before = new Date("2026-11-10T05:00:00Z");

describe("parseNeonSession", () => {
  it("parses a live Neon Auth session into an identity and never exposes the token", () => {
    const parsed = parseNeonSession(live, before);

    expect(parsed?.identity).toEqual({
      authUserId: "e74c6424-3301-4866-b7f0-d432ae149462",
      email: "probe@example.com",
      emailVerified: false,
      name: "Probe User",
    });
    expect(parsed?.authSession.id).toBe("a39097cc-fd85-4edf-a84e-5697ff5ef89b");
    expect(JSON.stringify(parsed)).not.toContain("must-never-be-read");
  });

  it("returns null when there is no session", () => {
    expect(parseNeonSession(null, before)).toBeNull();
    expect(parseNeonSession(undefined, before)).toBeNull();
  });

  it("rejects an expired session (boundary: expiresAt === now is expired)", () => {
    const atBoundary = new Date(live.session.expiresAt);
    expect(() => parseNeonSession(live, atBoundary)).toThrowError(AuthenticationError);
    expect(() => parseNeonSession(live, new Date(atBoundary.getTime() - 1))).not.toThrow();
  });

  it("rejects a banned user", () => {
    const banned = { ...live, user: { ...live.user, banned: true } };
    expect(() => parseNeonSession(banned, before)).toThrowError(/suspended/);
  });

  it.each([
    ["not an object", "session"],
    ["missing user", { session: live.session }],
    ["missing session id", { ...live, session: { ...live.session, id: "" } }],
    ["bad email", { ...live, user: { ...live.user, email: "nope" } }],
    ["emailVerified not boolean", { ...live, user: { ...live.user, emailVerified: "true" } }],
  ])("fails closed on a malformed payload: %s", (_label, payload) => {
    expect(() => parseNeonSession(payload, before)).toThrowError(AuthenticationError);
  });
});

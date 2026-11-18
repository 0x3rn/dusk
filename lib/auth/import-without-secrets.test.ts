// lib/auth/import-without-secrets.test.ts
// `next build` loads every route to collect its settings, and a clean build (CI, Cloudflare's
// builder) has none of the app's secrets. Loading a route must therefore never read them.
// This is the failure that stopped Cloudflare's first builds: "Invalid environment configuration:
// DATABASE_URL" while collecting /api/checkout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the Neon Auth SDK (Node cannot load its Next.js imports outside Next's bundler).
// It records whether, and with what, the app asked for an auth instance.
const createNeonAuth = vi.hoisted(() =>
  vi.fn(() => ({
    getSession: vi.fn(),
    signOut: vi.fn(),
    handler: () => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }),
    middleware: () => vi.fn(),
  }))
);
vi.mock("@neon/auth/next/server", () => ({ createNeonAuth }));

const SECRET_NAMES = [
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "CRON_SECRET",
  "LEMONSQUEEZY_API_KEY",
  "LEMONSQUEEZY_STORE_ID",
  "LEMONSQUEEZY_VARIANT_ID",
  "LEMONSQUEEZY_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "SENTRY_DSN",
  "NEXT_PUBLIC_APP_URL",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of SECRET_NAMES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  vi.resetModules();
  createNeonAuth.mockClear();
});

afterEach(() => {
  for (const name of SECRET_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const ROUTES_AND_MODULES = [
  "@/lib/auth/server",
  "@/lib/auth/current-user",
  "@/lib/auth/neon-security-store",
  "@/app/api/auth/[...path]/route",
  "@/app/api/checkout/route",
  "@/app/api/dashboard/route",
  "@/app/api/account/delete/route",
  "@/app/api/vault/route",
  "@/app/api/security/route",
  "@/app/api/readiness/route",
  "@/app/api/internal/scheduler/tick/route",
  "@/app/api/webhook/lemonsqueezy/route",
  "@/proxy",
];

describe("loading server code with no secrets set", () => {
  it.each(ROUTES_AND_MODULES)("%s loads without reading any secret", async (modulePath) => {
    await expect(import(modulePath)).resolves.toBeDefined();
  });

  it("does not create the auth instance just by loading all of them", async () => {
    for (const modulePath of ROUTES_AND_MODULES) await import(modulePath);
    expect(createNeonAuth).not.toHaveBeenCalled();
  });

  it("still fails clearly when the auth instance is actually used without its settings", async () => {
    const { auth } = await import("@/lib/auth/server");
    expect(() => auth.getSession).toThrow(/Invalid environment configuration/);
    expect(createNeonAuth).not.toHaveBeenCalled();
  });

  it("creates the auth instance once, from the settings, on first use", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/test";
    process.env.NEON_AUTH_BASE_URL = "https://auth.example.test/neondb/auth";
    process.env.NEON_AUTH_COOKIE_SECRET = "x".repeat(40);
    const { auth } = await import("@/lib/auth/server");
    expect(createNeonAuth).not.toHaveBeenCalled();
    void auth.getSession;
    void auth.signOut;
    expect(createNeonAuth).toHaveBeenCalledTimes(1);
    expect(createNeonAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://auth.example.test/neondb/auth",
        cookies: expect.objectContaining({ sessionDataTtl: 1 }),
      })
    );
  });
});

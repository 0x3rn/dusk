// tests/integration/payments-routes.int.test.ts
// /api/checkout and /api/webhook/lemonsqueezy driven through the real route handlers against the
// Neon dev branch. The payment provider is faked (global fetch); the database is real.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";

type TestUser = Awaited<ReturnType<typeof createTestUser>>["user"];
const session: { user: TestUser | null } = { user: null };

vi.mock("@/lib/auth/server", () => ({
  auth: { signOut: vi.fn(), getSession: vi.fn(), listSessions: vi.fn() },
}));
vi.mock("@/lib/auth/current-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/current-user")>();
  return {
    ...original,
    requireUser: async () => {
      if (!session.user) throw new Error("test session not set");
      return { user: session.user, authSession: { id: "sess_test" } };
    },
  };
});

import { POST as checkoutPOST } from "@/app/api/checkout/route";
import { POST as webhookPOST } from "@/app/api/webhook/lemonsqueezy/route";
import { resetServerEnvCache } from "@/lib/env";
import { signLemonSqueezyBody } from "@/lib/billing/lemonsqueezy-signature";

const ORIGIN = "http://localhost";
const SECRET = "route-test-webhook-secret";
const GOOD_URL = "https://dusk-test.lemonsqueezy.com/checkout/custom/route-test";
const KEYS = ["LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_STORE_ID", "LEMONSQUEEZY_VARIANT_ID", "LEMONSQUEEZY_WEBHOOK_SECRET"] as const;
const FULL_ENV = {
  LEMONSQUEEZY_API_KEY: "route-test-api-key",
  LEMONSQUEEZY_STORE_ID: "111",
  LEMONSQUEEZY_VARIANT_ID: "222",
  LEMONSQUEEZY_WEBHOOK_SECRET: SECRET,
};
const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};

function setPaymentsEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    if (values[key] === undefined) delete env[key];
    else env[key] = values[key];
  }
  resetServerEnvCache();
}

const users: string[] = [];
const bucketKeys: string[] = [];
const orderIds: string[] = [];

async function newUser(label: string) {
  const { user } = await createTestUser(label);
  users.push(user.id);
  bucketKeys.push(`checkout_start:${user.id.toLowerCase()}`);
  return user;
}

function checkoutRequest(headers: Record<string, string> = { origin: ORIGIN }, body: unknown = {}) {
  return new Request(`${ORIGIN}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: JSON.stringify(body),
  });
}

function orderBody(userId: string, orderId: string, over: { event?: string; status?: string; store?: number } = {}) {
  const status = over.status ?? "paid";
  return JSON.stringify({
    meta: { event_name: over.event ?? "order_created", custom_data: { user_id: userId } },
    data: {
      type: "orders",
      id: orderId,
      attributes: {
        store_id: over.store ?? 111,
        customer_id: 4242,
        status,
        refunded: status === "refunded",
        test_mode: true,
        first_order_item: { variant_id: 222 },
      },
    },
  });
}

function webhookRequest(body: string, signature: string | null, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (signature !== null) headers["x-signature"] = signature;
  return new Request(`${ORIGIN}/api/webhook/lemonsqueezy`, { method: "POST", headers, body });
}
const signed = (body: string) => webhookRequest(body, signLemonSqueezyBody(body, SECRET));
const newOrderId = () => {
  const id = `route-${Math.random().toString(36).slice(2, 12)}`;
  orderIds.push(id);
  return id;
};

beforeAll(() => {
  for (const key of KEYS) saved[key] = env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  resetServerEnvCache();
  await db.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.rateLimitBucket.deleteMany({ where: { key: { in: bucketKeys } } });
  for (const id of users) await cleanupUser(id);
  await db.$disconnect();
});

describe("POST /api/checkout", () => {
  it("answers 503 and logs which setting is missing when payments are not configured", async () => {
    setPaymentsEnv({});
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    session.user = await newUser("co-unconfigured");
    const res = await checkoutPOST(checkoutRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("PAYMENTS_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toMatch(/LEMONSQUEEZY|API_KEY/);
    expect(String(logged.mock.calls[0]?.join(" "))).toContain("LEMONSQUEEZY_API_KEY is missing");
  });

  it("creates the checkout with the user id, email and name taken from the session, not the request", async () => {
    setPaymentsEnv(FULL_ENV);
    const user = await newUser("co-ok");
    session.user = user;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { attributes: { url: GOOD_URL } } }), { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);

    // The browser tries to choose the buyer. None of it may reach Lemon Squeezy.
    const res = await checkoutPOST(
      checkoutRequest({ origin: ORIGIN }, { user_id: "someone-else", email: "evil@example.com", custom: { user_id: "x" } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: GOOD_URL });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(init.headers.Authorization).toBe("Bearer route-test-api-key");
    const sent = JSON.parse(init.body);
    expect(sent.data.attributes.checkout_data.custom).toEqual({ user_id: user.id });
    expect(sent.data.attributes.checkout_data.email).toBe(user.email);
    expect(init.body).not.toContain("someone-else");
    expect(init.body).not.toContain("evil@example.com");
    expect(sent.data.relationships.store.data.id).toBe("111");
    expect(sent.data.relationships.variant.data.id).toBe("222");
  });

  it.each([
    ["a provider error", () => new Response("{}", { status: 500 }), 502],
    ["a rejected API key", () => new Response("{}", { status: 401 }), 502],
    ["an unusable response", () => new Response("not json", { status: 200 }), 502],
  ])("answers a plain 502 for %s without leaking details", async (_label, makeResponse, status) => {
    setPaymentsEnv(FULL_ENV);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    session.user = await newUser("co-fail");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse()));
    const res = await checkoutPOST(checkoutRequest());
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toEqual({ error: "We couldn't start checkout. You haven't been charged.", code: "CHECKOUT_FAILED" });
  });

  it("answers 502 when the provider cannot be reached", async () => {
    setPaymentsEnv(FULL_ENV);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    session.user = await newUser("co-network");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect((await checkoutPOST(checkoutRequest())).status).toBe(502);
  });

  it("does not open a second checkout for an account that already has lifetime access", async () => {
    setPaymentsEnv(FULL_ENV);
    const user = await newUser("co-owned");
    await db.user.update({ where: { id: user.id }, data: { hasLifetimeAccess: true } });
    session.user = { ...user, hasLifetimeAccess: true };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkoutPOST(checkoutRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ALREADY_PURCHASED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests before doing anything", async () => {
    setPaymentsEnv(FULL_ENV);
    session.user = await newUser("co-csrf");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await checkoutPOST(checkoutRequest({ origin: "https://evil.example" }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhook/lemonsqueezy", () => {
  it.each(KEYS.filter((k) => k !== "LEMONSQUEEZY_API_KEY"))("answers 503 when %s is missing", async (missing) => {
    setPaymentsEnv({ ...FULL_ENV, [missing]: undefined });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = await newUser("wh-503");
    const body = orderBody(user.id, newOrderId());
    const res = await webhookPOST(webhookRequest(body, signLemonSqueezyBody(body, SECRET)));
    expect(res.status).toBe(503);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).hasLifetimeAccess).toBe(false);
  });

  it("refuses a missing, forged, wrong-length or tampered signature and changes nothing", async () => {
    setPaymentsEnv(FULL_ENV);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const user = await newUser("wh-forged");
    const orderId = newOrderId();
    const body = orderBody(user.id, orderId);
    const good = signLemonSqueezyBody(body, SECRET);

    expect((await webhookPOST(webhookRequest(body, null))).status).toBe(400);
    expect((await webhookPOST(webhookRequest(body, signLemonSqueezyBody(body, "attacker-secret")))).status).toBe(400);
    expect((await webhookPOST(webhookRequest(body, good.slice(0, 40)))).status).toBe(400);
    expect((await webhookPOST(webhookRequest(body.replace(user.id, "other"), good))).status).toBe(400);

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).hasLifetimeAccess).toBe(false);
    expect(await db.paymentEvent.count({ where: { orderId } })).toBe(0);
  });

  it("grants on a signed paid order, ignores a replay, then revokes on a full refund", async () => {
    setPaymentsEnv(FULL_ENV);
    const user = await newUser("wh-flow");
    const orderId = newOrderId();
    const created = orderBody(user.id, orderId);

    const first = await webhookPOST(signed(created));
    expect(first.status).toBe(200);
    expect((await first.json()).status).toBe("granted");
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.hasLifetimeAccess).toBe(true);
    expect(after.lifetimePurchasedAt).toBeInstanceOf(Date);

    const replay = await webhookPOST(signed(created));
    expect(replay.status).toBe(200);
    expect((await replay.json()).status).toBe("duplicate");
    expect(await db.auditEvent.count({ where: { userId: user.id, eventType: "LIFETIME_ACCESS_GRANTED" } })).toBe(1);

    const refund = await webhookPOST(signed(orderBody(user.id, orderId, { event: "order_refunded", status: "refunded" })));
    expect((await refund.json()).status).toBe("revoked");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).hasLifetimeAccess).toBe(false);
    expect(await db.auditEvent.count({ where: { userId: user.id, eventType: "LIFETIME_ACCESS_REVOKED" } })).toBe(1);
  });

  it("acknowledges but does not act on unpaid orders, another store, unknown events or unknown users", async () => {
    setPaymentsEnv(FULL_ENV);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = await newUser("wh-ignored");
    const results = [];
    for (const body of [
      orderBody(user.id, newOrderId(), { status: "pending" }),
      orderBody(user.id, newOrderId(), { store: 999 }),
      orderBody("no-such-user", newOrderId()),
      JSON.stringify({ meta: { event_name: "subscription_created" }, data: {} }),
    ]) {
      const res = await webhookPOST(signed(body));
      results.push([res.status, (await res.json()).status]);
    }
    expect(results).toEqual([[200, "ignored"], [200, "rejected"], [200, "rejected"], [200, "ignored"]]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).hasLifetimeAccess).toBe(false);
  });

  it("answers 400 for a signed body that is not JSON or not an order, and 413 for an oversized body", async () => {
    setPaymentsEnv(FULL_ENV);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await webhookPOST(signed("not json"))).status).toBe(400);
    expect((await webhookPOST(signed(JSON.stringify({ hello: "world" })))).status).toBe(400);
    const huge = JSON.stringify({ pad: "x".repeat(300 * 1024) });
    expect((await webhookPOST(signed(huge))).status).toBe(413);
  });
});

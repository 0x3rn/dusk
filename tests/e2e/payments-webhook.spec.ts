// tests/e2e/payments-webhook.spec.ts
// Signed Lemon Squeezy webhooks against a RUNNING dev server (Neon dev branch), using a locally
// generated signature. There is no Lemon Squeezy account involved: the test plays the part of
// Lemon Squeezy by signing payloads with the same secret the dev server was started with.
//
// Start the server with matching settings, then run the spec:
//   LEMONSQUEEZY_WEBHOOK_SECRET=<secret> LEMONSQUEEZY_STORE_ID=111 LEMONSQUEEZY_VARIANT_ID=222 npm run dev -- --port 3203
//   E2E_PORT=3203 E2E_LS_WEBHOOK_SECRET=<secret> npx playwright test payments-webhook
// Without E2E_LS_WEBHOOK_SECRET the spec is skipped.
import { expect, test } from "@playwright/test";
import { cleanupUser, createTestUser, db } from "../integration/helpers";
import { signLemonSqueezyBody } from "../../lib/billing/lemonsqueezy-signature";

const SECRET = process.env.E2E_LS_WEBHOOK_SECRET ?? "";
const STORE_ID = Number(process.env.E2E_LS_STORE_ID ?? "111");
const VARIANT_ID = Number(process.env.E2E_LS_VARIANT_ID ?? "222");
const PATH = "/api/webhook/lemonsqueezy";

test.skip(!SECRET, "Set E2E_LS_WEBHOOK_SECRET to the secret the dev server was started with.");

const userIds: string[] = [];
const orderIds: string[] = [];

test.afterAll(async () => {
  await db.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  for (const id of userIds) await cleanupUser(id);
  await db.$disconnect();
});

function body(userId: string, orderId: string, over: { event?: string; status?: string; store?: number } = {}) {
  const status = over.status ?? "paid";
  return JSON.stringify({
    meta: { event_name: over.event ?? "order_created", custom_data: { user_id: userId } },
    data: {
      type: "orders",
      id: orderId,
      attributes: {
        store_id: over.store ?? STORE_ID,
        customer_id: 31337,
        status,
        refunded: status === "refunded",
        test_mode: true,
        first_order_item: { variant_id: VARIANT_ID },
      },
    },
  });
}

async function setup(label: string) {
  const { user } = await createTestUser(label);
  userIds.push(user.id);
  const orderId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  orderIds.push(orderId);
  return { userId: user.id, orderId };
}

const hasAccess = async (userId: string) =>
  (await db.user.findUniqueOrThrow({ where: { id: userId } })).hasLifetimeAccess;

test("a signed paid order grants access once, replays do nothing, a refund removes it", async ({ request }) => {
  const { userId, orderId } = await setup("live-flow");
  const created = body(userId, orderId);
  const headers = { "Content-Type": "application/json", "X-Event-Name": "order_created", "X-Signature": signLemonSqueezyBody(created, SECRET) };

  const first = await request.post(PATH, { headers, data: created });
  expect(first.status()).toBe(200);
  expect((await first.json()).status).toBe("granted");
  expect(await hasAccess(userId)).toBe(true);

  const replay = await request.post(PATH, { headers, data: created });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).status).toBe("duplicate");
  expect(await db.auditEvent.count({ where: { userId, eventType: "LIFETIME_ACCESS_GRANTED" } })).toBe(1);

  const refund = body(userId, orderId, { event: "order_refunded", status: "refunded" });
  const refundRes = await request.post(PATH, {
    headers: { "Content-Type": "application/json", "X-Signature": signLemonSqueezyBody(refund, SECRET) },
    data: refund,
  });
  expect((await refundRes.json()).status).toBe("revoked");
  expect(await hasAccess(userId)).toBe(false);
});

test("forged, tampered, missing and malformed signatures are refused and grant nothing", async ({ request }) => {
  const { userId, orderId } = await setup("live-forged");
  const payload = body(userId, orderId);
  const good = signLemonSqueezyBody(payload, SECRET);
  const post = (signature: string | null, data = payload) =>
    request.post(PATH, {
      headers: { "Content-Type": "application/json", ...(signature === null ? {} : { "X-Signature": signature }) },
      data,
    });

  expect((await post(signLemonSqueezyBody(payload, "attacker-secret"))).status()).toBe(400); // forged
  expect((await post(good, payload.replace(userId, "someone-else"))).status()).toBe(400); // tampered
  expect((await post(null)).status()).toBe(400); // missing
  expect((await post(good.slice(0, 63))).status()).toBe(400); // wrong length
  expect((await post("not-hex".padEnd(64, "z"))).status()).toBe(400); // wrong alphabet
  expect(await hasAccess(userId)).toBe(false);
  expect(await db.paymentEvent.count({ where: { orderId } })).toBe(0);
});

test("a signed order for another store, or still unpaid, does not grant access", async ({ request }) => {
  const { userId, orderId } = await setup("live-other");
  for (const payload of [body(userId, orderId, { store: STORE_ID + 1 }), body(userId, orderId, { status: "pending" })]) {
    const res = await request.post(PATH, {
      headers: { "Content-Type": "application/json", "X-Signature": signLemonSqueezyBody(payload, SECRET) },
      data: payload,
    });
    expect(res.status()).toBe(200);
  }
  expect(await hasAccess(userId)).toBe(false);
});

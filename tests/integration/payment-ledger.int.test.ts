// tests/integration/payment-ledger.int.test.ts
// The payment ledger against the real Neon dev branch: a webhook delivered many times, even at
// the same moment, must grant (or revoke) exactly once.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";
import { PrismaBillingStore } from "@/lib/billing/prisma-billing-store";
import { handleOrderEvent, parseWebhookPayload, type OrderEvent } from "@/lib/billing/lifetime-access";

const EXPECTED = { storeId: "111", variantId: "222" };
const store = new PrismaBillingStore(db);
const orderIds: string[] = [];
const userIds: string[] = [];

function newOrderId(): string {
  const id = `itest-${randomUUID().slice(0, 12)}`;
  orderIds.push(id);
  return id;
}

function event(userId: string, orderId: string, over: { name?: "order_created" | "order_refunded"; status?: string } = {}): OrderEvent {
  const name = over.name ?? "order_created";
  const status = over.status ?? (name === "order_created" ? "paid" : "refunded");
  const parsed = parseWebhookPayload({
    meta: { event_name: name, custom_data: { user_id: userId } },
    data: {
      id: orderId,
      attributes: {
        store_id: 111,
        customer_id: 555,
        status,
        refunded: status === "refunded",
        test_mode: true,
        first_order_item: { variant_id: 222 },
      },
    },
  });
  if (parsed.kind !== "order") throw new Error("bad test payload");
  return parsed.event;
}

async function newUser(label: string) {
  const { user } = await createTestUser(label);
  userIds.push(user.id);
  return user.id;
}

const state = (userId: string) =>
  db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { hasLifetimeAccess: true, lifetimePurchasedAt: true, lemonSqueezyCustomerId: true },
  });
const auditCount = (userId: string, eventType: string) => db.auditEvent.count({ where: { userId, eventType } });

beforeAll(async () => {
  // Fails early with a clear error if migration 004 has not been applied to the dev branch.
  await db.paymentEvent.count();
});

afterAll(async () => {
  await db.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  for (const id of userIds) await cleanupUser(id);
  await db.$disconnect();
});

describe("PaymentEvent ledger", () => {
  it("grants once and stores the purchase date, customer id and an audit event", async () => {
    const userId = await newUser("grant");
    const orderId = newOrderId();
    const out = await handleOrderEvent(event(userId, orderId), EXPECTED, store);
    expect(out.status).toBe("granted");
    const user = await state(userId);
    expect(user.hasLifetimeAccess).toBe(true);
    expect(user.lifetimePurchasedAt).toBeInstanceOf(Date);
    expect(user.lemonSqueezyCustomerId).toBe("555");
    expect(await auditCount(userId, "LIFETIME_ACCESS_GRANTED")).toBe(1);
    const row = await db.paymentEvent.findUniqueOrThrow({ where: { id: `lemonsqueezy:order_created:${orderId}` } });
    expect(row).toMatchObject({ outcome: "GRANTED", userId, orderId, provider: "lemonsqueezy" });
  });

  it("does exactly one grant when the same delivery arrives 12 times concurrently", async () => {
    const userId = await newUser("race");
    const orderId = newOrderId();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => handleOrderEvent(event(userId, orderId), EXPECTED, store))
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === "granted")).toHaveLength(1);
    expect(statuses.filter((s) => s === "duplicate")).toHaveLength(11);
    expect(await auditCount(userId, "LIFETIME_ACCESS_GRANTED")).toBe(1);
    expect(await db.paymentEvent.count({ where: { orderId } })).toBe(1);
  });

  it("leaves state alone when a delivery is replayed later", async () => {
    const userId = await newUser("replay");
    const orderId = newOrderId();
    await handleOrderEvent(event(userId, orderId), EXPECTED, store);
    const before = await state(userId);
    expect((await handleOrderEvent(event(userId, orderId), EXPECTED, store)).status).toBe("duplicate");
    expect(await state(userId)).toEqual(before);
    expect(await auditCount(userId, "LIFETIME_ACCESS_GRANTED")).toBe(1);
  });

  it("revokes exactly once on a full refund, even when delivered concurrently", async () => {
    const userId = await newUser("refund");
    const orderId = newOrderId();
    await handleOrderEvent(event(userId, orderId), EXPECTED, store);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => handleOrderEvent(event(userId, orderId, { name: "order_refunded" }), EXPECTED, store))
    );
    expect(results.filter((r) => r.status === "revoked")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(7);
    expect((await state(userId)).hasLifetimeAccess).toBe(false);
    expect(await auditCount(userId, "LIFETIME_ACCESS_REVOKED")).toBe(1);
  });

  it("keeps access on a partial refund, then revokes on the later full refund", async () => {
    const userId = await newUser("partial");
    const orderId = newOrderId();
    await handleOrderEvent(event(userId, orderId), EXPECTED, store);
    const partial = await handleOrderEvent(event(userId, orderId, { name: "order_refunded", status: "partial_refund" }), EXPECTED, store);
    expect(partial.status).toBe("partial_refund");
    expect((await state(userId)).hasLifetimeAccess).toBe(true);
    const full = await handleOrderEvent(event(userId, orderId, { name: "order_refunded" }), EXPECTED, store);
    expect(full.status).toBe("revoked");
    expect((await state(userId)).hasLifetimeAccess).toBe(false);
  });

  it("keeps access when a second paid order is still standing", async () => {
    const userId = await newUser("twoorders");
    const first = newOrderId();
    const second = newOrderId();
    await handleOrderEvent(event(userId, first), EXPECTED, store);
    await handleOrderEvent(event(userId, second), EXPECTED, store);
    const out = await handleOrderEvent(event(userId, first, { name: "order_refunded" }), EXPECTED, store);
    expect(out.status).toBe("kept");
    expect((await state(userId)).hasLifetimeAccess).toBe(true);
    const last = await handleOrderEvent(event(userId, second, { name: "order_refunded" }), EXPECTED, store);
    expect(last.status).toBe("revoked");
    expect((await state(userId)).hasLifetimeAccess).toBe(false);
  });

  it("does not grant an order whose full refund was delivered first", async () => {
    const userId = await newUser("early-refund");
    const orderId = newOrderId();
    await handleOrderEvent(event(userId, orderId, { name: "order_refunded" }), EXPECTED, store);
    const out = await handleOrderEvent(event(userId, orderId), EXPECTED, store);
    expect(out.status).toBe("already_refunded");
    expect((await state(userId)).hasLifetimeAccess).toBe(false);
    expect(await auditCount(userId, "LIFETIME_ACCESS_GRANTED")).toBe(0);
  });

  it("changes nothing for a store, variant or user that does not match", async () => {
    const userId = await newUser("mismatch");
    const orderId = newOrderId();
    const wrongStore = await handleOrderEvent(event(userId, orderId), { storeId: "999", variantId: "222" }, store);
    const wrongVariant = await handleOrderEvent(event(userId, orderId), { storeId: "111", variantId: "999" }, store);
    const ghost = await handleOrderEvent(event("no-such-user", orderId), EXPECTED, store);
    expect([wrongStore.status, wrongVariant.status, ghost.status]).toEqual(["rejected", "rejected", "rejected"]);
    expect((await state(userId)).hasLifetimeAccess).toBe(false);
    expect(await db.paymentEvent.count({ where: { orderId } })).toBe(0);
  });

  it("rolls back the ledger row when the grant itself fails, so a retry can still succeed", async () => {
    const orderId = newOrderId();
    // The user exists for the existence check in the handler but is deleted before the update runs.
    await expect(
      store.grantLifetimeAccessOnce({
        eventKey: `lemonsqueezy:order_created:${orderId}`,
        orderId,
        userId: "user-that-vanished",
        customerId: null,
        testMode: true,
        now: new Date(),
      })
    ).rejects.toThrow();
    expect(await db.paymentEvent.count({ where: { orderId } })).toBe(0);
  });
});

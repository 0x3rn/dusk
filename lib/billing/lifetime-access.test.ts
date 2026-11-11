// lib/billing/lifetime-access.test.ts
import { describe, expect, it } from "vitest";
import {
  handleOrderEvent,
  ledgerKeyFor,
  parseWebhookPayload,
  type BillingStore,
  type OrderEvent,
} from "./lifetime-access";

const EXPECTED = { storeId: "111", variantId: "222" };

/** In-memory store with the same contract as PrismaBillingStore. */
class FakeBillingStore implements BillingStore {
  users = new Set(["usr_1"]);
  ledger = new Map<string, { eventName: string; orderId: string; userId: string; outcome: string }>();
  access = new Map<string, boolean>();
  customerIds = new Map<string, string | null>();

  async userExists(userId: string) {
    return this.users.has(userId);
  }

  async grantLifetimeAccessOnce(input: { eventKey: string; orderId: string; userId: string; customerId: string | null }) {
    if (this.ledger.has(input.eventKey)) return "duplicate" as const;
    const refunded = [...this.ledger.values()].some(
      (e) => e.orderId === input.orderId && e.eventName === "order_refunded" && e.outcome === "REFUNDED"
    );
    this.ledger.set(input.eventKey, {
      eventName: "order_created",
      orderId: input.orderId,
      userId: input.userId,
      outcome: refunded ? "SKIPPED_REFUNDED" : "GRANTED",
    });
    if (refunded) return "already_refunded" as const;
    this.access.set(input.userId, true);
    this.customerIds.set(input.userId, input.customerId);
    return "granted" as const;
  }

  async recordRefundOnce(input: { eventKey: string; orderId: string; userId: string; fullRefund: boolean }) {
    if (this.ledger.has(input.eventKey)) return "duplicate" as const;
    this.ledger.set(input.eventKey, {
      eventName: "order_refunded",
      orderId: input.orderId,
      userId: input.userId,
      outcome: input.fullRefund ? "REFUNDED" : "PARTIAL_REFUND",
    });
    if (!input.fullRefund) return "partial" as const;
    this.access.set(input.userId, false);
    return "revoked" as const;
  }
}

interface PayloadOptions {
  eventName?: string;
  orderId?: string | number;
  storeId?: string | number;
  variantId?: string | number | null;
  status?: string;
  refunded?: boolean;
  customData?: unknown;
}

function payload(over: PayloadOptions = {}) {
  return {
    meta: {
      event_name: over.eventName ?? "order_created",
      custom_data: over.customData === undefined ? { user_id: "usr_1" } : over.customData,
    },
    data: {
      type: "orders",
      id: over.orderId ?? 9001,
      attributes: {
        store_id: over.storeId ?? 111,
        customer_id: 777,
        status: over.status ?? "paid",
        refunded: over.refunded ?? false,
        test_mode: false,
        first_order_item: over.variantId === null ? null : { variant_id: over.variantId ?? 222 },
      },
    },
  };
}

function eventFrom(over: PayloadOptions = {}): OrderEvent {
  const parsed = parseWebhookPayload(payload(over));
  if (parsed.kind !== "order") throw new Error("test payload should parse as an order");
  return parsed.event;
}

describe("parseWebhookPayload", () => {
  it("reads an order and normalises numeric ids to strings", () => {
    expect(eventFrom()).toEqual({
      eventName: "order_created",
      orderId: "9001",
      storeId: "111",
      variantId: "222",
      customerId: "777",
      status: "paid",
      refunded: false,
      testMode: false,
      userId: "usr_1",
    });
  });

  it("ignores event types it does not act on without validating them", () => {
    expect(parseWebhookPayload({ meta: { event_name: "subscription_created" }, data: "whatever" })).toEqual({
      kind: "ignored",
      eventName: "subscription_created",
    });
  });

  it("treats shapeless or incomplete bodies as malformed", () => {
    expect(parseWebhookPayload(null).kind).toBe("malformed");
    expect(parseWebhookPayload({}).kind).toBe("malformed");
    expect(parseWebhookPayload({ meta: { event_name: "order_created" } }).kind).toBe("malformed");
    expect(
      parseWebhookPayload({ meta: { event_name: "order_created" }, data: { id: 1, attributes: {} } }).kind
    ).toBe("malformed");
  });

  it("takes the user id only from a non-empty string in meta.custom_data.user_id", () => {
    expect(eventFrom({ customData: { user_id: 5 } }).userId).toBeNull();
    expect(eventFrom({ customData: { user_id: "" } }).userId).toBeNull();
    expect(eventFrom({ customData: null }).userId).toBeNull();
    expect(eventFrom({ customData: { user_id: "x".repeat(101) } }).userId).toBeNull();
  });
});

describe("ledgerKeyFor", () => {
  it("is stable per order and distinguishes partial from full refunds", () => {
    expect(ledgerKeyFor(eventFrom())).toBe("lemonsqueezy:order_created:9001");
    expect(ledgerKeyFor(eventFrom({ eventName: "order_refunded", status: "partial_refund" }))).toBe(
      "lemonsqueezy:order_refunded:9001:partial_refund"
    );
    expect(ledgerKeyFor(eventFrom({ eventName: "order_refunded", status: "refunded" }))).toBe(
      "lemonsqueezy:order_refunded:9001:refunded"
    );
  });
});

describe("handleOrderEvent: order_created", () => {
  it("grants access for a paid order that matches our store and variant", async () => {
    const store = new FakeBillingStore();
    const out = await handleOrderEvent(eventFrom(), EXPECTED, store);
    expect(out).toEqual({ status: "granted", userId: "usr_1" });
    expect(store.access.get("usr_1")).toBe(true);
    expect(store.customerIds.get("usr_1")).toBe("777");
  });

  it.each(["pending", "failed", "refunded", "fraudulent"])(
    "ignores an order whose status is %s and records nothing",
    async (status) => {
      const store = new FakeBillingStore();
      const out = await handleOrderEvent(eventFrom({ status }), EXPECTED, store);
      expect(out.status).toBe("ignored");
      expect(store.ledger.size).toBe(0);
      expect(store.access.get("usr_1")).toBeUndefined();
    }
  );

  it("still grants when a paid delivery follows an earlier unpaid one", async () => {
    const store = new FakeBillingStore();
    await handleOrderEvent(eventFrom({ status: "pending" }), EXPECTED, store);
    const out = await handleOrderEvent(eventFrom({ status: "paid" }), EXPECTED, store);
    expect(out.status).toBe("granted");
  });

  it("rejects another store, even when the order is paid and the variant id matches", async () => {
    const store = new FakeBillingStore();
    const out = await handleOrderEvent(eventFrom({ storeId: 999 }), EXPECTED, store);
    expect(out).toEqual({ status: "rejected", reason: "STORE_MISMATCH" });
    expect(store.access.size).toBe(0);
  });

  it("rejects another variant, or an order with no items", async () => {
    const store = new FakeBillingStore();
    expect(await handleOrderEvent(eventFrom({ variantId: 5 }), EXPECTED, store)).toEqual({
      status: "rejected",
      reason: "VARIANT_MISMATCH",
    });
    expect(await handleOrderEvent(eventFrom({ variantId: null }), EXPECTED, store)).toEqual({
      status: "rejected",
      reason: "VARIANT_MISMATCH",
    });
    expect(store.access.size).toBe(0);
  });

  it("rejects an order with no user reference and one for a user that does not exist", async () => {
    const store = new FakeBillingStore();
    expect(await handleOrderEvent(eventFrom({ customData: {} }), EXPECTED, store)).toEqual({
      status: "rejected",
      reason: "MISSING_USER_REFERENCE",
    });
    expect(await handleOrderEvent(eventFrom({ customData: { user_id: "ghost" } }), EXPECTED, store)).toEqual({
      status: "rejected",
      reason: "UNKNOWN_USER",
    });
    expect(store.ledger.size).toBe(0);
  });

  it("does nothing on a duplicate delivery", async () => {
    const store = new FakeBillingStore();
    expect((await handleOrderEvent(eventFrom(), EXPECTED, store)).status).toBe("granted");
    store.access.set("usr_1", false); // prove a replay does not touch state
    expect((await handleOrderEvent(eventFrom(), EXPECTED, store)).status).toBe("duplicate");
    expect(store.access.get("usr_1")).toBe(false);
    expect(store.ledger.size).toBe(1);
  });
});

describe("handleOrderEvent: order_refunded", () => {
  const refund = (status: string) =>
    eventFrom({ eventName: "order_refunded", status, refunded: status === "refunded" });

  it("removes access on a full refund", async () => {
    const store = new FakeBillingStore();
    await handleOrderEvent(eventFrom(), EXPECTED, store);
    const out = await handleOrderEvent(refund("refunded"), EXPECTED, store);
    expect(out).toEqual({ status: "revoked", userId: "usr_1" });
    expect(store.access.get("usr_1")).toBe(false);
  });

  it("keeps access on a partial refund but records it", async () => {
    const store = new FakeBillingStore();
    await handleOrderEvent(eventFrom(), EXPECTED, store);
    const out = await handleOrderEvent(refund("partial_refund"), EXPECTED, store);
    expect(out.status).toBe("partial_refund");
    expect(store.access.get("usr_1")).toBe(true);
    expect(store.ledger.size).toBe(2);
  });

  it("ignores a repeated refund delivery", async () => {
    const store = new FakeBillingStore();
    await handleOrderEvent(eventFrom(), EXPECTED, store);
    await handleOrderEvent(refund("refunded"), EXPECTED, store);
    expect((await handleOrderEvent(refund("refunded"), EXPECTED, store)).status).toBe("duplicate");
  });

  it("revokes when a partial refund is followed by a full refund of the same order", async () => {
    const store = new FakeBillingStore();
    await handleOrderEvent(eventFrom(), EXPECTED, store);
    await handleOrderEvent(refund("partial_refund"), EXPECTED, store);
    expect((await handleOrderEvent(refund("refunded"), EXPECTED, store)).status).toBe("revoked");
    expect(store.access.get("usr_1")).toBe(false);
  });

  it("does not grant a refunded order whose refund arrived before its creation event", async () => {
    const store = new FakeBillingStore();
    await handleOrderEvent(refund("refunded"), EXPECTED, store);
    const out = await handleOrderEvent(eventFrom(), EXPECTED, store);
    expect(out.status).toBe("already_refunded");
    expect(store.access.get("usr_1")).toBe(false);
  });

  it("applies the same store and user checks as a purchase", async () => {
    const store = new FakeBillingStore();
    await handleOrderEvent(eventFrom(), EXPECTED, store);
    const wrongStore = eventFrom({ eventName: "order_refunded", status: "refunded", storeId: 1 });
    expect((await handleOrderEvent(wrongStore, EXPECTED, store)).status).toBe("rejected");
    const noUser = eventFrom({ eventName: "order_refunded", status: "refunded", customData: {} });
    expect((await handleOrderEvent(noUser, EXPECTED, store)).status).toBe("rejected");
    expect(store.access.get("usr_1")).toBe(true);
  });
});

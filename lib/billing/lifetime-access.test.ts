// lib/billing/lifetime-access.test.ts
import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  LIFETIME_PRICE_CENTS,
  buildLifetimeCheckoutParams,
  handleStripeEvent,
  type BillingStore,
} from "./lifetime-access";

class FakeBillingStore implements BillingStore {
  users = new Set(["usr_1"]);
  seenEvents = new Set<string>();
  granted: Array<{ userId: string; stripeCustomerId: string | null }> = [];

  async userExists(userId: string) {
    return this.users.has(userId);
  }

  async grantLifetimeAccessOnce(input: { eventId: string; userId: string; stripeCustomerId: string | null }) {
    if (this.seenEvents.has(input.eventId)) return "duplicate" as const;
    this.seenEvents.add(input.eventId);
    this.granted.push({ userId: input.userId, stripeCustomerId: input.stripeCustomerId });
    return "granted" as const;
  }
}

function event(over: Partial<Stripe.Checkout.Session> = {}, type = "checkout.session.completed", id = "evt_1") {
  return {
    id,
    type,
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        amount_total: LIFETIME_PRICE_CENTS,
        currency: "usd",
        client_reference_id: "usr_1",
        metadata: {},
        customer: "cus_123",
        ...over,
      },
    },
  } as unknown as Pick<Stripe.Event, "id" | "type" | "data">;
}

describe("buildLifetimeCheckoutParams", () => {
  it("binds the purchase to the server-side user and prefills the email for new customers", () => {
    const p = buildLifetimeCheckoutParams({
      userId: "usr_1",
      email: "a@b.co",
      stripeCustomerId: null,
      appUrl: "https://dusk.app/",
    });
    expect(p.mode).toBe("payment");
    expect(p.client_reference_id).toBe("usr_1");
    expect(p.customer_email).toBe("a@b.co");
    expect(p.customer).toBeUndefined();
    expect(p.line_items?.[0]).toMatchObject({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: 5000 },
    });
    expect(p.success_url).toBe("https://dusk.app/dashboard?checkout=success");
    expect(p.cancel_url).toBe("https://dusk.app/?checkout=canceled");
  });

  it("reuses the existing Stripe customer instead of an email", () => {
    const p = buildLifetimeCheckoutParams({
      userId: "usr_1",
      email: "a@b.co",
      stripeCustomerId: "cus_9",
      appUrl: "http://localhost:3000",
    });
    expect(p.customer).toBe("cus_9");
    expect(p.customer_email).toBeUndefined();
  });
});

describe("handleStripeEvent", () => {
  it("grants lifetime access for a paid checkout and records the customer", async () => {
    const store = new FakeBillingStore();
    const out = await handleStripeEvent(event(), store);
    expect(out).toEqual({ status: "granted", userId: "usr_1" });
    expect(store.granted).toEqual([{ userId: "usr_1", stripeCustomerId: "cus_123" }]);
  });

  it("is idempotent: replaying the same event id grants nothing twice", async () => {
    const store = new FakeBillingStore();
    await handleStripeEvent(event(), store);
    const again = await handleStripeEvent(event(), store);
    expect(again).toEqual({ status: "duplicate", userId: "usr_1" });
    expect(store.granted).toHaveLength(1);
  });

  it("accepts the async payment success event for delayed payment methods", async () => {
    const store = new FakeBillingStore();
    const out = await handleStripeEvent(event({}, "checkout.session.async_payment_succeeded", "evt_2"), store);
    expect(out.status).toBe("granted");
  });

  it("does not grant while payment is still pending", async () => {
    const store = new FakeBillingStore();
    const out = await handleStripeEvent(event({ payment_status: "unpaid" }), store);
    expect(out.status).toBe("ignored");
    expect(store.granted).toHaveLength(0);
  });

  it("ignores unrelated event types", async () => {
    const store = new FakeBillingStore();
    expect((await handleStripeEvent(event({}, "customer.created"), store)).status).toBe("ignored");
  });

  it.each([
    ["wrong amount", { amount_total: 100 }],
    ["wrong currency", { currency: "eur" }],
    ["missing amount", { amount_total: null }],
  ])("rejects an unexpected payment: %s", async (_label, over) => {
    const store = new FakeBillingStore();
    const out = await handleStripeEvent(event(over as Partial<Stripe.Checkout.Session>), store);
    expect(out).toEqual({ status: "rejected", reason: "AMOUNT_MISMATCH" });
    expect(store.granted).toHaveLength(0);
  });

  it("rejects a payment with no user reference, or for a user that does not exist", async () => {
    const store = new FakeBillingStore();
    expect(
      await handleStripeEvent(event({ client_reference_id: null, metadata: {} }), store)
    ).toEqual({ status: "rejected", reason: "MISSING_USER_REFERENCE" });
    expect(await handleStripeEvent(event({ client_reference_id: "usr_ghost" }), store)).toEqual({
      status: "rejected",
      reason: "UNKNOWN_USER",
    });
    expect(store.granted).toHaveLength(0);
  });

  it("handles an expanded customer object", async () => {
    const store = new FakeBillingStore();
    await handleStripeEvent(
      event({ customer: { id: "cus_obj" } as unknown as Stripe.Checkout.Session["customer"] }),
      store
    );
    expect(store.granted[0].stripeCustomerId).toBe("cus_obj");
  });
});

describe("Stripe webhook signature verification (real library, test secret)", () => {
  const stripe = new Stripe("sk_test_unused");
  const secret = "whsec_test_secret_for_unit_tests";
  const payload = JSON.stringify({ id: "evt_sig", object: "event", type: "customer.created", data: { object: {} } });

  it("accepts a correctly signed payload", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).id).toBe("evt_sig");
  });

  it("rejects a tampered payload and a wrong secret", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(() => stripe.webhooks.constructEvent(payload + " ", header, secret)).toThrow();
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_other")).toThrow();
  });
});

// lib/billing/lifetime-access.ts
// Lifetime-access purchase: what we ask Stripe to charge, and how a paid Stripe event becomes
// an entitlement. Pure logic plus a small persistence port so it can be tested without Stripe,
// the network or a database.
import type Stripe from "stripe";

export const LIFETIME_PRICE_CENTS = 5000;
export const LIFETIME_CURRENCY = "usd";
export const LIFETIME_PRODUCT_NAME = "Dusk Lifetime Access";
export const LIFETIME_PRODUCT_DESCRIPTION =
  "Encrypted digital vault with a staged release process.";

export function buildLifetimeCheckoutParams(input: {
  userId: string;
  email: string;
  stripeCustomerId: string | null;
  appUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  const base = input.appUrl.replace(/\/$/, "");
  return {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: LIFETIME_CURRENCY,
          unit_amount: LIFETIME_PRICE_CENTS,
          product_data: {
            name: LIFETIME_PRODUCT_NAME,
            description: LIFETIME_PRODUCT_DESCRIPTION,
          },
        },
      },
    ],
    // client_reference_id is set by us on the server; the webhook trusts only this, never a
    // value the browser could influence.
    client_reference_id: input.userId,
    metadata: { userId: input.userId },
    ...(input.stripeCustomerId
      ? { customer: input.stripeCustomerId }
      : { customer_email: input.email }),
    success_url: `${base}/dashboard?checkout=success`,
    cancel_url: `${base}/?checkout=canceled`,
  };
}

export interface BillingStore {
  userExists(userId: string): Promise<boolean>;
  /**
   * Atomically: record the Stripe event id and grant lifetime access.
   * Returns "duplicate" (and changes nothing) if the event id was already recorded.
   */
  grantLifetimeAccessOnce(input: {
    eventId: string;
    eventType: string;
    userId: string;
    stripeCustomerId: string | null;
    now: Date;
  }): Promise<"granted" | "duplicate">;
}

export type StripeEventOutcome =
  | { status: "granted"; userId: string }
  | { status: "duplicate"; userId: string }
  | { status: "ignored"; reason: string }
  | { status: "rejected"; reason: "UNKNOWN_USER" | "AMOUNT_MISMATCH" | "MISSING_USER_REFERENCE" };

const GRANTING_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

function customerId(customer: Stripe.Checkout.Session["customer"]): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export async function handleStripeEvent(
  event: Pick<Stripe.Event, "id" | "type" | "data">,
  store: BillingStore,
  now = new Date()
): Promise<StripeEventOutcome> {
  if (!GRANTING_EVENTS.has(event.type)) {
    return { status: "ignored", reason: `Event type ${event.type} is not handled.` };
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Delayed payment methods complete the session before money arrives; wait for success.
  if (session.payment_status !== "paid") {
    return { status: "ignored", reason: "Payment is not complete yet." };
  }

  const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
  if (!userId) {
    return { status: "rejected", reason: "MISSING_USER_REFERENCE" };
  }

  if (
    session.amount_total !== LIFETIME_PRICE_CENTS ||
    session.currency?.toLowerCase() !== LIFETIME_CURRENCY
  ) {
    return { status: "rejected", reason: "AMOUNT_MISMATCH" };
  }

  if (!(await store.userExists(userId))) {
    return { status: "rejected", reason: "UNKNOWN_USER" };
  }

  const result = await store.grantLifetimeAccessOnce({
    eventId: event.id,
    eventType: event.type,
    userId,
    stripeCustomerId: customerId(session.customer),
    now,
  });

  return { status: result, userId };
}

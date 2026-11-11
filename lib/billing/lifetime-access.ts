// lib/billing/lifetime-access.ts
// How a signed Lemon Squeezy order event becomes (or stops being) a lifetime-access entitlement.
// Pure logic plus a small persistence port, so it can be tested without the network or a database.
import { z } from "zod";

export type PaymentEventName = "order_created" | "order_refunded";

const HANDLED_EVENTS: ReadonlySet<string> = new Set<PaymentEventName>(["order_created", "order_refunded"]);

const IdSchema = z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).transform(String);

const OrderPayloadSchema = z.object({
  meta: z.object({
    event_name: z.string(),
    custom_data: z.record(z.string(), z.unknown()).nullish(),
  }),
  data: z.object({
    id: IdSchema,
    attributes: z.object({
      store_id: IdSchema,
      customer_id: IdSchema.nullish(),
      status: z.string(),
      refunded: z.boolean().nullish(),
      test_mode: z.boolean().nullish(),
      first_order_item: z.object({ variant_id: IdSchema }).nullish(),
    }),
  }),
});

export interface OrderEvent {
  eventName: PaymentEventName;
  orderId: string;
  storeId: string;
  variantId: string | null;
  customerId: string | null;
  status: string;
  refunded: boolean;
  testMode: boolean;
  /** From meta.custom_data.user_id, which only our server sets when it creates the checkout. */
  userId: string | null;
}

export type ParsedWebhook =
  | { kind: "order"; event: OrderEvent }
  | { kind: "ignored"; eventName: string }
  | { kind: "malformed" };

/** Reads an already-signature-verified webhook body. Unknown event types are ignored, not errors. */
export function parseWebhookPayload(payload: unknown): ParsedWebhook {
  const name = z.object({ meta: z.object({ event_name: z.string() }) }).safeParse(payload);
  if (!name.success) return { kind: "malformed" };
  if (!HANDLED_EVENTS.has(name.data.meta.event_name)) {
    return { kind: "ignored", eventName: name.data.meta.event_name.slice(0, 60) };
  }

  const parsed = OrderPayloadSchema.safeParse(payload);
  if (!parsed.success) return { kind: "malformed" };
  const { meta, data } = parsed.data;
  const attrs = data.attributes;
  const rawUser = meta.custom_data?.user_id;
  const userId = typeof rawUser === "string" && rawUser.length > 0 && rawUser.length <= 100 ? rawUser : null;

  return {
    kind: "order",
    event: {
      eventName: meta.event_name as PaymentEventName,
      orderId: data.id,
      storeId: attrs.store_id,
      variantId: attrs.first_order_item?.variant_id ?? null,
      customerId: attrs.customer_id ?? null,
      status: attrs.status,
      refunded: attrs.refunded === true,
      testMode: attrs.test_mode === true,
      userId,
    },
  };
}

/**
 * Lemon Squeezy sends no unique event id, so the ledger key is built from the event name and
 * the order. A refund key also carries the status, so a later full refund is not mistaken for
 * the earlier partial refund of the same order.
 */
export function ledgerKeyFor(event: OrderEvent): string {
  return event.eventName === "order_refunded"
    ? `lemonsqueezy:order_refunded:${event.orderId}:${event.status}`
    : `lemonsqueezy:${event.eventName}:${event.orderId}`;
}

export interface BillingStore {
  userExists(userId: string): Promise<boolean>;
  /**
   * Atomically record the ledger row and grant lifetime access.
   * "duplicate": the key was already recorded, nothing changed.
   * "already_refunded": a full refund for this order arrived first, so access is not granted.
   */
  grantLifetimeAccessOnce(input: {
    eventKey: string;
    orderId: string;
    userId: string;
    customerId: string | null;
    testMode: boolean;
    now: Date;
  }): Promise<"granted" | "duplicate" | "already_refunded">;
  /**
   * Atomically record the ledger row and, for a full refund, remove lifetime access (unless the
   * user has another paid, unrefunded order). A partial refund is recorded but changes nothing.
   */
  recordRefundOnce(input: {
    eventKey: string;
    orderId: string;
    userId: string;
    fullRefund: boolean;
    now: Date;
  }): Promise<"revoked" | "kept" | "partial" | "duplicate">;
}

export type PaymentOutcome =
  | { status: "granted"; userId: string }
  | { status: "revoked"; userId: string }
  | { status: "kept"; userId: string }
  | { status: "partial_refund"; userId: string }
  | { status: "duplicate"; userId: string }
  | { status: "already_refunded"; userId: string }
  | { status: "ignored"; reason: string }
  | {
      status: "rejected";
      reason: "STORE_MISMATCH" | "VARIANT_MISMATCH" | "MISSING_USER_REFERENCE" | "UNKNOWN_USER";
    };

export interface ExpectedProduct {
  storeId: string;
  variantId: string;
}

export async function handleOrderEvent(
  event: OrderEvent,
  expected: ExpectedProduct,
  store: BillingStore,
  now = new Date()
): Promise<PaymentOutcome> {
  // Our own checkouts always carry our store and variant. Anything else is another product
  // (or a forged-but-signed event from a different store) and must never grant access.
  if (event.storeId !== expected.storeId) return { status: "rejected", reason: "STORE_MISMATCH" };
  if (event.variantId !== expected.variantId) return { status: "rejected", reason: "VARIANT_MISMATCH" };

  if (event.eventName === "order_created" && event.status !== "paid") {
    // Not paid yet (or failed). Nothing is recorded, so a later paid delivery is still handled.
    return { status: "ignored", reason: `Order status is ${event.status}, not paid.` };
  }

  if (!event.userId) return { status: "rejected", reason: "MISSING_USER_REFERENCE" };
  if (!(await store.userExists(event.userId))) return { status: "rejected", reason: "UNKNOWN_USER" };

  const eventKey = ledgerKeyFor(event);

  if (event.eventName === "order_created") {
    const result = await store.grantLifetimeAccessOnce({
      eventKey,
      orderId: event.orderId,
      userId: event.userId,
      customerId: event.customerId,
      testMode: event.testMode,
      now,
    });
    return { status: result, userId: event.userId };
  }

  const fullRefund = event.refunded || event.status === "refunded";
  const result = await store.recordRefundOnce({
    eventKey,
    orderId: event.orderId,
    userId: event.userId,
    fullRefund,
    now,
  });
  return { status: result === "partial" ? "partial_refund" : result, userId: event.userId };
}

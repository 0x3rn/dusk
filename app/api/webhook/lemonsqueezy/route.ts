// app/api/webhook/lemonsqueezy/route.ts
// Lemon Squeezy calls this directly (no browser, no session cookie), so it is authenticated by
// the X-Signature header instead of CSRF/session checks. Order of work: size check, signature on
// the raw bytes, only then parse. Responses never describe our configuration or internals.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { readWebhookConfig, PaymentsNotConfiguredError } from "@/lib/billing/lemonsqueezy-checkout";
import { verifyLemonSqueezySignature } from "@/lib/billing/lemonsqueezy-signature";
import { handleOrderEvent, parseWebhookPayload } from "@/lib/billing/lifetime-access";
import { PrismaBillingStore } from "@/lib/billing/prisma-billing-store";

const LABEL = "[POST /api/webhook/lemonsqueezy]";
const MAX_BODY_BYTES = 256 * 1024; // real order payloads are a few KB

export async function POST(req: Request) {
  let config;
  try {
    config = readWebhookConfig(getServerEnv());
  } catch (err) {
    if (err instanceof PaymentsNotConfiguredError) {
      console.error(LABEL, err.message);
      return NextResponse.json({ error: "Webhook is not available." }, { status: 503 });
    }
    throw err;
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  // The signature covers the exact bytes received, so read them untouched.
  const rawBody = new Uint8Array(await req.arrayBuffer());
  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const signature = req.headers.get("x-signature");
  if (!signature) {
    console.warn(LABEL, "Rejected: missing X-Signature header.");
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }
  if (!verifyLemonSqueezySignature(rawBody, signature, config.webhookSecret)) {
    console.warn(LABEL, "Rejected: signature did not match.");
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    console.error(LABEL, "Signed body was not valid JSON.");
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const parsed = parseWebhookPayload(payload);
  if (parsed.kind === "malformed") {
    // Signed but unreadable: answer non-2xx so Lemon Squeezy shows the failed delivery.
    console.error(LABEL, "Signed payload did not have the expected shape.");
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  if (parsed.kind === "ignored") {
    return NextResponse.json({ received: true, status: "ignored" }, { status: 200 });
  }

  const { event } = parsed;
  try {
    const outcome = await handleOrderEvent(
      event,
      { storeId: config.storeId, variantId: config.variantId },
      new PrismaBillingStore(prisma)
    );
    if (outcome.status === "rejected") {
      // Acknowledge (retrying cannot fix it) but make it loud for operators.
      console.error(LABEL, "Rejected order event", {
        eventName: event.eventName,
        orderId: event.orderId,
        reason: outcome.reason,
      });
    }
    return NextResponse.json({ received: true, status: outcome.status }, { status: 200 });
  } catch (err) {
    // Non-2xx makes Lemon Squeezy retry; handling is idempotent so retries are safe.
    console.error(LABEL, "Handler failed", {
      eventName: event.eventName,
      orderId: event.orderId,
      message: err instanceof Error ? err.name : "unknown",
    });
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}

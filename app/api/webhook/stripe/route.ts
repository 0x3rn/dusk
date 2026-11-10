// app/api/webhook/stripe/route.ts
// Stripe calls this directly (no browser, no session cookie), so it is authenticated by the
// webhook signature instead of CSRF/session checks.
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { handleStripeEvent } from "@/lib/billing/lifetime-access";
import { PrismaBillingStore } from "@/lib/billing/prisma-billing-store";

export async function POST(req: Request) {
  const secret = getServerEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[POST /api/webhook/stripe] STRIPE_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // Signature verification needs the exact raw body.
  const body = await req.text();

  let event;
  try {
    event = Stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    console.warn("[POST /api/webhook/stripe] Signature verification failed.");
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event, new PrismaBillingStore(prisma));
    if (outcome.status === "rejected") {
      // Acknowledge (retrying cannot fix it) but make it loud for operators.
      console.error("[POST /api/webhook/stripe] Rejected paid event", {
        eventId: event.id,
        reason: outcome.reason,
      });
    }
    return NextResponse.json({ received: true, status: outcome.status }, { status: 200 });
  } catch (err) {
    // Non-2xx makes Stripe retry; handling is idempotent so retries are safe.
    console.error("[POST /api/webhook/stripe] Handler failed", {
      eventId: event.id,
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}

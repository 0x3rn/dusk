// app/api/checkout/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { assertSameOrigin } from "@/lib/api/csrf";
import { errorToResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { getStripe, StripeNotConfiguredError } from "@/lib/stripe";
import { ValidationError } from "@/lib/auth/security";
import { buildLifetimeCheckoutParams } from "@/lib/billing/lifetime-access";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { consumeRateLimit } from "@/lib/security/db-rate-limiter";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { user } = await requireUser();
    // Every call creates a Stripe Checkout Session, so cap how many one account can open.
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.CHECKOUT_START, user.id);

    if (user.hasLifetimeAccess) {
      throw new ValidationError("This account already has lifetime access.");
    }

    const record = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { stripeCustomerId: true },
    });

    const session = await getStripe().checkout.sessions.create(
      buildLifetimeCheckoutParams({
        userId: user.id,
        email: user.email,
        stripeCustomerId: record.stripeCustomerId,
        appUrl: getServerEnv().NEXT_PUBLIC_APP_URL,
      })
    );

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    if (err instanceof StripeNotConfiguredError) {
      console.error("[POST /api/checkout]", err.message);
      return NextResponse.json(
        { error: "Payments are not available right now.", code: "PAYMENTS_UNAVAILABLE" },
        { status: 503 }
      );
    }
    return errorToResponse(err, "POST /api/checkout");
  }
}

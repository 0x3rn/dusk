// app/api/checkout/route.ts
// Starts a Lemon Squeezy checkout for the signed-in user. The browser sends no data: the user id,
// email and name all come from the server-side session.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { assertSameOrigin } from "@/lib/api/csrf";
import { errorToResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import {
  CheckoutProviderError,
  PaymentsNotConfiguredError,
  createLifetimeCheckout,
  readCheckoutConfig,
} from "@/lib/billing/lemonsqueezy-checkout";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { consumeRateLimit } from "@/lib/security/db-rate-limiter";

const LABEL = "[POST /api/checkout]";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { user } = await requireUser();
    // Every call creates a checkout at Lemon Squeezy, so cap how many one account can open.
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.CHECKOUT_START, user.id);

    if (user.hasLifetimeAccess) {
      return NextResponse.json(
        { error: "This account already has lifetime access.", code: "ALREADY_PURCHASED" },
        { status: 409 }
      );
    }

    const env = getServerEnv();
    const config = readCheckoutConfig(env);

    const checkout = await createLifetimeCheckout({
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      appUrl: env.NEXT_PUBLIC_APP_URL,
      config,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (err: unknown) {
    if (err instanceof PaymentsNotConfiguredError) {
      console.error(LABEL, err.message);
      return NextResponse.json(
        { error: "Payments are not available right now.", code: "PAYMENTS_UNAVAILABLE" },
        { status: 503 }
      );
    }
    if (err instanceof CheckoutProviderError) {
      // Detail stays in the server log; the browser only learns that it can try again.
      console.error(LABEL, err.message, err.detail ? { detail: err.detail } : {});
      return NextResponse.json(
        {
          error: "We couldn't start checkout. You haven't been charged.",
          code: "CHECKOUT_FAILED",
        },
        { status: err.kind === "timeout" ? 504 : 502 }
      );
    }
    return errorToResponse(err, LABEL);
  }
}

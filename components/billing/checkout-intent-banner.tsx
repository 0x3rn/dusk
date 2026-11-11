"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { hasCheckoutIntent, withCheckoutIntent } from "@/lib/billing/checkout-client";

function Banner({ mode }: { mode: "register" | "login" }) {
  const params = useSearchParams();
  if (!hasCheckoutIntent(params.toString())) return null;
  return (
    <Notice tone="info" className="mb-4">
      {mode === "register"
        ? "Create your account to buy lifetime access. You'll go straight to checkout afterwards."
        : "Sign in to buy lifetime access. You'll go straight to checkout afterwards."}
    </Notice>
  );
}

/** Shown on the sign-up and sign-in pages when the visitor came from "Buy lifetime access". */
export function CheckoutIntentBanner({ mode }: { mode: "register" | "login" }) {
  return (
    <Suspense fallback={null}>
      <Banner mode={mode} />
    </Suspense>
  );
}

function IntentLinkInner({ to, className, children }: { to: "/login" | "/register"; className?: string; children: ReactNode }) {
  const params = useSearchParams();
  return (
    <Link href={withCheckoutIntent(to, params.toString())} className={className}>
      {children}
    </Link>
  );
}

/** A link between the sign-in and sign-up pages that keeps "I came to buy" with the visitor. */
export function IntentLink({ to, className, children }: { to: "/login" | "/register"; className?: string; children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Link href={to} className={className}>
          {children}
        </Link>
      }
    >
      <IntentLinkInner to={to} className={className}>
        {children}
      </IntentLinkInner>
    </Suspense>
  );
}

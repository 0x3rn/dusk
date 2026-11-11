"use client";

import React from "react";
import { BadgeCheck } from "lucide-react";
import { CheckoutError } from "@/components/billing/checkout-error";
import { useCheckout } from "@/components/billing/use-checkout";
import { buttonPrimaryClass } from "@/components/ui/form-field";
import { formatDate } from "@/lib/display-format";
import type { UserAccount } from "./types";

/** The plan shown in Settings: real state from the account, with a way to buy when there is none. */
export function PlanCard({ user }: { user: UserAccount }) {
  const { pending, error, start } = useCheckout();
  const hasLifetime = user.hasLifetimeAccess === true;
  const purchasedOn = user.lifetimePurchasedAt ? formatDate(user.lifetimePurchasedAt) : null;

  return (
    <section
      aria-labelledby="plan-heading"
      className="border border-border bg-card rounded-[14px] p-5 sm:p-7"
    >
      <h2 id="plan-heading" className="text-[18px] font-semibold text-foreground mb-1">
        Your plan
      </h2>

      {hasLifetime ? (
        <>
          <p className="text-[13px] text-foreground-secondary mb-5">
            You paid once. There is no subscription and nothing more to pay.
          </p>
          <div className="border-t border-border pt-5 grid grid-cols-1 sm:grid-cols-2 gap-5 text-[14px]">
            <div className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                Plan
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[5px] bg-accent-surface text-accent-text border border-brand/25 text-[13px] font-semibold">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Lifetime access
              </span>
            </div>
            {purchasedOn && (
              <div className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                  Purchased
                </span>
                <span className="font-semibold text-foreground">{purchasedOn}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] text-foreground-secondary mb-5">
            Lifetime access is a one-time payment of $50, with no subscription. Checkout opens on
            Lemon Squeezy, our payment provider.
          </p>
          <div className="border-t border-border pt-5 space-y-4">
            <div className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                Plan
              </span>
              <span className="font-semibold text-foreground text-[14px]">Free account</span>
            </div>
            <button
              type="button"
              onClick={start}
              disabled={pending}
              aria-busy={pending}
              className={`${buttonPrimaryClass} w-full sm:w-auto`}
            >
              {pending ? "Opening checkout..." : "Buy lifetime access"}
            </button>
            {error && <CheckoutError message={error} onRetry={start} pending={pending} />}
          </div>
        </>
      )}
    </section>
  );
}

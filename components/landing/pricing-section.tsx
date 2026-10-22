"use client";

import React from "react";
import { Check } from "lucide-react";

interface PricingSectionProps {
  onCheckout: () => void;
  isLoading?: boolean;
}

const features = [
  "Encrypted vault, locked on your device",
  "Check-in plan with reminders and a grace period",
  "Beneficiaries and trusted verifiers",
  "Choose what each beneficiary receives",
  "Recovery kit to get back in if you lose your passphrase",
  "Access to the core features included in your purchase",
];

export function PricingSection({ onCheckout, isLoading = false }: PricingSectionProps) {
  return (
    <section id="pricing" className="py-24 sm:py-28 lg:py-32 bg-canvas dark:bg-sunken border-t border-b border-border transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 text-center">
        {/* Section Header */}
        <div className="max-w-2xl mx-auto mb-16">
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            Pricing
          </span>
          <h2 className="text-[28px] sm:text-[34px] lg:text-[38px] font-semibold text-foreground leading-[1.18] tracking-[-0.02em] mb-5">
            Pay once. Keep your plan.
          </h2>
          <p className="text-[16px] sm:text-[17px] text-foreground-secondary leading-[1.65]">
            A plan that has to work years from now shouldn&apos;t depend on a subscription you have to keep paying. Pay once for the core Dusk features.
          </p>
        </div>

        {/* Pricing Card */}
        <div className="max-w-md mx-auto bg-card border border-border rounded-[14px] p-8 sm:p-10 text-left">
          {/* Card Header */}
          <div className="pb-6 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[20px] font-semibold text-foreground">
                Dusk Lifetime
              </h3>
              <span className="px-2.5 py-1 rounded-[6px] bg-accent-surface text-accent-text border border-brand/25 text-[12px] font-semibold">
                Lifetime access
              </span>
            </div>
            <p className="text-[14px] text-foreground-secondary mb-6">
              For your digital estate
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-[48px] sm:text-[52px] font-semibold text-foreground tracking-tight leading-none">
                $50
              </span>
              <span className="text-[14px] font-medium text-foreground-secondary">
                paid once
              </span>
            </div>
          </div>

          {/* Feature Bullets */}
          <div className="py-6">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary mb-4 block">
              What&apos;s included
            </span>
            <ul className="space-y-3.5">
              {features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <div className="w-4 h-4 rounded-full bg-accent-surface text-accent-text flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <span className="text-[14px] sm:text-[14.5px] text-foreground leading-snug">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={onCheckout}
              disabled={isLoading}
              className="w-full h-12 rounded-[10px] bg-brand text-on-brand hover:bg-brand-hover text-[15px] font-semibold disabled:opacity-60 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand flex items-center justify-center"
            >
              {isLoading ? "Redirecting to checkout..." : "Get Dusk Lifetime"}
            </button>
          </div>

          {/* Policy Footnote */}
          <div className="mt-5 pt-4 border-t border-border text-[12px] text-foreground-secondary leading-relaxed">
            <p className="font-medium text-foreground">
              $50 once. No subscription.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

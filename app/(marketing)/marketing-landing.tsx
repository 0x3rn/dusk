"use client";

import React, { useEffect, useState } from "react";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { ProblemSection } from "@/components/landing/problem-section";
import { WorkflowSection } from "@/components/landing/workflow-section";
import { SecuritySection } from "@/components/landing/security-section";
import { VaultCategoriesSection } from "@/components/landing/vault-categories-section";
import { ReleaseSafetySection } from "@/components/landing/release-safety-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { FAQSection } from "@/components/landing/faq-section";
import { FinalCTASection } from "@/components/landing/final-cta-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { useCheckout } from "@/components/billing/use-checkout";
import { isResumeCheckout } from "@/lib/billing/checkout-client";

export function MarketingLanding({
  initialIsAuthenticated,
}: {
  initialIsAuthenticated: boolean;
}) {
  const [isAuthenticated] = useState(initialIsAuthenticated);
  const { pending, error, start } = useCheckout();

  // After signing in or up from "Buy lifetime access", pick the purchase up where it stopped.
  useEffect(() => {
    if (!initialIsAuthenticated || !isResumeCheckout(window.location.search)) return;
    window.history.replaceState(null, "", "/#pricing"); // a refresh must not start another checkout
    document.getElementById("pricing")?.scrollIntoView({ block: "center" });
    void start();
  }, [initialIsAuthenticated, start]);

  return (
    <div className="bg-background text-foreground selection:bg-accent-surface selection:text-foreground antialiased min-h-dvh overflow-x-clip">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {/* 1. Navigation */}
      <SiteHeader isAuthenticated={isAuthenticated} />

      <main id="main-content">
        {/* 2. Hero and Product Preview */}
        <HeroSection isAuthenticated={isAuthenticated} />

        {/* 3. The Problem */}
        <ProblemSection />

        {/* 4. How Dusk Works */}
        <WorkflowSection />

        {/* 5. Zero-Knowledge Security Architecture */}
        <SecuritySection />

        {/* 6. Vault Content Categories */}
        <VaultCategoriesSection />

        {/* 7. Selective Release and False-Trigger Safeguards */}
        <ReleaseSafetySection />

        {/* 8. Lifetime Pricing */}
        <PricingSection onCheckout={start} isLoading={pending} error={error} />

        {/* 9. Frequently Asked Questions */}
        <FAQSection />

        {/* 10. Final Call To Action */}
        <FinalCTASection isAuthenticated={isAuthenticated} />
      </main>

      {/* 11. Footer */}
      <SiteFooter />
    </div>
  );
}

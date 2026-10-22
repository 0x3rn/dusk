"use client";

import React, { useState } from "react";
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

export function MarketingLanding({
  initialIsAuthenticated,
}: {
  initialIsAuthenticated: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated] = useState(initialIsAuthenticated);

  const handleCheckout = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        // Fallback to register if checkout session not directly returned
        window.location.href = "/register";
      }
    } catch (err) {
      console.error("Checkout session initialization error:", err);
      window.location.href = "/register";
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-accent-surface selection:text-foreground overflow-x-hidden antialiased">
      {/* 1. Navigation */}
      <SiteHeader isAuthenticated={isAuthenticated} />

      <main>
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
        <PricingSection onCheckout={handleCheckout} isLoading={isLoading} />

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

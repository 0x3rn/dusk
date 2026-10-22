import React from "react";
import Link from "next/link";

interface FinalCTASectionProps {
  isAuthenticated?: boolean;
}

export function FinalCTASection({ isAuthenticated = false }: FinalCTASectionProps) {
  return (
    <section className="py-24 sm:py-28 lg:py-32 bg-[var(--cta-band)] text-[var(--cta-band-text)] text-center transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12">
        <div className="max-w-2xl mx-auto flex flex-col items-center">
          {/* Headline */}
          <h2 className="text-[32px] sm:text-[42px] lg:text-[48px] font-semibold text-[var(--cta-band-text)] leading-[1.12] tracking-[-0.02em] mb-4">
            Your digital legacy deserves a plan.
          </h2>

          {/* Subtitle */}
          <p className="text-[17px] sm:text-[19px] text-[var(--cta-band-text-secondary)] leading-[1.6] mb-9">
            Protect what matters today. Decide what happens tomorrow.
          </p>

          {/* Single Green Action */}
          <div className="mb-5">
            <Link
              href={isAuthenticated ? "/dashboard" : "/register"}
              className="inline-flex items-center justify-center h-12 px-8 rounded-[10px] bg-brand text-on-brand text-[15px] font-semibold hover:bg-brand-hover transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cta-band)] focus-visible:ring-brand"
            >
              {isAuthenticated ? "Open dashboard" : "Create your vault"}
            </Link>
          </div>

          {/* Subtext */}
          <p className="text-[13px] text-[var(--cta-band-text-secondary)]">
            $50 once. No subscription.
          </p>
        </div>
      </div>
    </section>
  );
}

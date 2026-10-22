import React from "react";
import Link from "next/link";
import { ProductPreview } from "./product-preview";
import { Check } from "lucide-react";

interface HeroSectionProps {
  isAuthenticated?: boolean;
}

export function HeroSection({ isAuthenticated = false }: HeroSectionProps) {
  return (
    <section className="pt-8 pb-20 sm:pt-10 sm:pb-24 lg:pt-12 lg:pb-28 bg-background transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Column: Copy (approx 48% on desktop) */}
          <div className="lg:col-span-6 xl:col-span-5 flex flex-col items-start text-left">
            {/* Eyebrow */}
            <div className="mb-4">
              <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary">
                Digital estate vault
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-[38px] sm:text-5xl lg:text-[60px] font-semibold text-foreground leading-[1.08] tracking-[-0.03em] mb-6">
              Make sure the right people can open your digital life when you can&apos;t.
            </h1>

            {/* Body */}
            <p className="text-[16px] sm:text-[16.5px] leading-[1.65] text-foreground-secondary mb-8 max-w-xl">
              Dusk is an encrypted vault for your passwords, crypto recovery phrases, documents and final wishes. If you stop checking in, it follows a careful, step-by-step process, and only then sends each person what you assigned to them.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 w-full sm:w-auto mb-6">
              <Link
                href={isAuthenticated ? "/dashboard" : "/register"}
                className="inline-flex items-center justify-center h-12 px-6 rounded-[10px] bg-brand text-on-brand hover:bg-brand-hover text-[15px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand"
              >
                {isAuthenticated ? "Open dashboard" : "Create your vault"}
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center h-12 px-6 rounded-[10px] border border-border bg-elevated text-foreground text-[15px] font-medium hover:bg-hover transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                See how it works
              </a>
            </div>

            {/* Supporting Label */}
            <div className="flex items-center gap-2 text-[13px] text-foreground-secondary">
              <div className="flex items-center justify-center w-4 h-4 rounded-full bg-accent-surface text-accent-text shrink-0">
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </div>
              <span>$50 once. No subscription.</span>
            </div>
          </div>

          {/* Right Column: Product Preview (approx 52% on desktop) */}
          <div className="lg:col-span-6 xl:col-span-7 flex justify-center lg:justify-end">
            <ProductPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

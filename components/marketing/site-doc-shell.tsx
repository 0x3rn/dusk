import React from "react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { SiteFooter } from "@/components/landing/site-footer";
import type { SiteDoc } from "@/lib/site-docs";

export function SiteDocShell({ doc }: { doc: SiteDoc }) {
  return (
    <div className="bg-background text-foreground antialiased flex flex-col min-h-dvh">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="sticky top-0 z-50 bg-sunken border-b border-border sm:px-8 flex items-center justify-between h-16 sm:h-[68px] px-4 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <DuskLogo size={22} />
          <span className="hidden sm:inline text-[13px] text-foreground-muted">/</span>
          <span className="hidden sm:inline text-[14px] font-medium text-foreground-secondary truncate">
            {doc.title}
          </span>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-8 py-10 sm:py-20 text-left">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            {doc.category}
          </span>
          <h1
            className={`text-[28px] sm:text-[38px] font-semibold text-foreground leading-[1.15] tracking-[-0.02em] break-words ${
              doc.lastUpdated ? "mb-3" : "mb-6 sm:mb-8"
            }`}
          >
            {doc.title}
          </h1>
          {doc.lastUpdated ? (
            <p className="text-[14px] text-foreground-muted mb-6 sm:mb-8">Last updated: {doc.lastUpdated}</p>
          ) : null}
          <div className="text-[15px] text-foreground-secondary leading-[1.7] break-words">
            {doc.body}
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}

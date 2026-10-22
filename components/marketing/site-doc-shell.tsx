import React from "react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { SiteFooter } from "@/components/landing/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SiteDoc } from "@/lib/site-docs";

export function SiteDocShell({ doc }: { doc: SiteDoc }) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased flex flex-col">
      <header className="sticky top-0 z-50 h-[68px] bg-sunken border-b border-border px-6 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <DuskLogo size={22} />
          <span className="hidden sm:inline text-[13px] text-foreground-muted">/</span>
          <span className="hidden sm:inline text-[14px] font-medium text-foreground-secondary truncate">
            {doc.title}
          </span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-6 sm:px-8 py-14 sm:py-20 text-left">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            {doc.category}
          </span>
          <h1 className="text-[30px] sm:text-[38px] font-semibold text-foreground leading-[1.15] tracking-[-0.02em] mb-8">
            {doc.title}
          </h1>
          <div className="text-[15px] text-foreground-secondary leading-[1.7]">
            {doc.body}
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}

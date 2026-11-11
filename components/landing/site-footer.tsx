import React from "react";
import Link from "next/link";
import { DuskLogo } from "./dusk-logo";
import { ThemeMenuItem } from "@/components/theme-menu-item";

// Links get a 44px-tall hit area on touch screens; mouse users keep the compact list.
const linkClass =
  "inline-flex min-h-11 items-center hover:text-foreground transition-colors md:pointer-fine:min-h-0";

export function SiteFooter() {
  return (
    <footer className="bg-sunken border-t border-border py-12 sm:py-20 text-left transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-10 md:gap-12 lg:gap-16 mb-12 sm:mb-16">
          {/* Column 1: Brand & Tagline */}
          <div className="col-span-2 md:col-span-1">
            <div className="mb-4">
              <DuskLogo showTagline={true} />
            </div>
            <p className="text-[14px] text-foreground-secondary leading-[1.6]">
              Your digital life, on your terms.
            </p>
          </div>

          {/* Column 2: Product */}
          <div>
            <h4 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground mb-4">
              Product
            </h4>
            <ul className="space-y-0 md:pointer-fine:space-y-3 text-[14px] text-foreground-secondary">
              <li>
                <Link href="/#how-it-works" className={linkClass}>
                  How it works
                </Link>
              </li>
              <li>
                <Link href="/#security" className={linkClass}>
                  Security
                </Link>
              </li>
              <li>
                <Link href="/#pricing" className={linkClass}>
                  Pricing
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Resources */}
          <div>
            <h4 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground mb-4">
              Resources
            </h4>
            <ul className="space-y-0 md:pointer-fine:space-y-3 text-[14px] text-foreground-secondary">
              <li>
                <Link href="/security" className={linkClass}>
                  Security architecture
                </Link>
              </li>
              <li>
                <Link href="/recovery" className={linkClass}>
                  Recovery guide
                </Link>
              </li>
              <li>
                <Link href="/help" className={linkClass}>
                  Help center
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 4: Legal */}
          <div>
            <h4 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground mb-4">
              Legal
            </h4>
            <ul className="space-y-0 md:pointer-fine:space-y-3 text-[14px] text-foreground-secondary">
              <li>
                <Link href="/privacy" className={linkClass}>
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className={linkClass}>
                  Terms of service
                </Link>
              </li>
              <li>
                <Link href="/security/disclosures" className={linkClass}>
                  Security disclosures
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer Bottom Bar */}
        <div className="pt-8 border-t border-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-6 sm:gap-4 text-[13px] text-foreground-muted">
          <span>© {new Date().getFullYear()} Dusk Technologies. All rights reserved.</span>
          <ThemeMenuItem layout="inline" />
        </div>
      </div>
    </footer>
  );
}

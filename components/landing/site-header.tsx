"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DuskLogo } from "./dusk-logo";
import { Menu, X, ArrowRight } from "lucide-react";
import { ThemeMenuItem } from "@/components/theme-menu-item";

interface SiteHeaderProps {
  isAuthenticated?: boolean;
}

export function SiteHeader({ isAuthenticated = false }: SiteHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Lock body scroll and close on Escape while the mobile menu is open
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  const navLinks = [
    { label: "How it works", href: "#how-it-works" },
    { label: "Security", href: "#security" },
    { label: "Pricing", href: "#pricing" },
    { label: "FAQ", href: "#faq" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-sunken border-b border-border transition-colors">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-8 lg:px-12 h-16 sm:h-[72px] flex items-center justify-between gap-2">
        {/* Left: Dusk Brand */}
        <div className="flex items-center">
          <DuskLogo />
        </div>

        {/* Center: Navigation Links (Desktop) */}
        <nav
                  className="hidden md:flex items-center gap-8 text-[14px] font-medium text-foreground-secondary"
                  aria-label="Main navigation"
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md min-w-11 text-center px-2 py-3"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 sm:gap-4">
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 h-11 px-3.5 sm:px-5 rounded-[10px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand"
            >
              <span>Dashboard</span>
              <ArrowRight className="hidden sm:block w-4 h-4" />
            </Link>
          ) : (
            <div className="hidden sm:flex items-center gap-5">
              <Link
                href="/login"
                className="text-[14px] font-medium text-foreground-secondary hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-2 py-3"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand"
              >
                Get Dusk
              </Link>
            </div>
          )}

          {/* Mobile primary action if not authenticated */}
          {!isAuthenticated && (
            <Link
              href="/register"
              className="sm:hidden inline-flex items-center justify-center h-11 px-3.5 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Get Dusk
            </Link>
          )}

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden inline-flex items-center justify-center size-11 shrink-0 rounded-[8px] border border-border text-foreground hover:bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-x-0 top-16 sm:top-[72px] bottom-0 bg-sunken z-50 border-t border-border flex flex-col justify-between gap-6 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain">
          <nav className="flex flex-col pt-2 gap-1" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-[17px] font-medium text-foreground hover:text-accent-text py-3.5 border-b border-border/50 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex flex-col gap-3 pt-6 border-t border-border">
            <ThemeMenuItem className="pb-3" />
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-center gap-2 h-12 w-full rounded-[10px] bg-brand text-on-brand hover:bg-brand-hover text-[15px] font-semibold transition-colors"
              >
                <span>Go to dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center h-12 w-full rounded-[10px] border border-border text-foreground text-[15px] font-medium hover:bg-hover transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center h-12 w-full rounded-[10px] bg-brand text-on-brand hover:bg-brand-hover text-[15px] font-semibold transition-colors"
                >
                  Get Dusk
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

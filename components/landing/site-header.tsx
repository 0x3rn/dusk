"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DuskLogo } from "./dusk-logo";
import { Menu, X, ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

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

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
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
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 h-[72px] flex items-center justify-between">
        {/* Left: Dusk Brand */}
        <div className="flex items-center">
          <DuskLogo />
        </div>

        {/* Center: Navigation Links (Desktop) */}
        <nav
          className="hidden md:flex items-center gap-8 text-[14px] font-medium text-foreground-secondary"
          aria-label="Main Navigation"
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1.5 py-1"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          <ThemeToggle />
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[10px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand"
            >
              <span>Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <div className="hidden sm:flex items-center gap-5">
              <Link
                href="/login"
                className="text-[14px] font-medium text-foreground-secondary hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-2 py-1"
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
              className="sm:hidden inline-flex items-center justify-center h-10 px-3.5 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Get Dusk
            </Link>
          )}

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-[8px] border border-border text-foreground hover:bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-x-0 top-[72px] bottom-0 bg-sunken z-50 border-t border-border flex flex-col justify-between p-6 overflow-y-auto">
          <nav className="flex flex-col gap-5 pt-2" aria-label="Mobile Navigation">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-[17px] font-medium text-foreground hover:text-accent-text py-2 border-b border-border/50 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex flex-col gap-3 pt-6 border-t border-border">
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

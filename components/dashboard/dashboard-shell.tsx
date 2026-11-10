"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { DuskSymbol } from "@/components/landing/dusk-logo";
import {
  LayoutDashboard,
  KeyRound,
  Users,
  Activity,
  Clock,
  FileKey,
  Settings,
  LogOut,
  Lock,
  Unlock,
  Menu,
  X,
  ExternalLink,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { DashboardView, UserAccount } from "./types";

interface DashboardShellProps {
  currentView: DashboardView;
  onSelectView: (view: DashboardView) => void;
  user: UserAccount;
  isVaultUnlocked: boolean;
  onLockVault: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}

export function DashboardShell({
  currentView,
  onSelectView,
  user,
  isVaultUnlocked,
  onLockVault,
  onSignOut,
  children,
}: DashboardShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Derive user initials
  const initials = user.fullName
    ? user.fullName
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : user.email.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  const handleNavClick = (view: DashboardView) => {
    onSelectView(view);
    setMobileMenuOpen(false);
  };

  const workspaceNav = [
    { id: "overview" as DashboardView, label: "Overview", icon: LayoutDashboard },
    { id: "vault" as DashboardView, label: "Digital vault", icon: KeyRound },
    { id: "people" as DashboardView, label: "People & access", icon: Users },
    { id: "audit" as DashboardView, label: "Audit timeline", icon: Activity },
  ];

  const securityNav = [
    { id: "schedule" as DashboardView, label: "Check-in plan", icon: Clock },
    { id: "recovery" as DashboardView, label: "Recovery kit", icon: FileKey },
    { id: "settings" as DashboardView, label: "Settings", icon: Settings },
  ];

  const viewTitles: Record<DashboardView, string> = {
    overview: "Overview",
    vault: "Digital vault",
    people: "People & access",
    audit: "Audit timeline",
    schedule: "Check-in plan",
    recovery: "Recovery kit",
    settings: "Settings",
  };

  return (
    <div className="min-h-screen bg-canvas text-foreground flex antialiased">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {/* Desktop Sidebar (248px) */}
      <aside className="hidden lg:flex w-[248px] flex-col justify-between bg-sunken border-r border-border shrink-0 sticky top-0 h-screen overflow-y-auto">
        <div className="p-5">
          {/* Brand & Wordmark */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 group rounded-[6px]"
              aria-label="Dusk home page"
            >
              <DuskSymbol size={22} className="text-foreground" />
              <div className="flex flex-col">
                <span className="font-semibold text-[17px] tracking-tight text-foreground leading-none">
                  Dusk
                </span>
                <span className="text-xs text-foreground-secondary font-medium mt-0.5">
                  Your digital estate
                </span>
              </div>
            </Link>
          </div>

          {/* Group: WORKSPACE */}
          <div className="mb-6">
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary px-2 mb-2">
              Dashboard
            </span>
            <nav className="space-y-1" aria-label="Workspace navigation">
              {workspaceNav.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-[8px] text-[14px] font-medium transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand border ${ isActive ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:bg-hover hover:text-foreground" }`}
                  >
                    <Icon className="w-4 h-4 stroke-[1.75]" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Group: SECURITY & SETTINGS */}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary px-2 mb-2">
              Security &amp; settings
            </span>
            <nav className="space-y-1" aria-label="Security navigation">
              {securityNav.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-[8px] text-[14px] font-medium transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand border ${ isActive ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:bg-hover hover:text-foreground" }`}
                  >
                    <Icon className="w-4 h-4 stroke-[1.75]" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Footer: User Profile & Account */}
        <div className="p-4 border-t border-border bg-sunken">
          <div className="flex items-center justify-between gap-2 p-2 rounded-[8px] hover:bg-hover transition-colors">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-[var(--cta-band)] text-[var(--cta-band-text)] dark:text-accent-text border border-transparent text-[12px] font-semibold flex items-center justify-center shrink-0">
                {initials}
              </div>
              <div className="flex flex-col overflow-hidden text-left">
                <span className="text-[13px] font-semibold text-foreground truncate leading-tight">
                  {user.fullName || "Personal Vault"}
                </span>
                <span className="text-xs text-foreground-secondary truncate">
                  Personal account
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="w-10 h-10 rounded-[8px] border border-border flex items-center justify-center text-foreground-secondary hover:text-[var(--danger-fg)] hover:bg-card transition-colors shrink-0"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4 stroke-[1.75]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (64-72px) */}
        <header className="h-[68px] bg-sunken border-b border-border sticky top-0 z-40 px-6 sm:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile Menu Toggle Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-[8px] border border-border text-foreground hover:bg-hover transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Breadcrumb / Current View Title */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[13px] text-foreground-secondary">
                Dashboard
              </span>
              <span className="hidden sm:inline text-[13px] text-foreground-muted">/</span>
              <span className="text-[15px] sm:text-[16px] font-semibold text-foreground">
                {viewTitles[currentView]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3.5">
            {/* Vault Session Status & Lock Button */}
            {isVaultUnlocked ? (
              <button
                type="button"
                onClick={onLockVault}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-[8px] bg-brand text-on-brand border border-brand/40 text-[13px] font-semibold hover:bg-brand-hover transition-colors"
                title="Your vault is unlocked on this device. Select to lock it."
              >
                <Unlock className="w-4 h-4 stroke-[2]" aria-hidden="true" />
                <span>Lock vault</span>
              </button>
            ) : (
              <div
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-[8px] bg-elevated border border-border text-foreground-secondary text-[13px] font-medium"
                title="Your vault is locked. Enter your passphrase to open it."
              >
                <Lock className="w-4 h-4 stroke-[1.75]" aria-hidden="true" />
                <span className="hidden sm:inline">Vault locked</span>
                <span className="sr-only sm:hidden">Vault locked</span>
              </div>
            )}

            <ThemeToggle />

            {/* Link to Technical Security Whitepaper */}
            <Link
              href="/security"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:inline-flex items-center gap-1 text-[14px] font-medium text-foreground-secondary hover:text-foreground transition-colors rounded-[6px]"
            >
              <span>How Dusk protects you</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </Link>

            <button
              type="button"
              onClick={onSignOut}
              className="hidden sm:inline-flex items-center justify-center h-10 px-3.5 rounded-[8px] border border-border text-[14px] font-medium text-foreground-secondary hover:text-[var(--danger-fg)] hover:bg-hover transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Dynamic View Body (max-w-[1200px], padded) */}
        <main id="main-content" tabIndex={-1} className="flex-1 p-6 sm:p-8 lg:p-10 max-w-[1200px] w-full mx-auto focus:outline-none">
          {children}
        </main>
      </div>

      {/* Mobile Slide-Out Drawer */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="lg:hidden fixed inset-0 z-50 flex"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-[var(--cta-band)]/70 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative w-[280px] max-w-[85vw] bg-sunken h-full flex flex-col justify-between p-5 border-r border-border shadow-xl z-10">
            <div>
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-4 border-b border-border mb-5">
                <div className="flex items-center gap-2">
                  <DuskSymbol size={22} className="text-accent-text" />
                  <span className="font-semibold text-[17px] text-foreground">
                    Dusk
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 rounded-[8px] border border-border text-foreground hover:bg-hover transition-colors"
                  aria-label="Close menu"
                  autoFocus
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mobile Workspace Nav */}
              <div className="mb-6">
                <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary px-2 mb-2">
                  Dashboard
                </span>
                <nav className="space-y-1">
                  {workspaceNav.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentView === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavClick(item.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-[14px] font-medium transition-colors text-left ${ isActive ? "bg-accent-surface text-accent-text border border-brand/25 font-semibold" : "text-foreground-secondary hover:bg-hover hover:text-foreground" }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Mobile Security Nav */}
              <div>
                <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary px-2 mb-2">
                  Security &amp; settings
                </span>
                <nav className="space-y-1">
                  {securityNav.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentView === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavClick(item.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-[14px] font-medium transition-colors text-left ${ isActive ? "bg-accent-surface text-accent-text border border-brand/25 font-semibold" : "text-foreground-secondary hover:bg-hover hover:text-foreground" }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            </div>

            {/* Mobile Drawer Footer */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[var(--cta-band)] text-[var(--cta-band-text)] dark:text-accent-text border border-transparent text-[12px] font-semibold flex items-center justify-center">
                    {initials}
                  </div>
                  <div className="text-left">
                    <span className="block text-[13px] font-semibold text-foreground truncate max-w-[140px]">
                      {user.fullName || user.email}
                    </span>
                    <span className="block text-xs text-foreground-secondary">
                      Personal account
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="p-2.5 rounded-[8px] border border-border text-foreground-secondary hover:text-[var(--danger-fg)] transition-colors"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

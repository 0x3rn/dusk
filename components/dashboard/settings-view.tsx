"use client";

import React from "react";
import Link from "next/link";
import {
  Shield,
  Lock,
  ExternalLink,
  LogOut,
} from "lucide-react";
import { UserAccount } from "./types";
import { LEGAL_SCOPE_AND_ESTATE_DISCLAIMER } from "@/lib/security/http-hardening";

interface SettingsViewProps {
  user: UserAccount;
  isVaultUnlocked: boolean;
  onLockVault: () => void;
  onSignOut: () => void;
}

export function SettingsView({
  user,
  isVaultUnlocked,
  onLockVault,
  onSignOut,
}: SettingsViewProps) {
  return (
    <div className="space-y-8 text-left max-w-4xl">
      {/* 1. Header */}
      <div className="pb-2 border-b border-border">
        <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
          Settings
        </h1>
        <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
          Manage your personal account profile and vault security preferences.
        </p>
      </div>

      {/* 2. Account Profile Card */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <h2 className="text-[18px] font-semibold text-foreground mb-1">
          Account details
        </h2>
        <p className="text-[13px] text-foreground-secondary mb-5">
          The name and email on your account.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-[14px] border-t border-border pt-5">
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Full name
            </span>
            <span className="font-semibold text-foreground">
              {user.fullName || "Not configured"}
            </span>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Email address
            </span>
            <span className="font-semibold text-foreground">
              {user.email}
            </span>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Account status
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[5px] bg-accent-surface text-accent-text border border-brand/25 text-[12px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
              Active · Verified
            </span>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Plan
            </span>
            <span className="font-semibold text-foreground">
              Dusk Lifetime
            </span>
          </div>
        </div>
      </div>

      {/* 3. Session & Vault Security */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <h2 className="text-[18px] font-semibold text-foreground mb-1">
          Lock and sign out
        </h2>
        <p className="text-[13px] text-foreground-secondary mb-5">
          Control what stays unlocked on this device.
        </p>

        <div className="space-y-4 border-t border-border pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[10px] bg-elevated border border-border">
            <div>
              <span className="font-semibold text-[15px] text-foreground block">
                Vault lock
              </span>
              <span className="text-[13px] text-foreground-secondary">
                {isVaultUnlocked
                  ? "Your vault is unlocked on this device."
                  : "Your vault is locked. Nothing is readable on this device."}
              </span>
            </div>

            {isVaultUnlocked ? (
              <button
                type="button"
                onClick={onLockVault}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-[8px] border border-border bg-background text-foreground text-[13px] font-medium hover:bg-hover transition-colors shrink-0"
              >
                <Lock className="w-4 h-4" />
                <span>Lock vault now</span>
              </button>
            ) : (
              <span className="text-[13px] text-foreground-secondary font-medium px-3 py-1 bg-background border border-border rounded-[6px]">
                Locked
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[10px] bg-elevated border border-border">
            <div>
              <span className="font-semibold text-[15px] text-foreground block">
                Sign out of this device
              </span>
              <span className="text-[13px] text-foreground-secondary">
                Ends your session here and clears saved sign-in data from this browser.
              </span>
            </div>

            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-[8px] border border-border bg-background text-[var(--danger-fg)] text-[13px] font-medium hover:bg-[var(--danger-bg)] transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4. Technical Security & Legal Notice */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-accent-text" />
            <h2 className="text-[18px] font-semibold text-foreground">
              Security architecture
            </h2>
          </div>
          <Link
            href="/security"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-text hover:underline"
          >
            <span>Read the security architecture</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        <p className="text-[13px] text-foreground-secondary leading-relaxed">
          Your vault is encrypted on your device before upload. The full technical design (key hierarchy, per-beneficiary key wrapping, fail-closed state machines) is public.
        </p>

        <div className="p-4 rounded-[10px] bg-elevated border border-border text-[12px] text-foreground-secondary space-y-2">
          <div className="font-semibold text-foreground">
            {LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.notALegalWillHeadline}
          </div>
          <p>{LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.zeroKnowledgeCustodyNotice}</p>
          <p>{LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.estatePlanningGuidance}</p>
        </div>
      </div>
    </div>
  );
}

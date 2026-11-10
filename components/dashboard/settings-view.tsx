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
          Your account details, and how to lock your vault or sign out.
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
            <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Full name
            </span>
            <span className="font-semibold text-foreground">
              {user.fullName || "Not set"}
            </span>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Email address
            </span>
            <span className="font-semibold text-foreground">
              {user.email}
            </span>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Status
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[5px] bg-accent-surface text-accent-text border border-brand/25 text-[13px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
              Active
            </span>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
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
                    Locking closes your vault on this device. Signing out also ends your session.
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
                className="inline-flex items-center gap-2 h-11 px-4 rounded-[8px] border border-border bg-background text-foreground text-[14px] font-medium hover:bg-hover transition-colors shrink-0"
                            >
                              <Lock className="w-4 h-4" aria-hidden="true" />
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
                Ends your session in this browser. Your vault locks too.
              </span>
            </div>

            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-[8px] border border-border bg-background text-[var(--danger-fg)] text-[14px] font-medium hover:bg-[var(--danger-bg)] transition-colors shrink-0"
                          >
                            <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4. Technical Security & Legal Notice */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-accent-text" aria-hidden="true" />
            <h2 className="text-[18px] font-semibold text-foreground">
              How Dusk protects your vault
                        </h2>
          </div>
          <Link
            href="/security"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-accent-text hover:underline"
          >
            <span>Read the full explanation</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
        </div>

        <p className="text-[13px] text-foreground-secondary leading-relaxed">
          Your vault is encrypted on your device before it is uploaded. The full technical design is published for anyone to read.
        </p>

        <div className="p-4 rounded-[10px] bg-elevated border border-border text-[13px] text-foreground-secondary space-y-2">
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

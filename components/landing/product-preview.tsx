import React from "react";
import { Shield, Users, Clock, CheckCircle2, Lock, KeyRound } from "lucide-react";

export function ProductPreview() {
  return (
    <div className="w-full">
      {/* Outer Card */}
      <div className="border border-border bg-card rounded-[14px] overflow-hidden text-left shadow-xs">
        {/* Window / App Header */}
        <div className="px-5 py-3.5 border-b border-border bg-elevated flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-brand" aria-hidden="true" />
            <span className="text-[13px] font-medium text-foreground">
              Vault Console
            </span>
            <span className="text-[12px] text-foreground-muted font-mono">
              0x8F4C...79B2
            </span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-accent-surface text-accent-text border border-brand/25 text-[12px] font-semibold">
            <Lock className="w-3 h-3 text-accent-text stroke-[2]" />
            <span>Encrypted</span>
          </div>
        </div>

        {/* Dashboard Status Strip */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-card">
          <div className="p-3.5 sm:p-4">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-foreground-secondary mb-1">
              Vault Status
            </span>
            <span className="text-[13px] sm:text-[14px] font-semibold text-foreground flex items-center gap-1.5">
              Encrypted &amp; Active
            </span>
          </div>
          <div className="p-3.5 sm:p-4">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-foreground-secondary mb-1">
              Next Check-In
            </span>
            <span className="text-[13px] sm:text-[14px] font-semibold text-foreground">
              42 days remaining
            </span>
          </div>
          <div className="p-3.5 sm:p-4">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-foreground-secondary mb-1">
              Release Plan
            </span>
            <span className="text-[13px] sm:text-[14px] font-semibold text-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
              4 stages
            </span>
          </div>
        </div>

        {/* Plan Features / Summary Matrix */}
        {/* Plan Features / Summary Matrix */}
        <div className="p-5 sm:p-6 bg-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary">
                YOUR DIGITAL ESTATE
              </span>
              <h3 className="text-[16px] sm:text-[17px] font-semibold text-foreground">
                A plan you control
              </h3>
            </div>
            <span className="text-[12px] text-foreground-muted">
              Example plan
            </span>
          </div>

          {/* 4 Feature Items */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <div className="p-3.5 rounded-[10px] border border-border bg-elevated">
              <div className="flex items-center gap-2 mb-1.5">
                <Shield className="w-4 h-4 text-accent-text stroke-[1.75]" />
                <h4 className="text-[13px] font-semibold text-foreground">
                  Encrypted vault
                </h4>
              </div>
              <p className="text-[12px] text-foreground-secondary leading-relaxed">
                Everything is encrypted on your device.
              </p>
            </div>

            <div className="p-3.5 rounded-[10px] border border-border bg-elevated">
              <div className="flex items-center gap-2 mb-1.5">
                <Users className="w-4 h-4 text-accent-text stroke-[1.75]" />
                <h4 className="text-[13px] font-semibold text-foreground">
                  Chosen beneficiaries
                </h4>
              </div>
              <p className="text-[12px] text-foreground-secondary leading-relaxed">
                Choose who gets each item.
              </p>
            </div>

            <div className="p-3.5 rounded-[10px] border border-border bg-elevated">
              <div className="flex items-center gap-2 mb-1.5">
                <Clock className="w-4 h-4 text-accent-text stroke-[1.75]" />
                <h4 className="text-[13px] font-semibold text-foreground">
                  Regular check-ins
                </h4>
              </div>
              <p className="text-[12px] text-foreground-secondary leading-relaxed">
                Set how often you check in.
              </p>
            </div>

            <div className="p-3.5 rounded-[10px] border border-border bg-elevated">
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 className="w-4 h-4 text-accent-text stroke-[1.75]" />
                <h4 className="text-[13px] font-semibold text-foreground">
                  Controlled release
                </h4>
              </div>
              <p className="text-[12px] text-foreground-secondary leading-relaxed">
                Nothing is released until it&apos;s verified.
              </p>
            </div>
          </div>

          {/* Sample Assigned Packages Snippet */}
          <div className="border border-border rounded-[10px] overflow-hidden bg-card">
            <div className="bg-elevated px-3.5 py-2 border-b border-border flex items-center justify-between text-[11px] font-medium text-foreground-secondary">
              <span>Assigned package</span>
              <span>Goes to, and when</span>
            </div>
            <div className="divide-y divide-border text-[12px]">
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-accent-text" />
                  <span className="font-medium text-foreground">
                    Family &amp; Estate Instructions
                  </span>
                </div>
                <span className="text-foreground-secondary">
                  Elena · after 2 verifiers confirm
                </span>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-accent-text" />
                  <span className="font-medium text-foreground">
                    System &amp; Recovery Keys
                  </span>
                </div>
                <span className="text-foreground-secondary">
                  Marcus · after missed check-ins
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Caption */}
        <div className="px-5 py-3 border-t border-border bg-elevated text-[11px] text-foreground-muted flex items-center justify-between">
          <span>Illustrative product preview — not a live vault or a security certification.</span>
        </div>
      </div>
    </div>
  );
}

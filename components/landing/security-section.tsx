"use client";

import React, { useState } from "react";
import { Lock, Shield, Users, RefreshCw, ArrowRight, X, Laptop, Server, KeyRound } from "lucide-react";

export function SecuritySection() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <section id="security" className="py-24 sm:py-28 lg:py-32 bg-background transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 text-left">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            Privacy and security
          </span>
          <h2 className="text-[28px] sm:text-[34px] lg:text-[38px] font-semibold text-foreground leading-[1.18] tracking-[-0.02em] mb-5">
            Built so Dusk can&apos;t read your vault.
          </h2>
          <p className="text-[16px] sm:text-[17px] text-foreground-secondary leading-[1.65]">
            Your vault is encrypted on your device before it&apos;s uploaded. Dusk runs your check-ins, verification and release rules without ever being able to read what&apos;s inside. Zero-knowledge means Dusk can&apos;t read your vault, even if asked.
          </p>
        </div>

        {/* 3-Stage Architecture Diagram */}
        <div className="border border-border rounded-[14px] bg-elevated p-6 sm:p-8 lg:p-10 mb-14">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
            {/* Stage 01 */}
            <div className="bg-card border border-border rounded-[12px] p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                    01 / You
                  </span>
                  <Laptop className="w-5 h-5 text-accent-text stroke-[1.75]" />
                </div>
                <h3 className="text-[18px] font-semibold text-foreground mb-2">
                  Your device
                </h3>
                <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                  Encrypts your vault before upload.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-border text-[12px] font-mono text-foreground-secondary">
                Plaintext stays on your device
              </div>
            </div>

            {/* Stage 02 */}
            <div className="bg-card border border-border rounded-[12px] p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                    02 / Dusk
                  </span>
                  <Server className="w-5 h-5 text-accent-text stroke-[1.75]" />
                </div>
                <h3 className="text-[18px] font-semibold text-foreground mb-2">
                  Dusk&apos;s servers
                </h3>
                <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                  Stores encrypted data, runs your check-ins and enforces your release rules.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-border text-[12px] font-mono text-foreground-secondary">
                Can&apos;t open your vault on its own
              </div>
            </div>

            {/* Stage 03 */}
            <div className="bg-card border border-border rounded-[12px] p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                    03 / Them
                  </span>
                  <KeyRound className="w-5 h-5 text-accent-text stroke-[1.75]" />
                </div>
                <h3 className="text-[18px] font-semibold text-foreground mb-2">
                  Your beneficiary
                </h3>
                <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                  Gets only the items you assigned, after release is verified.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-border text-[12px] font-mono text-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
                Decrypted on their device
              </div>
            </div>
          </div>
        </div>

        {/* 4 Supporting Points */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-10 mb-12">
          <div className="flex items-start gap-4">
            <div className="w-9 h-9 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text">
              <Lock className="w-4 h-4 stroke-[1.75]" />
            </div>
            <div>
              <h4 className="text-[16px] font-semibold text-foreground mb-1.5">
                Encrypted on your device
              </h4>
              <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                Your vault is encrypted before it leaves your device. Dusk never receives your plaintext or your passwords.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-9 h-9 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text">
              <Users className="w-4 h-4 stroke-[1.75]" />
            </div>
            <div>
              <h4 className="text-[16px] font-semibold text-foreground mb-1.5">
                Separate access for each person
              </h4>
              <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                Each beneficiary gets only what you assigned to them. Their keys are created separately.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-9 h-9 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text">
              <Shield className="w-4 h-4 stroke-[1.75]" />
            </div>
            <div>
              <h4 className="text-[16px] font-semibold text-foreground mb-1.5">
                Nothing releases if Dusk is unsure
              </h4>
              <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                Dusk runs the timing and the steps, but can&apos;t open your vault by itself. If any condition isn&apos;t met, access stays locked.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-9 h-9 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text">
              <RefreshCw className="w-4 h-4 stroke-[1.75]" />
            </div>
            <div>
              <h4 className="text-[16px] font-semibold text-foreground mb-1.5">
                Recovery built in
              </h4>
              <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                Set up your recovery kit before you need it. If you lose your device or passphrase, the kit gets you back in.
              </p>
            </div>
          </div>
        </div>

        {/* Read Security Architecture Link */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 text-[15px] font-semibold text-foreground hover:text-accent-text dark:hover:text-accent-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1 py-1"
          >
            <span>Read the security architecture</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Security Architecture Documentation Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="security-modal-title"
          className="fixed inset-0 z-50 bg-[var(--cta-band)]/70 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
        >
          <div className="bg-elevated border border-border rounded-[14px] max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 sm:p-8 text-left relative shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-border mb-6">
              <div>
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                  Technical details
                </span>
                <h3 id="security-modal-title" className="text-[20px] font-semibold text-foreground">
                  Dusk security architecture
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-[8px] border border-border flex items-center justify-center text-foreground hover:bg-hover transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-6 text-[14px] text-foreground-secondary leading-relaxed">
              <p className="text-foreground">
                In short: your vault is locked with keys only you hold. Dusk runs the timers and release steps, but can&apos;t open your vault on its own.
              </p>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  1. Zero-knowledge key hierarchy
                </h4>
                <p>
                  Vault data is encrypted client-side using authenticated AES-256-GCM. The Vault Master Key (VMK) is generated on the user&apos;s device and never transmitted in plaintext to Dusk servers. The passphrase key is derived with PBKDF2-HMAC-SHA256 (600,000 iterations) and a random salt; item and file subkeys are derived with HKDF-SHA256.
                </p>
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  2. Scoped beneficiary key wrapping
                </h4>
                <p>
                  When a vault owner assigns items to a beneficiary, individual Item Encryption Keys (IEKs) are wrapped using ECDH P-256 with the beneficiary&apos;s public key or a designated release secret. Dusk stores only wrapped ciphertext envelopes. The Dusk infrastructure cannot decrypt or access the contents of individual packages.
                </p>
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  3. Inactivity engine and fail-closed release
                </h4>
                <p>
                  Dusk coordinates check-in intervals, reminders, grace periods, and trusted-verifier verifications. If any verification state is ambiguous or unfulfilled, the engine fails closed. Access keys are only assembled and made available when all configured conditions are verified.
                </p>
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  4. Independent recovery kits
                </h4>
                <p>
                  Users generate a recovery kit during vault initialization. This kit contains cryptographic recovery parameters stored solely by the user. Dusk cannot bypass your encryption via customer support or password resets.
                </p>
              </div>
            </div>

            <div className="mt-8 pt-5 border-t border-border flex items-center justify-between">
              <a
                href="/security"
                className="text-[13px] font-medium text-accent-text hover:underline flex items-center gap-1"
              >
                <span>Read the full whitepaper →</span>
              </a>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-10 px-5 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

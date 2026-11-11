"use client";

import React, { useEffect, useState } from "react";
import { Lock, LockKeyhole, Users, RefreshCw, ArrowRight, X, Laptop, Server, KeyRound } from "lucide-react";

export function SecuritySection() {
  const [modalOpen, setModalOpen] = useState(false);

  // While the dialog is open: lock page scroll and close on Escape.
  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [modalOpen]);

  return (
    <section id="security" className="py-16 sm:py-24 lg:py-32 bg-background transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 text-left">
        {/* Section Header */}
        <div className="max-w-3xl mb-10 sm:mb-16 lg:mb-20">
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
        <div className="border border-border rounded-[14px] bg-elevated p-4 sm:p-8 lg:p-10 mb-14">
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
              <LockKeyhole className="w-4 h-4 stroke-[1.75]" />
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
            className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-foreground hover:text-accent-text dark:hover:text-accent-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1 py-1"
          >
            <span>How Dusk protects your vault</span>
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
          className="fixed inset-0 z-50 bg-[var(--cta-band)]/70 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setModalOpen(false);
          }}
        >
          <div className="bg-elevated border border-border rounded-t-[14px] sm:rounded-[14px] max-w-2xl w-full max-h-[92dvh] sm:max-h-[85dvh] flex flex-col text-left relative shadow-xl">
            <div className="flex items-center justify-between gap-4 px-5 sm:px-8 pt-5 sm:pt-8 pb-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                  In plain words
                </span>
                <h3 id="security-modal-title" className="text-[20px] font-semibold text-foreground">
                  How Dusk protects your vault
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="size-11 shrink-0 rounded-[8px] border border-border flex items-center justify-center text-foreground hover:bg-hover transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-6 space-y-6 text-[14px] text-foreground-secondary leading-relaxed">
              <p className="text-foreground">
                In short: your vault is locked with keys only you hold. Dusk runs the timers and the release steps, but can&apos;t open your vault on its own.
              </p>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  Locked on your device
                </h4>
                <p>
                  Your items are locked in your browser before they are uploaded. The key comes from your master passphrase, which never leaves your device. Dusk stores only scrambled data.
                </p>
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  Each person gets only their share
                </h4>
                <p>
                  When you set an item aside for someone, your browser makes a key that works for that item and that person only. They never receive your vault key, and can&apos;t open anything you did not set aside for them.
                </p>
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  Nothing is released unless every rule is met
                </h4>
                <p>
                  Dusk sends reminders, waits through your grace period, then asks the trusted verifiers you chose. If you check in, a verifier says you are okay, or anything is unclear, nothing is released.
                </p>
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-foreground mb-1.5">
                  Recovery is yours to keep
                </h4>
                <p>
                  Your recovery kit is stored only by you. Dusk can&apos;t reset your passphrase, so keep the kit somewhere safe.
                </p>
              </div>

              <p>
                The exact methods and settings are published under{" "}
                <a href="/security#technical-details" className="text-accent-text underline underline-offset-2">
                  Technical details
                </a>
                .
              </p>
            </div>

            <div className="px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-5 border-t border-border flex items-center justify-between gap-3 shrink-0">
              <a
                href="/security"
                className="min-h-11 text-[13px] font-medium text-accent-text hover:underline flex items-center gap-1"
              >
                <span>Read the full explanation →</span>
              </a>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-11 px-5 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover transition-colors"
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

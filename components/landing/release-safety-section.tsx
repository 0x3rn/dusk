import React from "react";
import { Clock, XCircle, CheckCircle2, ShieldCheck } from "lucide-react";

export function ReleaseSafetySection() {
  return (
    <section className="py-24 sm:py-28 lg:py-32 bg-background transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 text-left">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-start">
          {/* Left Column: Narrative & Supporting Points (approx 48%) */}
          <div className="lg:col-span-6 flex flex-col items-start">
            <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
              Release rules
            </span>
            <h2 className="text-[28px] sm:text-[34px] lg:text-[38px] font-semibold text-foreground leading-[1.18] tracking-[-0.02em] mb-5">
              No single missed check-in should decide everything.
            </h2>
            <p className="text-[16px] sm:text-[17px] text-foreground-secondary leading-[1.65] mb-10">
              Life gets busy. Phones get lost. Emails go unnoticed. Dusk is designed around that reality, with a staged process that gives you opportunities to respond before your digital estate can be released.
            </p>

            {/* 4 Supporting Points */}
            <div className="space-y-6 w-full">
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text mt-0.5">
                  <Clock className="w-4 h-4 stroke-[1.75]" />
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-foreground mb-1">
                    Time to respond
                  </h4>
                  <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                    You get reminders and a grace period before anyone is contacted.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text mt-0.5">
                  <ShieldCheck className="w-4 h-4 stroke-[1.75]" />
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-foreground mb-1">
                    Trusted verification
                  </h4>
                  <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                    Trusted verifiers you choose can confirm you&apos;re okay, or confirm a release is real, before anything is sent.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text mt-0.5">
                  <XCircle className="w-4 h-4 stroke-[1.75]" />
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-foreground mb-1">
                    Cancellation and recovery
                  </h4>
                  <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                    You can stop the process at any point before release. Checking in resets your timers.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text mt-0.5">
                  <CheckCircle2 className="w-4 h-4 stroke-[1.75]" />
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-foreground mb-1">
                    Selective delivery
                  </h4>
                  <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                    Each beneficiary receives only the package explicitly assigned to them, never unrestricted vault access.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Real Release-Workflow Interface (approx 52%) */}
          <div className="lg:col-span-6 w-full">
            <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7 shadow-none">
              {/* Header */}
              <div className="flex items-center justify-between pb-5 border-b border-border mb-6">
                <div>
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                    Release workflow
                  </span>
                  <h3 className="text-[18px] sm:text-[19px] font-semibold text-foreground">
                    Inactivity verification
                  </h3>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-elevated border border-border text-[12px] font-mono font-medium text-foreground"
                  title="If Dusk is unsure at any step, it releases nothing."
                >
                  Fail-closed
                </span>
              </div>

              {/* 4 Staged Steps */}
              <div className="space-y-4">
                {/* Stage 1 */}
                <div className="p-4 rounded-[10px] border border-border bg-elevated flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full border border-border bg-elevated text-[12px] font-semibold text-foreground flex items-center justify-center shrink-0 mt-0.5">
                      1
                    </span>
                    <div>
                      <h4 className="text-[15px] font-semibold text-foreground">
                        Check-in missed
                      </h4>
                      <p className="text-[13px] text-foreground-secondary">
                        The configured check-in deadline passes.
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-[6px] bg-elevated border border-border text-[11px] font-medium text-foreground-secondary shrink-0">
                    Initial event
                  </span>
                </div>

                {/* Stage 2 */}
                <div className="p-4 rounded-[10px] border border-border bg-elevated flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full border border-border bg-elevated text-[12px] font-semibold text-foreground flex items-center justify-center shrink-0 mt-0.5">
                      2
                    </span>
                    <div>
                      <h4 className="text-[15px] font-semibold text-foreground">
                        Grace period
                      </h4>
                      <p className="text-[13px] text-foreground-secondary">
                        Reminders and time to respond.
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-[6px] bg-elevated border border-border text-[11px] font-medium text-foreground-secondary shrink-0">
                    Waiting
                  </span>
                </div>

                {/* Stage 3 */}
                <div className="p-4 rounded-[10px] border border-border bg-elevated flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full border border-border bg-elevated text-[12px] font-semibold text-foreground flex items-center justify-center shrink-0 mt-0.5">
                      3
                    </span>
                    <div>
                      <h4 className="text-[15px] font-semibold text-foreground">
                        Verification
                      </h4>
                      <p className="text-[13px] text-foreground-secondary">
                        Trusted verifiers and the other checks you set.
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-[6px] bg-elevated border border-border text-[11px] font-medium text-foreground-secondary shrink-0">
                    Pending checks
                  </span>
                </div>

                {/* Stage 4 */}
                <div className="p-4 rounded-[10px] border border-brand/25 bg-accent-surface/30 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-brand text-[12px] font-bold text-on-brand flex items-center justify-center shrink-0 mt-0.5">
                      4
                    </span>
                    <div>
                      <h4 className="text-[15px] font-semibold text-foreground">
                        Release decision
                      </h4>
                      <p className="text-[13px] text-foreground-secondary">
                        Proceed only if all required conditions pass.
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-[6px] bg-accent-surface border border-brand/25 text-[11px] font-semibold text-accent-text shrink-0">
                    Gated
                  </span>
                </div>
              </div>

              {/* Guardrails Footer */}
              <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-[12px] text-foreground-secondary">
                <span>You can cancel any time before release</span>
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-accent-text" />
                  Every step is logged
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

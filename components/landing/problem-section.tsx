import React from "react";
import { KeyRound, Users, Clock } from "lucide-react";

export function ProblemSection() {
  return (
    <section className="py-24 sm:py-28 lg:py-32 bg-background border-t border-border transition-colors">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 text-left">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            The problem
          </span>
          <h2 className="text-[28px] sm:text-[34px] lg:text-[38px] font-semibold text-foreground leading-[1.18] tracking-[-0.02em] mb-5">
            Your digital life doesn&apos;t come with a handover plan.
          </h2>
          <p className="text-[16px] sm:text-[17px] text-foreground-secondary leading-[1.65]">
            Your life is spread across accounts, devices, documents, and digital assets. If something happens to you, the people you trust may not know what exists, where to find it, or what you wanted them to do.
          </p>
        </div>

        {/* Three Editorial Blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 lg:gap-14">
          {/* Block 1 */}
          <div className="flex flex-col">
            <div className="w-10 h-10 rounded-[10px] border border-border bg-elevated flex items-center justify-center text-accent-text mb-5">
              <KeyRound className="w-5 h-5 stroke-[1.75]" />
            </div>
            <h3 className="text-[18px] sm:text-[19px] font-semibold text-foreground mb-3">
              The information exists.
            </h3>
            <p className="text-[15px] sm:text-[15.5px] text-foreground-secondary leading-[1.65]">
              Passwords, private documents, recovery phrases, and instructions are scattered across accounts and devices.
            </p>
          </div>

          {/* Block 2 */}
          <div className="flex flex-col">
            <div className="w-10 h-10 rounded-[10px] border border-border bg-elevated flex items-center justify-center text-accent-text mb-5">
              <Users className="w-5 h-5 stroke-[1.75]" />
            </div>
            <h3 className="text-[18px] sm:text-[19px] font-semibold text-foreground mb-3">
              The people matter.
            </h3>
            <p className="text-[15px] sm:text-[15.5px] text-foreground-secondary leading-[1.65]">
              Your family, trusted verifiers, or chosen beneficiaries may need specific information, not unrestricted access to everything.
            </p>
          </div>

          {/* Block 3 */}
          <div className="flex flex-col">
            <div className="w-10 h-10 rounded-[10px] border border-border bg-elevated flex items-center justify-center text-accent-text mb-5">
              <Clock className="w-5 h-5 stroke-[1.75]" />
            </div>
            <h3 className="text-[18px] sm:text-[19px] font-semibold text-foreground mb-3">
              The timing matters.
            </h3>
            <p className="text-[15px] sm:text-[15.5px] text-foreground-secondary leading-[1.65]">
              Sharing sensitive information too early is dangerous. Waiting indefinitely can be just as costly.
            </p>
          </div>
        </div>

        {/* Closing Editorial Line */}
        <div className="mt-16 pt-8 border-t border-border">
          <p className="text-[16px] sm:text-[17px] font-medium text-foreground">
            Dusk gives your digital estate a plan, without requiring you to surrender your privacy today.
          </p>
        </div>
      </div>
    </section>
  );
}

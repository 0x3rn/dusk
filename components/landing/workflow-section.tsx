import React from "react";

const steps = [
  {
    number: "01",
    title: "Secure your information",
    description:
      "Add your passwords, documents, notes and instructions to a vault that's encrypted on your device.",
    tag: "Encrypted on your device",
  },
  {
    number: "02",
    title: "Choose who gets what",
    description:
      "Assign items to each beneficiary. Add trusted verifiers separately. They help confirm things but don't receive your items.",
    tag: "Access per person",
  },
  {
    number: "03",
    title: "Set your check-in plan",
    description:
      "Choose how often you check in, how many reminders you get, and how long the grace period lasts.",
    tag: "Your schedule",
  },
  {
    number: "04",
    title: "Verify before release",
    description:
      "If you miss a check-in, Dusk sends reminders, then contacts your trusted verifiers. You can cancel by checking in.",
    tag: "Step by step",
  },
  {
    number: "05",
    title: "Send each person their items",
    description:
      "When every condition is met, each beneficiary gets only the items you assigned to them.",
    tag: "Only after verification",
  },
];

export function WorkflowSection() {
  return (
    <section id="how-it-works" className="py-24 sm:py-28 lg:py-32 bg-canvas dark:bg-sunken border-t border-b border-border">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 text-left">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            How it works
          </span>
          <h2 className="text-[28px] sm:text-[34px] lg:text-[38px] font-semibold text-foreground leading-[1.18] tracking-[-0.02em] mb-5">
            If you stop checking in, Dusk follows the plan you set.
          </h2>
          <p className="text-[16px] sm:text-[17px] text-foreground-secondary leading-[1.65]">
            A missed check-in starts a process. It never releases anything on its own. Dusk gives you time to respond, follows the verification rules you set, and only moves forward when every condition is met.
          </p>
        </div>

        {/* Desktop Connected Horizontal Pipeline */}
        <div className="hidden lg:grid grid-cols-5 gap-4 relative">
          {/* Horizontal Connecting Rail */}
          <div
            className="absolute top-6 left-6 right-6 h-[1px] bg-border z-0"
            aria-hidden="true"
          />

          {steps.map((step) => (
            <div
              key={step.number}
              className="relative z-10 flex flex-col justify-between bg-card border border-border rounded-[12px] p-5 hover:border-brand/40 transition-colors duration-150 h-full shadow-xs"
            >
              <div>
                {/* Step Number Badge */}
                <div className="mb-5">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] bg-brand text-on-brand font-mono text-[13px] font-bold shadow-xs">
                    {step.number}
                  </span>
                </div>

                {/* Title & Description */}
                <h3 className="text-[17px] font-semibold text-foreground mb-2.5 leading-snug">
                  {step.title}
                </h3>
                <p className="text-[14px] text-foreground-secondary leading-[1.6]">
                  {step.description}
                </p>
              </div>

              {/* Architectural Technical Guarantee Tag */}
              <div className="mt-5 pt-4 border-t border-border">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-elevated border border-border text-[11px] font-mono font-medium text-foreground-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
                  <span>{step.tag}</span>
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile / Tablet Vertical Continuous System */}
        <div className="lg:hidden relative">
          {/* Vertical Connecting Rail */}
          <div
            className="absolute top-4 bottom-4 left-4 w-[1px] bg-border z-0"
            aria-hidden="true"
          />

          <div className="space-y-6">
            {steps.map((step) => (
              <div
                key={step.number}
                className="relative z-10 flex items-start gap-4"
              >
                {/* Number Indicator */}
                <div className="w-8 h-8 rounded-[8px] bg-brand text-on-brand font-mono text-[13px] font-bold flex items-center justify-center shrink-0 mt-1 shadow-xs">
                  {step.number}
                </div>

                {/* Content Card */}
                <div className="flex-1 bg-card border border-border rounded-[12px] p-5 flex flex-col justify-between shadow-xs">
                  <div>
                    <h3 className="text-[16px] sm:text-[17px] font-semibold text-foreground mb-2">
                      {step.title}
                    </h3>
                    <p className="text-[14px] text-foreground-secondary leading-[1.6] mb-4">
                      {step.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-border">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-elevated border border-border text-[11px] font-mono font-medium text-foreground-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
                      <span>{step.tag}</span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

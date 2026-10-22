"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    question: "What happens if I miss a check-in?",
    answer:
      "Nothing is released. We remind you first, then give you a grace period. If you still haven't checked in, Dusk contacts your trusted verifiers. Checking in at any point stops the process.",
  },
  {
    question: "Can Dusk read my vault?",
    answer:
      "No. Your vault is encrypted on your device before it's uploaded. Dusk never has your master passphrase, your vault key or your recovery kit, so we can't read your vault, even if we are legally required to.",
  },
  {
    question: "What if I'm alive but can't access my account?",
    answer:
      "Your trusted verifiers can tell Dusk you're okay, which stops the release process. To get back into your vault, use your recovery kit.",
  },
  {
    question: "Can I choose what each beneficiary receives?",
    answer:
      "Yes. You assign items to each person. A beneficiary only receives what you assigned to them, and only after release is verified.",
  },
  {
    question: "What if I lose my recovery kit?",
    answer:
      "Dusk can't recover your vault for you. That is how it stays private. If you still know your master passphrase, you can unlock your vault and make a new kit. If you've lost both, nobody can open the vault, including us.",
  },
  {
    question: "Does Dusk replace a will or legal estate plan?",
    answer:
      "No. Dusk delivers access and instructions. It doesn't transfer legal ownership of anything. Talk to an estate-planning lawyer about a will or trust. Dusk works alongside it.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleItem = (idx: number) => {
    setOpenIndex((prev) => (prev === idx ? null : idx));
  };

  return (
    <section id="faq" className="py-24 sm:py-28 lg:py-32 bg-background transition-colors">
      <div className="max-w-3xl mx-auto px-6 sm:px-8 text-left">
        {/* Section Header */}
        <div className="mb-14 sm:mb-16">
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            FAQ
          </span>
          <h2 className="text-[28px] sm:text-[34px] lg:text-[38px] font-semibold text-foreground leading-[1.18] tracking-[-0.02em]">
            Questions people ask first
          </h2>
        </div>

        {/* 1-Pixel Divider Clean Accordion */}
        <div className="divide-y divide-border border-y border-border" role="region" aria-label="Frequently Asked Questions">
          {faqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            const contentId = `faq-content-${idx}`;
            const headerId = `faq-header-${idx}`;

            return (
              <div key={faq.question} className="py-2">
                <button
                  type="button"
                  id={headerId}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggleItem(idx)}
                  className="w-full py-4 text-left flex items-center justify-between gap-4 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md transition-colors"
                >
                  <span className="text-[16px] sm:text-[17px] font-semibold text-foreground group-hover:text-accent-text transition-colors leading-snug">
                    {faq.question}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-foreground-secondary shrink-0 transition-transform duration-200 ${ isOpen ? "rotate-180 text-accent-text" : "" }`}
                  />
                </button>

                {isOpen && (
                  <div
                    id={contentId}
                    role="region"
                    aria-labelledby={headerId}
                    className="pb-5 pt-1 text-[15px] sm:text-[15.5px] text-foreground-secondary leading-[1.65]"
                  >
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

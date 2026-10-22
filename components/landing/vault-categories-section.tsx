import React from "react";
import { KeyRound, Coins, FileText, Laptop, Landmark, HeartHandshake } from "lucide-react";

const categories = [
  {
    icon: KeyRound,
    title: "Account access",
    description: "Credentials, account recovery instructions, and access notes.",
  },
  {
    icon: Coins,
    title: "Crypto and digital assets",
    description: "Recovery instructions, wallet documentation, and asset handover plans.",
  },
  {
    icon: FileText,
    title: "Private documents",
    description: "Encrypted files, important records, and personal documents.",
  },
  {
    icon: Laptop,
    title: "Devices and systems",
    description: "Unlock steps, setup notes, and what depends on each device.",
  },
  {
    icon: Landmark,
    title: "Financial instructions",
    description: "Where your accounts are, what to do about them, and who to contact.",
  },
  {
    icon: HeartHandshake,
    title: "Final wishes",
    description: "Personal messages, preferences, and guidance for the people you leave behind.",
  },
];

export function VaultCategoriesSection() {
  return (
    <section className="py-24 sm:py-28 lg:py-32 bg-canvas dark:bg-sunken border-t border-b border-border">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-12 text-left">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-3 block">
            What you can store
          </span>
          <h2 className="text-[28px] sm:text-[34px] lg:text-[38px] font-semibold text-foreground leading-[1.18] tracking-[-0.02em] mb-5">
            Store what matters. Share only what you choose.
          </h2>
          <p className="text-[16px] sm:text-[17px] text-foreground-secondary leading-[1.65]">
            Add the details your people will need, then decide who gets which item.
          </p>
        </div>

        {/* Compact 2-Column Catalog */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {categories.map((cat) => {
            const Icon = cat.icon;
            return (
              <div
                key={cat.title}
                className="bg-card border border-border rounded-[12px] p-6 hover:border-brand/40 transition-colors duration-150 flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text">
                  <Icon className="w-5 h-5 stroke-[1.75]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-[18px] font-semibold text-foreground mb-1.5">
                    {cat.title}
                  </h3>
                  <p className="text-[14px] sm:text-[14.5px] text-foreground-secondary leading-[1.6]">
                    {cat.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footnote */}
        <div className="mt-12 pt-6 border-t border-border">
          <p className="text-[13px] text-foreground-secondary leading-relaxed">
            Dusk delivers your instructions. It does not transfer ownership of assets or replace a legally valid will or other estate documents.
          </p>
        </div>
      </div>
    </section>
  );
}

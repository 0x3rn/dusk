"use client";

import React, { useState } from "react";
import {
  Users,
  Plus,
  Trash2,
  Mail,
  Phone,
  User,
  KeyRound,
  Check,
  Copy,
} from "lucide-react";
import { ContactData, AssignmentData } from "./types";
import { formatCount } from "@/lib/display-format";

interface PeopleAccessViewProps {
  contacts: ContactData[];
  assignments: AssignmentData[];
  newlyCreatedBeneficiaryKit: {
    contactName: string;
    contactId: string;
    privateKeyBase64: string;
  } | null;
  onDismissBeneficiaryKit: () => void;
  onAddContact: (
    name: string,
    email: string,
    phone: string,
    isBeneficiary: boolean,
    isTrustedVerifier: boolean
  ) => Promise<void>;
  onRevokeContact: (contactId: string) => Promise<void>;
}

export function PeopleAccessView({
  contacts,
  assignments,
  newlyCreatedBeneficiaryKit,
  onDismissBeneficiaryKit,
  onAddContact,
  onRevokeContact,
}: PeopleAccessViewProps) {
  const [activeTab, setActiveTab] = useState<"all" | "beneficiaries" | "verifiers">("all");

  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isBeneficiary, setIsBeneficiary] = useState(true);
  const [isTrustedVerifier, setIsTrustedVerifier] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setIsSubmitting(true);
    try {
      await onAddContact(name.trim(), email.trim(), phone.trim(), isBeneficiary, isTrustedVerifier);
      setName("");
      setEmail("");
      setPhone("");
      setIsBeneficiary(true);
      setIsTrustedVerifier(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const beneficiaries = contacts.filter((c) => c.isBeneficiary);
  const verifiers = contacts.filter((c) => c.isTrustedVerifier);

  const displayedContacts =
    activeTab === "beneficiaries"
      ? beneficiaries
      : activeTab === "verifiers"
      ? verifiers
      : contacts;

  const unlockUrl =
    typeof window !== "undefined" && newlyCreatedBeneficiaryKit
      ? `${window.location.origin}/unlock/${newlyCreatedBeneficiaryKit.contactId}#${newlyCreatedBeneficiaryKit.privateKeyBase64}`
      : "";

  const handleCopyUnlockLink = () => {
    if (!unlockUrl) return;
    navigator.clipboard.writeText(unlockUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="space-y-8 text-left">
      {/* 1. Header */}
      <div className="pb-2 border-b border-border">
        <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
          People &amp; access
        </h1>
        <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
          Choose who receives your information and who helps verify your release plan.
        </p>
      </div>

      {/* Emergency Key Share URL Banner if a new beneficiary was created */}
      {newlyCreatedBeneficiaryKit && (
        <div className="border border-brand/25 bg-accent-surface/40 rounded-[12px] p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-[15px] text-foreground flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-accent-text" />
              Share private key material with {newlyCreatedBeneficiaryKit.contactName}
            </span>
            <button
              type="button"
              onClick={onDismissBeneficiaryKit}
              className="text-[12px] text-accent-text hover:underline font-medium"
            >
              Dismiss
            </button>
          </div>
          <p className="text-[13px] text-foreground mb-3 leading-relaxed">
            Dusk never stores a beneficiary&apos;s private key on the server. Send this secure unlock URL (with its offline #hash decryption key fragment) to {newlyCreatedBeneficiaryKit.contactName}:
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={unlockUrl}
              className="flex-1 h-10 px-3 rounded-[6px] border border-border bg-background font-mono text-[12px] text-foreground select-all"
            />
            <button
              type="button"
              onClick={handleCopyUnlockLink}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[6px] bg-brand text-on-brand hover:bg-brand-hover text-[13px] font-semibold transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? "Copied" : "Copy link"}</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Add Person Form (approx 4.5 cols on lg) */}
        <div className="lg:col-span-5 bg-card border border-border rounded-[14px] p-6">
          <div className="pb-4 border-b border-border mb-5">
            <h2 className="text-[18px] font-semibold text-foreground">
              Add a trusted person
            </h2>
            <p className="text-[13px] text-foreground-secondary mt-0.5">
              Choose whether this person receives items, helps verify, or both.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">
                Full name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-foreground-secondary absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Eleanor Vance"
                  className="w-full h-10 pl-9 pr-3 rounded-[8px] border border-border bg-background text-[14px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-foreground-secondary absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="eleanor@example.com"
                  className="w-full h-10 pl-9 pr-3 rounded-[8px] border border-border bg-background text-[14px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">
                Phone number (optional)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-foreground-secondary absolute left-3 top-3" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full h-10 pl-9 pr-3 rounded-[8px] border border-border bg-background text-[14px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
            </div>

            {/* Role Options */}
            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBeneficiary}
                  onChange={(e) => setIsBeneficiary(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border bg-background text-accent-text focus:ring-brand"
                />
                <div>
                  <span className="block text-[13px] font-medium text-foreground">
                    Beneficiary. Receives the items you assign to them after release.
                  </span>
                  <span className="block text-[12px] text-foreground-secondary">
                    They only get what you assign, and only after release is verified.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isTrustedVerifier}
                  onChange={(e) => setIsTrustedVerifier(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border bg-background text-accent-text focus:ring-brand"
                />
                <div>
                  <span className="block text-[13px] font-medium text-foreground">
                    Trusted verifier. Helps confirm you&apos;re okay or that a release is real.
                  </span>
                  <span className="block text-[12px] text-foreground-secondary">
                    Never receives vault contents unless you also make them a beneficiary.
                  </span>
                </div>
              </label>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold disabled:opacity-60 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Plus className="w-4 h-4" />
                <span>{isSubmitting ? "Adding person..." : "Add person"}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: People Listing & Tabs (approx 7.5 cols on lg) */}
        <div className="lg:col-span-7 bg-card border border-border rounded-[14px] p-6">
          {/* Sub-tabs for filtering */}
          <div className="flex items-center justify-between pb-4 border-b border-border mb-5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`text-[13px] px-3 py-1.5 rounded-[6px] transition-colors font-medium border ${ activeTab === "all" ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:text-foreground" }`}
              >
                All people ({contacts.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("beneficiaries")}
                className={`text-[13px] px-3 py-1.5 rounded-[6px] transition-colors font-medium border ${ activeTab === "beneficiaries" ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:text-foreground" }`}
              >
                Beneficiaries ({beneficiaries.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("verifiers")}
                className={`text-[13px] px-3 py-1.5 rounded-[6px] transition-colors font-medium border ${ activeTab === "verifiers" ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:text-foreground" }`}
              >
                Trusted verifiers ({verifiers.length})
              </button>
            </div>
          </div>

          {/* List of People */}
          {displayedContacts.length === 0 ? (
            <div className="py-14 text-center text-foreground-secondary">
              <Users className="w-8 h-8 stroke-[1.5] mx-auto mb-2 text-foreground-secondary/50" />
              <p className="text-[14px] mb-1">
                No people added yet.
              </p>
              <p className="text-[12px]">
                Add someone you trust and define their role in your digital estate.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {displayedContacts.map((contact) => {
                const assignedCount = assignments.filter((a) => a.contactId === contact.id).length;
                return (
                  <div key={contact.id} className="py-4 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-elevated border border-border flex items-center justify-center shrink-0 text-foreground font-semibold text-[13px] mt-0.5">
                        {contact.fullName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-[15px] text-foreground">
                            {contact.fullName}
                          </span>
                          {contact.isBeneficiary && (
                            <span className="px-2 py-0.5 rounded-[4px] bg-accent-surface text-accent-text border border-brand/25 text-[11px] font-semibold">
                              Beneficiary
                            </span>
                          )}
                          {contact.isTrustedVerifier && (
                            <span className="px-2 py-0.5 rounded-[4px] bg-elevated border border-border text-foreground-secondary text-[11px] font-medium">
                              Trusted verifier
                            </span>
                          )}
                        </div>
                        <span className="text-[13px] text-foreground-secondary block">
                          {contact.email} {contact.phone ? `· ${contact.phone}` : ""}
                        </span>
                        {contact.isBeneficiary && (
                          <span className="text-[11px] text-foreground-secondary block mt-0.5">
                            {assignedCount === 0
                              ? "No items assigned yet"
                              : `${formatCount(assignedCount, "item")} assigned`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onRevokeContact(contact.id)}
                        className="p-2 text-foreground-secondary hover:text-[var(--danger-fg)] rounded-[6px] transition-colors"
                        title="Remove contact"
                        aria-label="Remove contact"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

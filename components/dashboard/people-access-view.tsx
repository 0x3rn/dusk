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
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Notice } from "@/components/ui/notice";
import { fieldInputClass, fieldLabelClass, buttonPrimaryClass } from "@/components/ui/form-field";

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
  const [copyFailed, setCopyFailed] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

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

  const handleCopyUnlockLink = async () => {
    if (!unlockUrl) return;
    try {
      await navigator.clipboard.writeText(unlockUrl);
      setCopyFailed(false);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard can be blocked by the browser. The link is still selectable in the box.
      setCopyFailed(true);
    }
  };

  return (
    <div className="space-y-8 text-left">
      {/* 1. Header */}
      <div className="pb-2 border-b border-border">
        <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
          People &amp; access
        </h1>
        <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
          Choose who receives your items and who confirms you&apos;re okay if you stop checking in.
        </p>
      </div>

      {/* One-time unlock link, shown right after adding a beneficiary */}
      {newlyCreatedBeneficiaryKit && (
        <section
          aria-labelledby="unlock-link-title"
          className="border border-brand/40 bg-accent-surface/40 rounded-[12px] p-5 sm:p-6"
        >
          <h2 id="unlock-link-title" className="font-semibold text-[17px] text-foreground flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-accent-text" aria-hidden="true" />
            Send {newlyCreatedBeneficiaryKit.contactName} their unlock link
          </h2>
          <p className="text-[14px] text-foreground mt-2 leading-relaxed">
            This link lets {newlyCreatedBeneficiaryKit.contactName} open the items you give them, but only after Dusk releases them.
            Copy it and send it yourself, for example in a message or in person.
          </p>
          <Notice tone="info" className="mt-3">
            Dusk doesn&apos;t keep a copy of this link and can&apos;t show it again after you close this box.
          </Notice>
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
            <label htmlFor="unlock-link" className="sr-only">
              Unlock link for {newlyCreatedBeneficiaryKit.contactName}
            </label>
            <input
              id="unlock-link"
              type="text"
              readOnly
              value={unlockUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 h-11 px-3 rounded-[8px] border border-border bg-background font-mono text-[13px] text-foreground"
            />
            <button type="button" onClick={handleCopyUnlockLink} className={`${buttonPrimaryClass} shrink-0`}>
              {copiedLink ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
              <span>{copiedLink ? "Copied" : "Copy link"}</span>
            </button>
          </div>
          <p role="status" className="text-[13px] text-foreground-secondary mt-2 min-h-5">
            {copiedLink ? "Link copied to your clipboard." : copyFailed ? "Your browser blocked copying. Select the link above and copy it by hand." : ""}
          </p>
          <div className="mt-3">
            <ConfirmAction
              tone="default"
              title="Have you sent the link?"
              description={`Once you close this box, Dusk can't show the link again. If ${newlyCreatedBeneficiaryKit.contactName} doesn't have it, remove them and add them again to make a new one.`}
              confirmLabel="Yes, close it"
              cancelLabel="Not yet"
              onConfirm={onDismissBeneficiaryKit}
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  className="text-[14px] font-medium text-accent-text underline underline-offset-2 py-1"
                >
                  I&apos;ve sent the link
                </button>
              )}
            />
          </div>
        </section>
      )}

      {/* 2. Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Add Person Form (approx 4.5 cols on lg) */}
        <div className="lg:col-span-5 bg-card border border-border rounded-[14px] p-6">
          <div className="pb-4 border-b border-border mb-5">
            <h2 className="text-[18px] font-semibold text-foreground">
              Add a person
            </h2>
            <p className="text-[13px] text-foreground-secondary mt-0.5">
              Choose whether they receive items, confirm you&apos;re okay, or both.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="person-name" className={fieldLabelClass}>
                Full name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-foreground-secondary absolute left-3 top-3.5" aria-hidden="true" />
                <input
                  id="person-name"
                  type="text"
                  required
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Eleanor Vance"
                  className={`${fieldInputClass} pl-9`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="person-email" className={fieldLabelClass}>
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-foreground-secondary absolute left-3 top-3.5" aria-hidden="true" />
                <input
                  id="person-email"
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="eleanor@example.com"
                  className={`${fieldInputClass} pl-9`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="person-phone" className={fieldLabelClass}>
                Phone number (optional)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-foreground-secondary absolute left-3 top-3.5" aria-hidden="true" />
                <input
                  id="person-phone"
                  type="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className={`${fieldInputClass} pl-9`}
                />
              </div>
            </div>

            {/* Role Options */}
            <fieldset className="space-y-3 pt-2">
              <legend className="text-sm font-medium text-foreground mb-2">Their role (choose one or both)</legend>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBeneficiary}
                  onChange={(e) => setIsBeneficiary(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="block text-[14px] font-medium text-foreground">
                    Beneficiary
                  </span>
                  <span className="block text-[13px] text-foreground-secondary">
                    Receives only the items you give them, and only after release is confirmed.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isTrustedVerifier}
                  onChange={(e) => setIsTrustedVerifier(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="block text-[14px] font-medium text-foreground">
                    Trusted verifier
                  </span>
                  <span className="block text-[13px] text-foreground-secondary">
                    Confirms you are okay, or that a release is real. Never sees your items unless they are also a beneficiary.
                  </span>
                </div>
              </label>
            </fieldset>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || (!isBeneficiary && !isTrustedVerifier)}
                className={`${buttonPrimaryClass} w-full`}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>{isSubmitting ? "Adding..." : "Add person"}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: People Listing & Tabs (approx 7.5 cols on lg) */}
        <div className="lg:col-span-7 bg-card border border-border rounded-[14px] p-6">
          {/* Sub-tabs for filtering */}
          <div className="flex items-center justify-between pb-4 border-b border-border mb-5">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show people by role">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                aria-pressed={activeTab === "all"}
                className={`text-[14px] min-h-10 px-3 py-1.5 rounded-[8px] transition-colors font-medium border ${ activeTab === "all" ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:text-foreground" }`}
              >
                All people ({contacts.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("beneficiaries")}
                aria-pressed={activeTab === "beneficiaries"}
                className={`text-[14px] min-h-10 px-3 py-1.5 rounded-[8px] transition-colors font-medium border ${ activeTab === "beneficiaries" ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:text-foreground" }`}
              >
                Beneficiaries ({beneficiaries.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("verifiers")}
                aria-pressed={activeTab === "verifiers"}
                className={`text-[14px] min-h-10 px-3 py-1.5 rounded-[8px] transition-colors font-medium border ${ activeTab === "verifiers" ? "bg-accent-surface text-accent-text border-brand/25 font-semibold" : "border-transparent text-foreground-secondary hover:text-foreground" }`}
              >
                Trusted verifiers ({verifiers.length})
              </button>
            </div>
          </div>

          {/* List of People */}
          {displayedContacts.length === 0 ? (
            <div className="py-14 text-center text-foreground-secondary">
              <Users className="w-8 h-8 stroke-[1.5] mx-auto mb-2 text-foreground-secondary/50" aria-hidden="true" />
              <p className="text-[15px] font-medium text-foreground mb-1">
                {contacts.length === 0 ? "No one added yet" : "No one in this group"}
              </p>
              <p className="text-[14px]">
                {contacts.length === 0
                  ? "Add at least one trusted verifier and one beneficiary so your plan can work."
                  : "Choose another group above, or add someone new."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {displayedContacts.map((contact) => {
                const assignedCount = assignments.filter((a) => a.contactId === contact.id).length;
                return (
                  <div key={contact.id} className="py-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
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
                            <span className="px-2 py-0.5 rounded-[4px] bg-accent-surface text-accent-text border border-brand/25 text-xs font-semibold">
                              Beneficiary
                            </span>
                          )}
                          {contact.isTrustedVerifier && (
                            <span className="px-2 py-0.5 rounded-[4px] bg-elevated border border-border text-foreground-secondary text-xs font-medium">
                              Trusted verifier
                            </span>
                          )}
                        </div>
                        <span className="text-[14px] text-foreground-secondary block break-all">
                          {contact.email}{contact.phone ? ` · ${contact.phone}` : ""}
                        </span>
                        {contact.isBeneficiary && (
                          <span className="text-xs text-foreground-secondary block mt-0.5">
                            {assignedCount === 0
                              ? "No items assigned yet"
                              : `${formatCount(assignedCount, "item")} assigned`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {pendingRemoveId !== contact.id && (
                        <button
                          type="button"
                          onClick={() => setPendingRemoveId(contact.id)}
                          className="h-10 w-10 flex items-center justify-center text-foreground-secondary hover:text-[var(--danger-fg)] rounded-[8px] transition-colors"
                          title={`Remove ${contact.fullName}`}
                          aria-label={`Remove ${contact.fullName}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  {pendingRemoveId === contact.id && (
                    <ConfirmAction
                      defaultOpen
                      onClose={() => setPendingRemoveId(null)}
                      title={`Remove ${contact.fullName}?`}
                      description={
                        contact.isBeneficiary
                          ? "They will no longer receive any of your items, and they can't confirm anything for you. To add them back later you will need to share a new unlock link."
                          : "They will no longer be asked to confirm anything for you."
                      }
                      confirmLabel="Remove person"
                      pendingLabel="Removing..."
                      cancelLabel="Keep them"
                      onConfirm={() => onRevokeContact(contact.id)}
                      trigger={() => null}
                    />
                  )}
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

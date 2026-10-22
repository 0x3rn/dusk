"use client";

import React, { useState } from "react";
import {
  Clock,
  KeyRound,
  Users,
  UserCheck,
  FileKey,
  Lock,
  Plus,
  ArrowRight,
  Settings,
  CheckCircle2,
} from "lucide-react";
import {
  DashboardView,
  UserAccount,
  ScheduleData,
  VaultItemData,
  ContactData,
  AuditEventData,
  AssignmentData,
} from "./types";
import { getAuditEventDisplay } from "./audit-event-copy";
import { formatCount, formatDate, formatDateTime, formatRelativeTime, pluralize } from "@/lib/display-format";

interface OverviewViewProps {
  user: UserAccount;
  schedule: ScheduleData | null;
  vault: { id: string; items: VaultItemData[] } | null;
  contacts: ContactData[];
  assignments: AssignmentData[];
  auditEvents: AuditEventData[];
  isVaultUnlocked: boolean;
  decryptedItems: Record<string, { title: string; content: string; itemKeyBase64: string }>;
  daysRemaining: number;
  onNavigate: (view: DashboardView) => void;
  onCheckIn: () => Promise<void>;
  onPauseSchedule: () => Promise<void>;
  onUnlockPassphrase: (passphrase: string) => Promise<void>;
  onLockVault: () => void;
}

export function OverviewView({
  user,
  schedule,
  vault,
  contacts,
  assignments,
  auditEvents,
  isVaultUnlocked,
  decryptedItems,
  daysRemaining,
  onNavigate,
  onCheckIn,
  onPauseSchedule,
  onUnlockPassphrase,
  onLockVault,
}: OverviewViewProps) {
  const [passphraseInput, setPassphraseInput] = useState("");
  const [isSubmittingPassphrase, setIsSubmittingPassphrase] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isPausing, setIsPausing] = useState(false);

  const beneficiariesCount = contacts.filter((c) => c.isBeneficiary).length;
  const verifiersCount = contacts.filter((c) => c.isTrustedVerifier).length;
  const itemsCount = vault?.items?.length || 0;

  // Derive schedule status badge and copy
  const scheduleState = schedule?.state || "HEALTHY";
  let statusCopy = "Your check-in plan is healthy";
  let statusBadgeLabel = "Healthy";
  let statusIndicatorColor = "bg-brand";
  let statusBadgeStyle = "bg-[var(--success-bg)] text-[var(--success-fg)] border-brand/25 font-semibold";

  if (scheduleState === "PAUSED") {
    statusCopy = "Check-ins are paused";
    statusBadgeLabel = "Paused";
    statusIndicatorColor = "bg-foreground-muted";
    statusBadgeStyle = "bg-elevated text-foreground-secondary border-border";
  } else if (scheduleState === "PENDING_ESCALATION" || scheduleState === "REMINDER_DUE") {
    statusCopy = "Check-in needed";
    statusBadgeLabel = "Pending check-in";
    statusIndicatorColor = "bg-[var(--warning-fg)]";
    statusBadgeStyle = "bg-[var(--warning-bg)] text-[var(--warning-fg)] border-[var(--warning-fg)]";
  } else if (scheduleState === "VERIFICATION_REQUIRED") {
    statusCopy = "Verification required";
    statusBadgeLabel = "Verification required";
    statusIndicatorColor = "bg-[var(--danger-fg)]";
    statusBadgeStyle = "bg-[var(--danger-bg)] text-[var(--danger-fg)] border-[var(--danger-fg)]";
  }

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphraseInput) return;
    setIsSubmittingPassphrase(true);
    try {
      await onUnlockPassphrase(passphraseInput);
      setPassphraseInput("");
    } finally {
      setIsSubmittingPassphrase(false);
    }
  };

  const handleCheckInClick = async () => {
    setIsCheckingIn(true);
    try {
      await onCheckIn();
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handlePauseClick = async () => {
    setIsPausing(true);
    try {
      await onPauseSchedule();
    } finally {
      setIsPausing(false);
    }
  };

  const firstName = user.fullName ? user.fullName.split(" ")[0] : "there";

  return (
    <div className="space-y-8 text-left">
      {/* 1. Page Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
            Good to see you, {firstName}.
          </h1>
          <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
            Keep your information secure, your instructions organized, and your access plan up to date.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => onNavigate("vault")}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Plus className="w-4 h-4 stroke-[2]" />
            <span>Add to vault</span>
          </button>
        </div>
      </div>

      {/* 2. Check-In Status Card */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-[12px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text">
              <Clock className="w-6 h-6 stroke-[1.75]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h2 className="text-[20px] font-semibold text-foreground">
                  {statusCopy}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[5px] border text-[11px] font-medium ${statusBadgeStyle}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusIndicatorColor}`} />
                  {statusBadgeLabel}
                </span>
              </div>
              <p className="text-[14px] text-foreground-secondary">
                {scheduleState === "PAUSED"
                  ? "Your check-in schedule is temporarily suspended."
                  : `Your next check-in is due in ${daysRemaining} days.`}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isCheckingIn}
              onClick={handleCheckInClick}
              className="inline-flex items-center justify-center h-10 px-5 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {isCheckingIn ? "Confirming..." : "I'm alive"}
            </button>
            <button
              type="button"
              disabled={isPausing}
              onClick={handlePauseClick}
              className="inline-flex items-center justify-center h-10 px-4 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover disabled:opacity-50 transition-colors"
            >
              {isPausing ? "Pausing..." : "Pause for 30 days"}
            </button>
            <button
              type="button"
              onClick={() => onNavigate("schedule")}
              className="inline-flex items-center justify-center h-10 px-3.5 rounded-[8px] border border-border bg-elevated text-foreground-secondary text-[14px] font-medium hover:text-foreground hover:bg-hover transition-colors"
              title="Manage check-in schedule"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Schedule Metric Columns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 text-left">
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              Next check-in
            </span>
            <span className="text-[17px] font-semibold text-foreground tabular-nums">
              {scheduleState === "PAUSED" ? "Paused" : `In ${daysRemaining} days`}
            </span>
          </div>
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              Grace period
            </span>
            <span className="text-[17px] font-semibold text-foreground tabular-nums">
              {schedule?.gracePeriodDays || 14} days
            </span>
          </div>
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              Check-in interval
            </span>
            <span className="text-[17px] font-semibold text-foreground tabular-nums">
              {schedule?.intervalDays || 90} days
            </span>
          </div>
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              Safety mode
            </span>
            <span
              className="text-[17px] font-semibold text-foreground flex items-center gap-1.5"
              title="If Dusk is unsure at any step, it releases nothing."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
              Fail-closed
            </span>
          </div>
        </div>
      </div>

      {/* 3. Summary Cards (3-4 compact cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Encrypted Items */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate("vault")}
          onKeyDown={(e) => e.key === "Enter" && onNavigate("vault")}
          className="p-5 rounded-[12px] bg-card border border-border hover:border-brand/40 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[32px] font-semibold text-foreground leading-none tabular-nums">
              {itemsCount}
            </span>
            <KeyRound className="w-5 h-5 text-foreground-secondary stroke-[1.75]" />
          </div>
          <h3 className="text-[15px] font-semibold text-foreground mb-0.5">
            {pluralize(itemsCount, "Encrypted item", "Encrypted items")}
          </h3>
          <p className="text-[12px] text-foreground-secondary">
            Stored in your digital vault
          </p>
        </div>

        {/* Card 2: Beneficiaries */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate("people")}
          onKeyDown={(e) => e.key === "Enter" && onNavigate("people")}
          className="p-5 rounded-[12px] bg-card border border-border hover:border-brand/40 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[32px] font-semibold text-foreground leading-none tabular-nums">
              {beneficiariesCount}
            </span>
            <Users className="w-5 h-5 text-foreground-secondary stroke-[1.75]" />
          </div>
          <h3 className="text-[15px] font-semibold text-foreground mb-0.5">
            {pluralize(beneficiariesCount, "Beneficiary", "Beneficiaries")}
          </h3>
          <p className="text-[12px] text-foreground-secondary">
            People who will receive your items
          </p>
        </div>

        {/* Card 3: Trusted Contacts */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate("people")}
          onKeyDown={(e) => e.key === "Enter" && onNavigate("people")}
          className="p-5 rounded-[12px] bg-card border border-border hover:border-brand/40 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[32px] font-semibold text-foreground leading-none tabular-nums">
              {verifiersCount}
            </span>
            <UserCheck className="w-5 h-5 text-foreground-secondary stroke-[1.75]" />
          </div>
          <h3 className="text-[15px] font-semibold text-foreground mb-0.5">
            {pluralize(verifiersCount, "Trusted verifier", "Trusted verifiers")}
          </h3>
          <p className="text-[12px] text-foreground-secondary">
            People who help confirm your plan
          </p>
        </div>

        {/* Card 4: Security & Recovery */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate("recovery")}
          onKeyDown={(e) => e.key === "Enter" && onNavigate("recovery")}
          className="p-5 rounded-[12px] bg-card border border-border hover:border-brand/40 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-medium text-accent-text inline-flex items-center gap-1">
              Review
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
            <FileKey className="w-5 h-5 text-accent-text stroke-[1.75]" />
          </div>
          <h3 className="text-[15px] font-semibold text-foreground mb-0.5">
            Security &amp; recovery
          </h3>
          <p className="text-[12px] text-foreground-secondary">
            Review your vault protection setup
          </p>
        </div>
      </div>

      {/* 4. Vault Preview (Locked / Unlocked) */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <div className="flex items-center justify-between pb-4 border-b border-border mb-5">
          <div>
            <h3 className="text-[18px] font-semibold text-foreground">
              Your encrypted vault
            </h3>
            <p className="text-[13px] text-foreground-secondary">
              Your sensitive information stays locked until you unlock it in your browser.
            </p>
          </div>
          {isVaultUnlocked ? (
            <button
              type="button"
              onClick={onLockVault}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-border bg-elevated text-[12px] font-medium text-foreground hover:bg-hover transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock vault in memory</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-elevated border border-border text-[12px] font-medium text-foreground-secondary">
              <Lock className="w-3 h-3" />
              <span>Locked</span>
            </span>
          )}
        </div>

        {!isVaultUnlocked ? (
          <div className="py-8 max-w-lg mx-auto text-center">
            <div className="w-12 h-12 rounded-full bg-elevated border border-border flex items-center justify-center mx-auto mb-4 text-accent-text">
              <Lock className="w-5 h-5 stroke-[1.75]" />
            </div>
            <h4 className="text-[17px] font-semibold text-foreground mb-1">
              Your vault is locked
            </h4>
            <p className="text-[13px] text-foreground-secondary mb-6">
              Enter your master passphrase to unlock your vault. Everything is decrypted on this device only.
            </p>

            <form onSubmit={handleUnlockSubmit} className="flex gap-2.5 mb-3">
              <input
                type="password"
                required
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                placeholder="Enter your master passphrase..."
                className="flex-1 h-11 px-3.5 rounded-[8px] border border-border bg-background text-[14px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <button
                type="submit"
                disabled={isSubmittingPassphrase}
                className="h-11 px-5 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover disabled:opacity-60 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {isSubmittingPassphrase ? "Decrypting..." : "Unlock vault"}
              </button>
            </form>

            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate("recovery")}
                className="text-[13px] text-foreground-secondary hover:text-foreground underline transition-colors"
              >
                Lost your passphrase? Use your recovery kit
              </button>
              <p className="text-[11px] text-foreground-secondary max-w-sm leading-relaxed">
                Vault contents are encrypted before upload. Unlocking decrypts authorized content locally in your browser.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3">
              <span className="text-[13px] font-medium text-accent-text flex items-center gap-1.5 tabular-nums">
                <CheckCircle2 className="w-4 h-4 text-accent-text" />
                Decrypted in browser memory ({formatCount(itemsCount, "item")})
              </span>
              <button
                type="button"
                onClick={() => onNavigate("vault")}
                className="text-[13px] font-medium text-foreground hover:text-accent-text flex items-center gap-1 transition-colors"
              >
                <span>View all in your vault</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {itemsCount === 0 ? (
              <p className="text-[14px] text-foreground-secondary py-6 text-center">
                Your vault is currently empty. Add your first secret instruction or document.
              </p>
            ) : (
              <div className="divide-y divide-border border border-border rounded-[10px]">
                {vault?.items.slice(0, 4).map((item) => {
                  const dec = decryptedItems[item.id];
                  const itemAssignments = assignments.filter((a) => a.itemId === item.id);
                  return (
                    <div key={item.id} className="p-3.5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <KeyRound className="w-4 h-4 text-foreground-secondary shrink-0" />
                        <div className="overflow-hidden">
                          <span className="font-semibold text-[14px] text-foreground block truncate">
                            {dec ? dec.title : `Encrypted item (${item.id.slice(0, 8)})`}
                          </span>
                          <span className="text-[11px] text-foreground-secondary tabular-nums">
                            {item.category} · {formatDate(item.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {itemAssignments.length > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-[4px] bg-accent-surface text-accent-text border border-brand/25 font-medium tabular-nums">
                            {formatCount(itemAssignments.length, "beneficiary", "beneficiaries")}
                          </span>
                        )}
                        <span className={`text-[11px] px-2 py-0.5 rounded-[4px] font-medium border ${dec ? "bg-accent-surface text-accent-text border-brand/25" : "bg-elevated border-border text-foreground-secondary"}`}>
                          {dec ? "Decrypted" : "Locked"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. Recent Activity */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
          <div>
            <h3 className="text-[18px] font-semibold text-foreground">
              Recent activity
            </h3>
            <p className="text-[13px] text-foreground-secondary">
              Latest security-sensitive actions and check-in events recorded for your account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("audit")}
            className="text-[13px] font-medium text-foreground hover:text-accent-text flex items-center gap-1 transition-colors"
          >
            <span>View full audit timeline</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {auditEvents.length === 0 ? (
          <p className="text-[14px] text-foreground-secondary py-8 text-center italic">
            Your activity will appear here as you manage your vault and check-in plan.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {auditEvents.slice(0, 5).map((ev) => {
              const display = getAuditEventDisplay(ev.eventType, ev.redactedMeta, contacts);
              return (
                <div key={ev.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">
                      {display.title}
                    </p>
                    <p className="text-[13px] text-foreground-secondary">
                      {display.description}
                    </p>
                  </div>
                  <span
                    className="text-[12px] text-foreground-secondary shrink-0 tabular-nums"
                    title={formatDateTime(ev.createdAt)}
                  >
                    {formatRelativeTime(ev.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

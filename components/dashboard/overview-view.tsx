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
import { categoryLabel } from "./item-categories";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { fieldInputClass } from "@/components/ui/form-field";
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
  const statusCopy = "Check-in plan";
  let statusDetail = `Your next check-in is due in ${formatCount(daysRemaining, "day")}.`;
  let statusBadgeLabel = "On track";
  let statusIndicatorColor = "bg-brand";
  let statusBadgeStyle = "bg-[var(--success-bg)] text-[var(--success-fg)] border-brand/25 font-semibold";

  if (scheduleState === "PAUSED") {
    statusDetail = "Check-ins are paused. Dusk won't send reminders until you check in or the pause ends.";
    statusBadgeLabel = "Paused";
    statusIndicatorColor = "bg-foreground-muted";
    statusBadgeStyle = "bg-elevated text-foreground-secondary border-border";
  } else if (scheduleState === "PENDING_ESCALATION" || scheduleState === "REMINDER_DUE") {
    statusDetail = "You are due to check in. Check in now to stop reminders.";
    statusBadgeLabel = "Check-in due";
    statusIndicatorColor = "bg-[var(--warning-fg)]";
    statusBadgeStyle = "bg-[var(--warning-bg)] text-[var(--warning-fg)] border-[var(--warning-fg)]";
  } else if (scheduleState === "VERIFICATION_REQUIRED") {
    statusDetail = "You missed your check-ins and your trusted verifiers have been asked to confirm. Check in now to stop the process.";
    statusBadgeLabel = "Verifiers contacted";
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
        <div className="min-w-0">
          <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
            Good to see you, {firstName}.
          </h1>
          <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
            Check in, see who receives what, and keep your vault up to date.
          </p>
        </div>
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => onNavigate("vault")}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-11 sm:pointer-fine:h-10 px-4 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Plus className="w-4 h-4 stroke-[2]" />
            <span>Add to vault</span>
          </button>
        </div>
      </div>

      {/* 2. Check-In Status Card */}
      <div className="border border-border bg-card rounded-[14px] p-5 sm:p-7">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-[12px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text">
              <Clock className="w-6 h-6 stroke-[1.75]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mb-1">
                <h2 className="text-[20px] font-semibold text-foreground">
                  {statusCopy}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[5px] border text-xs font-medium ${statusBadgeStyle}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusIndicatorColor}`} />
                  {statusBadgeLabel}
                </span>
              </div>
              <p className="text-[14px] text-foreground-secondary max-w-xl">{statusDetail}</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-[1fr_auto] gap-2.5 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              disabled={isCheckingIn}
              onClick={handleCheckInClick}
              className="col-span-2 sm:col-span-1 inline-flex items-center justify-center h-11 sm:pointer-fine:h-10 px-5 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {isCheckingIn ? "Checking in..." : "Check in now"}
            </button>
            {scheduleState !== "PAUSED" && (
              <ConfirmAction
                tone="default"
                title="Pause check-ins for 30 days?"
                description="While paused, Dusk won't send reminders or start the release process. Checking in again resumes your plan."
                confirmLabel="Pause for 30 days"
                pendingLabel="Pausing..."
                cancelLabel="Don't pause"
                onConfirm={handlePauseClick}
                trigger={(props) => (
                  <button
                    type="button"
                    disabled={isPausing}
                    {...props}
                    className="inline-flex items-center justify-center h-10 px-4 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover disabled:opacity-50 transition-colors"
                  >
                    Pause for 30 days
                  </button>
                )}
              />
            )}
            <button
              type="button"
              onClick={() => onNavigate("schedule")}
              className="inline-flex items-center justify-center gap-2 h-10 px-3.5 rounded-[8px] border border-border bg-elevated text-foreground-secondary text-[14px] font-medium hover:text-foreground hover:bg-hover transition-colors"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Change plan</span>
            </button>
          </div>
        </div>

        {/* Schedule Metric Columns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 text-left">
          <div>
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              Next check-in
            </span>
            <span className="text-[17px] font-semibold text-foreground tabular-nums">
              {scheduleState === "PAUSED" ? "Paused" : `In ${formatCount(daysRemaining, "day")}`}
            </span>
          </div>
          <div>
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              Grace period
            </span>
            <span className="text-[17px] font-semibold text-foreground tabular-nums">
              {schedule?.gracePeriodDays || 14} days
            </span>
          </div>
          <div>
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              Check in every
            </span>
            <span className="text-[17px] font-semibold text-foreground tabular-nums">
              {schedule?.intervalDays || 90} days
            </span>
          </div>
          <div>
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-1">
              If Dusk is unsure
            </span>
            <span className="text-[17px] font-semibold text-foreground">
              Releases nothing
            </span>
          </div>
        </div>
      </div>

      {/* 3. Summary Cards (3-4 compact cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Encrypted Items */}
        <button
          type="button"
          onClick={() => onNavigate("vault")}
          className="block w-full text-left p-5 rounded-[12px] bg-card border border-border hover:border-brand/60 hover:bg-hover transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[32px] font-semibold text-foreground leading-none tabular-nums">
              {itemsCount}
            </span>
            <KeyRound className="w-5 h-5 text-foreground-secondary stroke-[1.75]" />
          </div>
          <span className="block text-[15px] font-semibold text-foreground mb-0.5">
            {pluralize(itemsCount, "Item in your vault", "Items in your vault")}
          </span>
          <span className="block text-[13px] text-foreground-secondary">
            {itemsCount === 0 ? "Add your first item" : "Passwords, documents and notes"}
          </span>
        </button>

        {/* Card 2: Beneficiaries */}
        <button
          type="button"
          onClick={() => onNavigate("people")}
          className="block w-full text-left p-5 rounded-[12px] bg-card border border-border hover:border-brand/60 hover:bg-hover transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[32px] font-semibold text-foreground leading-none tabular-nums">
              {beneficiariesCount}
            </span>
            <Users className="w-5 h-5 text-foreground-secondary stroke-[1.75]" />
          </div>
          <span className="block text-[15px] font-semibold text-foreground mb-0.5">
            {pluralize(beneficiariesCount, "Beneficiary", "Beneficiaries")}
          </span>
          <span className="block text-[13px] text-foreground-secondary">
            {beneficiariesCount === 0 ? "Add someone to receive your items" : "People who receive your items"}
          </span>
        </button>

        {/* Card 3: Trusted Contacts */}
        <button
          type="button"
          onClick={() => onNavigate("people")}
          className="block w-full text-left p-5 rounded-[12px] bg-card border border-border hover:border-brand/60 hover:bg-hover transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[32px] font-semibold text-foreground leading-none tabular-nums">
              {verifiersCount}
            </span>
            <UserCheck className="w-5 h-5 text-foreground-secondary stroke-[1.75]" />
          </div>
          <span className="block text-[15px] font-semibold text-foreground mb-0.5">
            {pluralize(verifiersCount, "Trusted verifier", "Trusted verifiers")}
          </span>
          <span className="block text-[13px] text-foreground-secondary">
            {verifiersCount === 0 ? "Add someone to confirm you're okay" : "People who confirm you're okay"}
          </span>
        </button>

        {/* Card 4: Security & Recovery */}
        <button
          type="button"
          onClick={() => onNavigate("recovery")}
          className="block w-full text-left p-5 rounded-[12px] bg-card border border-border hover:border-brand/60 hover:bg-hover transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-medium text-accent-text inline-flex items-center gap-1">
              Review
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
            <FileKey className="w-5 h-5 text-accent-text stroke-[1.75]" />
          </div>
          <span className="block text-[15px] font-semibold text-foreground mb-0.5">
            Recovery kit
          </span>
          <span className="block text-[13px] text-foreground-secondary">
            Make sure you can get back in
          </span>
        </button>
      </div>

      {/* 4. Vault Preview (Locked / Unlocked) */}
      <div className="border border-border bg-card rounded-[14px] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-border mb-5">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold text-foreground">
              Your vault
            </h2>
            <p className="text-[13px] text-foreground-secondary">
              Your items stay locked until you enter your passphrase on this device.
            </p>
          </div>
          {isVaultUnlocked ? (
            <button
              type="button"
              onClick={onLockVault}
              className="inline-flex items-center gap-1.5 px-3 rounded-[6px] border border-border bg-elevated font-medium text-foreground hover:bg-hover transition-colors text-[13px] min-h-11 sm:pointer-fine:min-h-0 sm:py-1.5"
            >
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Lock vault</span>
            </button>
          ) : null}
        </div>

        {!isVaultUnlocked ? (
          <div className="py-8 max-w-lg mx-auto text-center">
            <div className="w-12 h-12 rounded-full bg-elevated border border-border flex items-center justify-center mx-auto mb-4 text-accent-text">
              <Lock className="w-5 h-5 stroke-[1.75]" />
            </div>
            <h3 className="text-[17px] font-semibold text-foreground mb-1">
              Your vault is locked
            </h3>
            <p className="text-[14px] text-foreground-secondary mb-6">
              Enter your master passphrase to open it. Your items are only ever opened on this device.
            </p>

            <form onSubmit={handleUnlockSubmit} className="flex flex-col sm:flex-row gap-2.5 mb-3 text-left">
              <label htmlFor="overview-passphrase" className="sr-only">
                Master passphrase
              </label>
              <input
                id="overview-passphrase"
                type="password"
                required
                autoComplete="off"
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                placeholder="Master passphrase"
                className={`${fieldInputClass} w-full sm:w-auto sm:flex-1 min-w-0`}
              />
              <button
                type="submit"
                disabled={isSubmittingPassphrase}
                className="h-11 px-5 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover disabled:opacity-60 transition-colors shrink-0 w-full sm:w-auto"
              >
                {isSubmittingPassphrase ? "Unlocking..." : "Unlock vault"}
              </button>
            </form>

            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate("recovery")}
                className="inline-flex min-h-11 items-center px-2 text-[13px] text-foreground-secondary hover:text-foreground underline transition-colors"
              >
                Lost your passphrase? Use your recovery kit
              </button>
              <p className="text-[13px] text-foreground-secondary max-w-sm leading-relaxed">
                Dusk never sees your passphrase or what is in your vault.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-3">
              <span className="text-[13px] font-medium text-accent-text flex items-center gap-1.5 tabular-nums">
                <CheckCircle2 className="w-4 h-4 text-accent-text" />
                Unlocked on this device ({formatCount(itemsCount, "item")})
              </span>
              <button
                type="button"
                onClick={() => onNavigate("vault")}
                className="text-[13px] font-medium text-foreground hover:text-accent-text inline-flex min-h-11 items-center gap-1 transition-colors"
              >
                <span>View all in your vault</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {itemsCount === 0 ? (
              <p className="text-[14px] text-foreground-secondary py-6 text-center">
                Nothing in your vault yet. Select Add to vault to save your first item.
              </p>
            ) : (
              <div className="divide-y divide-border border border-border rounded-[10px]">
                {vault?.items.slice(0, 4).map((item) => {
                  const dec = decryptedItems[item.id];
                  const itemAssignments = assignments.filter((a) => a.itemId === item.id);
                  return (
                    <div key={item.id} className="p-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="flex items-center gap-3 overflow-hidden min-w-0">
                        <KeyRound className="w-4 h-4 text-foreground-secondary shrink-0" />
                        <div className="overflow-hidden">
                          <span className="font-semibold text-[14px] text-foreground block truncate">
                            {dec ? dec.title : "Locked item"}
                          </span>
                          <span className="text-xs text-foreground-secondary tabular-nums">
                            {categoryLabel(item.category)} · {formatDate(item.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 pl-7 sm:pl-0">
                        {itemAssignments.length > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-[4px] bg-accent-surface text-accent-text border border-brand/25 font-medium tabular-nums">
                            {formatCount(itemAssignments.length, "beneficiary", "beneficiaries")}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-[4px] font-medium border ${dec ? "bg-accent-surface text-accent-text border-brand/25" : "bg-elevated border-border text-foreground-secondary"}`}>
                          {dec ? "Unlocked" : "Locked"}
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
      <div className="border border-border bg-card rounded-[14px] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 pb-4 border-b border-border mb-4">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold text-foreground">
              Recent activity
            </h2>
            <p className="text-[13px] text-foreground-secondary">
              The latest check-ins and changes on your account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("audit")}
            className="text-[13px] font-medium text-foreground hover:text-accent-text inline-flex min-h-11 items-center gap-1 transition-colors"
          >
            <span>See all activity</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {auditEvents.length === 0 ? (
          <p className="text-[14px] text-foreground-secondary py-8 text-center">
            Nothing yet. Check-ins and changes to your vault or people will be listed here.
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
                    className="text-[13px] text-foreground-secondary shrink-0 tabular-nums"
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

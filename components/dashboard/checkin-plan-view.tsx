"use client";

import React, { useState } from "react";
import {
  Clock,
  PauseCircle,
  Play,
  Shield,
  Calendar,
} from "lucide-react";
import { ScheduleData } from "./types";
import { formatCount, formatDate } from "@/lib/display-format";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { fieldHintClass, fieldInputClass, fieldLabelClass, buttonPrimaryClass } from "@/components/ui/form-field";

interface CheckinPlanViewProps {
  schedule: ScheduleData | null;
  daysRemaining: number;
  onSaveSchedule: (intervalDays: number, gracePeriodDays: number) => Promise<void>;
  onPauseSchedule: () => Promise<void>;
  onCheckInNow: () => Promise<void>;
}

export function CheckinPlanView({
  schedule,
  daysRemaining,
  onSaveSchedule,
  onPauseSchedule,
  onCheckInNow,
}: CheckinPlanViewProps) {
  const [intervalDays, setIntervalDays] = useState(schedule?.intervalDays || 90);
  const [gracePeriodDays, setGracePeriodDays] = useState(schedule?.gracePeriodDays || 14);
  const [isSaving, setIsSaving] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);

  const isPaused = schedule?.state === "PAUSED";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveSchedule(intervalDays, gracePeriodDays);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePause = async () => {
    setIsPausing(true);
    try {
      await onPauseSchedule();
    } finally {
      setIsPausing(false);
    }
  };

  const handleResume = async () => {
    setIsCheckingIn(true);
    try {
      await onCheckInNow();
    } finally {
      setIsCheckingIn(false);
    }
  };

  return (
    <div className="space-y-8 text-left max-w-4xl">
      {/* 1. Header */}
      <div className="pb-2 border-b border-border">
        <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
          Check-in plan
        </h1>
        <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
          Choose how often you check in, and how long Dusk waits after a missed check-in before it contacts your trusted verifiers.
        </p>
      </div>

      {/* 2. Current Schedule Health Overview */}
      <div className="border border-border bg-card rounded-[14px] p-5 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-border mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center text-accent-text shrink-0">
              <Clock className="w-5 h-5 stroke-[1.75]" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-foreground">
                {isPaused ? "Check-ins are paused" : "Check-ins are on"}
              </h2>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-[6px] text-[13px] font-semibold border ${ isPaused ? "bg-elevated border-border text-foreground-secondary" : "bg-accent-surface border-brand/25 text-accent-text" }`}
          >
            {isPaused
              ? "Paused"
              : `Next check-in in ${formatCount(daysRemaining, "day")}`}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-[14px]">
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              How often
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              Every {schedule?.intervalDays || 90} days
            </span>
            <p className="text-[13px] text-foreground-secondary mt-0.5">
              How often you confirm you&apos;re okay.
            </p>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Grace period
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {schedule?.gracePeriodDays || 14} days
            </span>
            <p className="text-[13px] text-foreground-secondary mt-0.5">
              Extra time after a missed check-in, before Dusk contacts your trusted verifiers.
            </p>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Last check-in
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {schedule?.lastCheckInAt
                ? formatDate(schedule.lastCheckInAt)
                : "Not yet. Your first check-in is due on schedule."}
            </span>
            <p className="text-[13px] text-foreground-secondary mt-0.5">
              The last time you confirmed you&apos;re okay.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Schedule Settings Form */}
      <div className="border border-border bg-card rounded-[14px] p-5 sm:p-7">
        <div className="pb-4 border-b border-border mb-6">
          <h2 className="text-[18px] font-semibold text-foreground">
            Change your plan
          </h2>
          <p className="text-[13px] text-foreground-secondary mt-0.5">
            Changes apply from your next check-in.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="plan-interval" className={fieldLabelClass}>
                Check in every (days)
              </label>
              <input
                id="plan-interval"
                type="number"
                inputMode="numeric"
                min={7}
                max={365}
                required
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                aria-describedby="plan-interval-hint"
                className={fieldInputClass}
              />
              <span id="plan-interval-hint" className={fieldHintClass}>
                Between 7 and 365 days. Most people choose 90.
              </span>
            </div>

            <div>
              <label htmlFor="plan-grace" className={fieldLabelClass}>
                Grace period (days)
              </label>
              <input
                id="plan-grace"
                type="number"
                inputMode="numeric"
                min={3}
                max={90}
                required
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(Number(e.target.value))}
                aria-describedby="plan-grace-hint"
                className={fieldInputClass}
              />
              <span id="plan-grace-hint" className={fieldHintClass}>
                Between 3 and 90 days. This is how long you have to respond after missing a check-in.
              </span>
            </div>
          </div>

          <div className="space-y-3 pt-2 text-[13px] text-foreground-secondary border-t border-border">
            <div className="flex items-start gap-2.5">
              <Calendar className="w-4 h-4 text-accent-text shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <strong className="text-foreground">Reminders:</strong> Dusk reminds you before each check-in is due.
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Shield className="w-4 h-4 text-accent-text shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <strong className="text-foreground">If you miss one:</strong> when the grace period ends, Dusk contacts your trusted verifiers. Nothing is sent to anyone until they confirm.
              </div>
            </div>
          </div>

          <div className="pt-2 flex sm:justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className={`${buttonPrimaryClass} px-6 w-full sm:w-auto`}
            >
              {isSaving ? "Saving..." : "Save check-in plan"}
            </button>
          </div>
        </form>
      </div>

      {/* 4. Pause Check-ins Card */}
      <div className="border border-border bg-card rounded-[14px] p-5 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center text-accent-text shrink-0 mt-0.5">
              <PauseCircle className="w-5 h-5 stroke-[1.75]" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-foreground mb-1">
                Pause check-ins
              </h3>
              <p className="text-[13px] text-foreground-secondary leading-relaxed max-w-xl">
                Stop reminders and the release process for 30 days, for example while you travel or are in hospital. Pausing doesn&apos;t give anyone access to your vault. Checking in resumes your plan.
              </p>
            </div>
          </div>

          <div className="shrink-0 sm:max-w-sm w-full sm:w-auto [&>button]:w-full sm:[&>button]:w-auto [&>button]:justify-center">
            {isPaused ? (
              <button
                type="button"
                disabled={isCheckingIn}
                onClick={handleResume}
                className={buttonPrimaryClass}
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>{isCheckingIn ? "Resuming..." : "Resume check-ins"}</span>
              </button>
            ) : (
              <ConfirmAction
                tone="default"
                title="Pause check-ins for 30 days?"
                description="While paused, Dusk won't send reminders or start the release process. Checking in again resumes your plan."
                confirmLabel="Pause for 30 days"
                pendingLabel="Pausing..."
                cancelLabel="Don't pause"
                onConfirm={handlePause}
                trigger={(props) => (
                  <button
                    type="button"
                    disabled={isPausing}
                    {...props}
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-[8px] border border-border bg-elevated text-foreground text-[15px] font-medium hover:bg-hover transition-colors disabled:opacity-60"
                  >
                    <PauseCircle className="w-4 h-4" aria-hidden="true" />
                    <span>Pause for 30 days</span>
                  </button>
                )}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

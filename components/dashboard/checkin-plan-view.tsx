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
          Choose how often to confirm you&apos;re okay, and how long Dusk waits before it contacts your trusted verifiers.
        </p>
      </div>

      {/* 2. Current Schedule Health Overview */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-border mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center text-accent-text">
              <Clock className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                Schedule
              </span>
              <h2 className="text-[18px] font-semibold text-foreground">
                {isPaused ? "Your check-in schedule is paused" : "Your check-in schedule is on"}
              </h2>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-[6px] text-[12px] font-semibold border ${ isPaused ? "bg-elevated border-border text-foreground-secondary" : "bg-accent-surface border-brand/25 text-accent-text" }`}
          >
            {isPaused
              ? "Paused for 30 days"
              : `Next check-in in ${formatCount(daysRemaining, "day")}`}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-[14px]">
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              How often
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              Every {schedule?.intervalDays || 90} days
            </span>
            <p className="text-[12px] text-foreground-secondary mt-0.5">
              How often you confirm that you are available.
            </p>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Grace period
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {schedule?.gracePeriodDays || 14} days
            </span>
            <p className="text-[12px] text-foreground-secondary mt-0.5">
              Extra time after a missed check-in before Dusk contacts your trusted verifiers.
            </p>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
              Last check-in
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {schedule?.lastCheckInAt
                ? formatDate(schedule.lastCheckInAt)
                : "Initial enrollment"}
            </span>
            <p className="text-[12px] text-foreground-secondary mt-0.5">
              The last time you confirmed you&apos;re okay.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Schedule Settings Form */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <div className="pb-4 border-b border-border mb-6">
          <h2 className="text-[18px] font-semibold text-foreground">
            Change your schedule
          </h2>
          <p className="text-[13px] text-foreground-secondary mt-0.5">
            Set how often you check in and how long the grace period lasts.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">
                How often (days)
              </label>
              <input
                type="number"
                min={7}
                max={365}
                required
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                className="w-full h-11 px-3.5 rounded-[8px] border border-border bg-background text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <span className="block text-[12px] text-foreground-secondary mt-1.5">
                Recommended: 90 days (quarterly). Minimum 7 days, maximum 365 days.
              </span>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">
                Grace period (days)
              </label>
              <input
                type="number"
                min={3}
                max={90}
                required
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(Number(e.target.value))}
                className="w-full h-11 px-3.5 rounded-[8px] border border-border bg-background text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <span className="block text-[12px] text-foreground-secondary mt-1.5">
                Time after a missed check-in before Dusk contacts your trusted verifiers. Minimum 3 days.
              </span>
            </div>
          </div>

          <div className="space-y-3 pt-2 text-[13px] text-foreground-secondary border-t border-border">
            <div className="flex items-start gap-2.5">
              <Calendar className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
              <div>
                <strong className="text-foreground">Reminders:</strong> We&apos;ll remind you by email and SMS before each check-in is due.
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Shield className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
              <div>
                <strong className="text-foreground">Release:</strong> If you miss a check-in and the grace period ends, Dusk contacts your trusted verifiers. Nothing is released until verification is complete.
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="h-11 px-6 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {isSaving ? "Saving changes..." : "Save schedule"}
            </button>
          </div>
        </form>
      </div>

      {/* 4. Pause Check-ins Card */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center text-accent-text shrink-0 mt-0.5">
              <PauseCircle className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-foreground mb-1">
                Pause check-ins
              </h3>
              <p className="text-[13px] text-foreground-secondary leading-relaxed max-w-xl">
                Temporarily suspend your schedule for 30 days during travel, remote expeditions, or hospital stays. Pausing check-ins does not change existing vault encryption or grant anyone access.
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {isPaused ? (
              <button
                type="button"
                disabled={isCheckingIn}
                onClick={handleResume}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover transition-colors shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Resume check-ins</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isPausing}
                onClick={handlePause}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover transition-colors"
              >
                <PauseCircle className="w-4 h-4" />
                <span>Pause for 30 days</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

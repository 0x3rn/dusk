"use client";

import React from "react";
import {
  Activity,
  Shield,
  KeyRound,
  Users,
  Clock,
  PauseCircle,
  FileKey,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";
import { AuditEventData, DashboardView } from "./types";
import {
  getAuditEventDisplay,
  AuditContactLike,
} from "./audit-event-copy";
import { formatCount, formatDateTime, formatRelativeTime } from "@/lib/display-format";

interface AuditTimelineViewProps {
  auditEvents: AuditEventData[];
  contacts: AuditContactLike[];
  onNavigate: (view: DashboardView) => void;
}

export function AuditTimelineView({
  auditEvents,
  contacts,
  onNavigate,
}: AuditTimelineViewProps) {
  const getEventIcon = (type: string) => {
    if (type.includes("CHECK_IN") || type.includes("CHECKIN") || type.includes("SCHEDULE")) {
      return Clock;
    }
    if (type.includes("ITEM") || type.includes("VAULT")) {
      return KeyRound;
    }
    if (type.includes("CONTACT") || type.includes("BENEFICIARY")) {
      return Users;
    }
    if (type.includes("RECOVERY")) {
      return FileKey;
    }
    if (type.includes("PAUSE")) {
      return PauseCircle;
    }
    return Shield;
  };

  return (
    <div className="space-y-8 text-left">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div className="min-w-0">
          <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
            Audit timeline
          </h1>
          <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
            Everything that has happened on your account: check-ins, changes and releases.
          </p>
          <p className="text-[13px] text-foreground-secondary mt-1">
            Entries can&apos;t be edited or deleted. Vault contents are never logged.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => onNavigate("overview")}
            className="inline-flex items-center gap-1.5 px-4 rounded-[8px] border border-border bg-elevated text-foreground font-medium hover:bg-hover transition-colors h-11 text-[14px] sm:pointer-fine:h-10"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Return to overview</span>
          </button>
        </div>
      </div>

      {/* 2. Timeline Card */}
      <div className="border border-border bg-card rounded-[14px] p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-4 border-t border-b border-border py-4 mb-6">
          <span className="text-[13px] font-semibold text-foreground-secondary tabular-nums">
            {formatCount(auditEvents.length, "event")} recorded
          </span>
          <span className="text-[13px] text-foreground flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-accent-text" aria-hidden="true" />
                        Vault contents are never logged
          </span>
        </div>

        {auditEvents.length === 0 ? (
          <div className="py-16 text-center text-foreground-secondary space-y-4">
            <Activity className="w-10 h-10 stroke-[1.5] mx-auto text-foreground-secondary/50" aria-hidden="true" />
            <p className="text-[15px] max-w-sm mx-auto">
              Nothing has happened yet. Check-ins and changes to your vault or people will be listed here.
            </p>
            <button
              type="button"
              onClick={() => onNavigate("overview")}
              className="inline-flex items-center justify-center h-11 sm:pointer-fine:h-10 px-5 rounded-[8px] border border-border bg-elevated text-foreground text-[13px] font-medium hover:bg-hover transition-colors"
            >
              Return to overview
            </button>
          </div>
        ) : (
          <div className="relative pl-6 sm:pl-8 space-y-5 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[1px] before:bg-border">
            {auditEvents.map((ev) => {
              const Icon = getEventIcon(ev.eventType);
              const display = getAuditEventDisplay(ev.eventType, ev.redactedMeta, contacts);
              return (
                <div key={ev.id} className="relative flex items-start gap-4">
                  {/* Timeline Node Icon */}
                  <div className="absolute -left-6 sm:-left-8 top-3.5 w-6 h-6 rounded-full bg-background border-2 border-brand flex items-center justify-center shrink-0 shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-brand" />
                  </div>

                  {/* Event Content Card */}
                  <div className="flex-1 min-w-0 border border-border rounded-[10px] p-4 bg-elevated/60">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-4 h-4 text-foreground stroke-[1.75] shrink-0" aria-hidden="true" />
                        <span className="font-semibold text-[14px] text-foreground break-words">
                          {display.title}
                        </span>
                      </div>
                      <span
                        className="text-[13px] text-foreground-secondary shrink-0 tabular-nums"
                        title={formatDateTime(ev.createdAt)}
                      >
                        {formatRelativeTime(ev.createdAt)}
                      </span>
                    </div>

                    <p className="text-[13px] text-foreground-secondary mt-1">
                      {display.description}
                    </p>

                    <details className="mt-2.5 group">
                      <summary className="font-medium text-foreground-secondary cursor-pointer select-none hover:text-foreground text-[13px] py-1 inline-flex min-h-11 min-w-11 sm:pointer-fine:min-h-0 sm:pointer-fine:min-w-0 items-center">
                        Technical details
                      </summary>
                      <div className="mt-2 p-2.5 rounded-[6px] bg-background border border-border font-mono text-[13px] text-foreground-secondary break-all">
                        {ev.redactedMeta}
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

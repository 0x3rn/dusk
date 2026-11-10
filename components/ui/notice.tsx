import * as React from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

type NoticeTone = "error" | "success" | "info";

const TONES: Record<NoticeTone, { box: string; Icon: typeof Info; role: "alert" | "status" }> = {
  error: {
    box: "bg-[var(--danger-bg)] border-[var(--danger-fg)] text-[var(--danger-fg)]",
    Icon: AlertCircle,
    role: "alert",
  },
  success: {
    box: "bg-accent-surface border-brand/40 text-accent-text",
    Icon: CheckCircle2,
    role: "status",
  },
  info: {
    box: "bg-[var(--info-bg)] border-[var(--info-fg)]/40 text-[var(--info-fg)]",
    Icon: Info,
    role: "status",
  },
};

/**
 * One message box for errors, confirmations and tips. Errors are announced to screen readers
 * straight away; success and info are announced politely. An icon is always shown so the
 * meaning never depends on colour alone.
 */
export function Notice({
  tone,
  children,
  onDismiss,
  className,
}: {
  tone: NoticeTone;
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { box, Icon, role } = TONES[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2.5 p-3.5 rounded-[10px] border text-sm font-medium",
        box,
        className
      )}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="shrink-0 -m-1 p-1 rounded-[6px] hover:opacity-70 transition-opacity"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

"use client";

import * as React from "react";

import { buttonDangerClass, buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";

type TriggerProps = {
  onClick: () => void;
  ref: React.RefObject<HTMLButtonElement | null>;
  "aria-expanded": boolean;
};

/**
 * Two-step confirmation for actions that cannot be undone. The trigger is replaced by a short
 * panel that says what will happen, with a clearly named confirm button and a "keep" button.
 * Focus starts on the safe button, Escape cancels, and focus returns to the trigger afterwards.
 */
export function ConfirmAction({
  title,
  description,
  confirmLabel,
  cancelLabel = "Keep it",
  pendingLabel,
  tone = "danger",
  onConfirm,
  trigger,
  defaultOpen = false,
  onClose,
  className,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void | Promise<void>;
  trigger: (props: TriggerProps) => React.ReactNode;
  /** Start with the panel showing (used when the trigger lives elsewhere). */
  defaultOpen?: boolean;
  /** Called after the panel closes, by cancelling or after the action finishes. */
  onClose?: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [busy, setBusy] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    onClose?.();
    // Wait for the trigger to render again before moving focus back to it.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setOpen(false);
      onClose?.();
    }
  };

  if (!open) {
    return <>{trigger({ onClick: () => setOpen(true), ref: triggerRef, "aria-expanded": false })}</>;
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          close();
        }
      }}
      className={cn(
        "w-full rounded-[10px] border p-4 text-left",
        tone === "danger"
          ? "border-[var(--danger-fg)] bg-[var(--danger-bg)]"
          : "border-border bg-elevated",
        className
      )}
    >
      <p id={titleId} className="text-[15px] font-semibold text-foreground">
        {title}
      </p>
      <p className="text-sm text-foreground-secondary mt-1 leading-relaxed">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          ref={cancelRef}
          onClick={close}
          disabled={busy}
          className={buttonSecondaryClass}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className={tone === "danger" ? buttonDangerClass : buttonPrimaryClass}
        >
          {busy ? (pendingLabel ?? "Working...") : confirmLabel}
        </button>
      </div>
    </div>
  );
}

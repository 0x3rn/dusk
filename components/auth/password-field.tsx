"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { fieldHintClass, fieldInputClass, fieldLabelClass } from "@/components/ui/form-field";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  /** Short helper text shown under the field, for example the length rule. */
  hint?: string;
  /** A problem with this field. Shown under it and announced to screen readers. */
  error?: string;
  disabled?: boolean;
}

/** A password box with a show/hide button. Used wherever a new password is typed. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  disabled,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${fieldInputClass} pr-12`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-foreground-secondary hover:text-foreground transition-colors"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
          {/* Visible text for assistive tech, not an aria-label, so the button never counts as a second "Password" field label. */}
          <span className="sr-only">{visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}</span>
        </button>
      </div>
      {hint && (
        <span id={hintId} className={fieldHintClass}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="block text-[13px] text-[var(--danger-fg)] mt-1.5">
          {error}
        </span>
      )}
    </div>
  );
}

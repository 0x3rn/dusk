"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, Mail } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import {
  changePasswordWithCode,
  requestResetCode,
  type ChangePasswordResult,
} from "@/lib/auth/password-flows";
import { checkOtp } from "@/lib/auth/one-time-code";
import { PASSWORD_HINT, checkNewPasswordPair } from "@/lib/auth/password-policy";
import { RESEND_COOLDOWN_SECONDS } from "@/lib/auth/cooldown";
import { PasswordField } from "@/components/auth/password-field";
import { useCooldown } from "@/components/auth/use-cooldown";
import { Notice } from "@/components/ui/notice";
import { buttonPrimaryClass, buttonSecondaryClass, fieldInputClass, fieldLabelClass } from "@/components/ui/form-field";

type Step = "start" | "code";

interface FieldErrors {
  code?: string;
  password?: string;
  confirm?: string;
}

type Outcome = Extract<ChangePasswordResult, { ok: true }>;

function successMessage(outcome: Outcome): string {
  if (outcome.needsSignIn) {
    return "Your password is changed. Every device was signed out, including this one.";
  }
  if (outcome.otherSessionsEnded) {
    return "Your password is changed. We also signed you out on every other device.";
  }
  return "Your password is changed, but we couldn't sign you out on your other devices. If you think someone else has your old password, sign out here and sign in again.";
}

/** Changing the password needs a code emailed to the account, so a stolen open browser tab isn't enough. */
export function ChangePasswordCard({ email }: { email: string }) {
  const [step, setStep] = useState<Step>("start");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS);
  const codeRef = useRef<HTMLInputElement>(null);

  // When the code form appears, put the cursor in the code box.
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const sendCode = async (nextStep: Step) => {
    if (loading) return;
    setError("");
    setOutcome(null);
    setLoading(true);
    const result = await requestResetCode(authClient, email);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCodeSent(true);
    cooldown.start();
    setStep(nextStep);
  };

  const cancel = () => {
    setStep("start");
    setCode("");
    setPassword("");
    setConfirm("");
    setError("");
    setFieldErrors({});
    setCodeSent(false);
  };

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setFieldErrors({});

    const nextErrors: FieldErrors = {};
    const otp = checkOtp(code);
    if (!otp.ok) nextErrors.code = otp.message;
    const pair = checkNewPasswordPair(password, confirm);
    if (!pair.ok) {
      if (pair.issue === "mismatch") nextErrors.confirm = pair.message;
      else nextErrors.password = pair.message;
    }
    if (nextErrors.code || nextErrors.password || nextErrors.confirm) {
      setFieldErrors(nextErrors);
      return;
    }

    setLoading(true);
    const result = await changePasswordWithCode(authClient, { email, code, password, confirm });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    cancel();
    setOutcome(result);
  };

  return (
    <div className="border border-border bg-card rounded-[14px] p-5 sm:p-7" id="change-password">
      <h2 className="text-[18px] font-semibold text-foreground mb-1">Change password</h2>
      <p className="text-[13px] text-foreground-secondary mb-5">
        To make sure it&apos;s you, we email a 6-digit code to{" "}
        <span className="font-medium text-foreground break-all">{email}</span>. This is your account password. Your
        vault passphrase is separate and does not change.
      </p>

      <div className="space-y-4 border-t border-border pt-5">
        {outcome && (
          <Notice tone={outcome.otherSessionsEnded ? "success" : "info"} onDismiss={() => setOutcome(null)}>
            {successMessage(outcome)}{" "}
            {outcome.needsSignIn && (
              <Link href="/login" className="underline underline-offset-2 font-semibold">
                Sign in again
              </Link>
            )}
          </Notice>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        {step === "start" && (
          <button
            type="button"
            onClick={() => sendCode("code")}
            disabled={loading}
            className={`${buttonSecondaryClass} w-full sm:w-auto`}
          >
            <Mail className="w-4 h-4" aria-hidden="true" />
            {loading ? "Sending..." : "Email me a code"}
          </button>
        )}

        {step === "code" && (
          <form onSubmit={handleChange} className="space-y-4 max-w-md" noValidate>
            {codeSent && (
              <Notice tone="info">
                We sent a 6-digit code to <span className="break-all font-semibold">{email}</span>. It can take a
                minute to arrive.
              </Notice>
            )}

            <div>
              <label htmlFor="change-code" className={fieldLabelClass}>
                6-digit code
              </label>
              <input
                ref={codeRef}
                id="change-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={fieldErrors.code ? true : undefined}
                aria-describedby={fieldErrors.code ? "change-code-error" : undefined}
                className={`${fieldInputClass} tracking-widest`}
                placeholder="123456"
              />
              {fieldErrors.code && (
                <span id="change-code-error" role="alert" className="block text-[13px] text-[var(--danger-fg)] mt-1.5">
                  {fieldErrors.code}
                </span>
              )}
            </div>

            <PasswordField
              id="change-password-new"
              label="New password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              hint={PASSWORD_HINT}
              error={fieldErrors.password}
            />
            <PasswordField
              id="change-password-confirm"
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              error={fieldErrors.confirm}
            />

            <p className="text-[13px] text-foreground-secondary">
              When you change your password, we sign you out on all your other devices.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <button type="submit" disabled={loading} className={`${buttonPrimaryClass} w-full sm:w-auto`}>
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                {loading ? "Changing password..." : "Change password"}
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={loading}
                className={`${buttonSecondaryClass} w-full sm:w-auto`}
              >
                Cancel
              </button>
            </div>

            <button
              type="button"
              onClick={() => sendCode("code")}
              disabled={loading || cooldown.remaining > 0}
              className="text-sm text-accent-text disabled:opacity-60 min-h-11 underline underline-offset-2"
            >
              {cooldown.remaining > 0 ? `Send a new code in ${cooldown.remaining}s` : "Send a new code"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

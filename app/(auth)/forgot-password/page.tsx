"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, Mail } from "lucide-react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { authClient } from "@/lib/auth/client";
import {
  NEUTRAL_CODE_SENT_MESSAGE,
  requestResetCode,
  resetPasswordWithCode,
} from "@/lib/auth/password-flows";
import { checkOtp, normalizeEmail } from "@/lib/auth/one-time-code";
import { PASSWORD_HINT, checkNewPasswordPair } from "@/lib/auth/password-policy";
import { RESEND_COOLDOWN_SECONDS } from "@/lib/auth/cooldown";
import { PasswordField } from "@/components/auth/password-field";
import { useCooldown } from "@/components/auth/use-cooldown";
import { Notice } from "@/components/ui/notice";
import {
  buttonPrimaryClass,
  fieldHintClass,
  fieldInputClass,
  fieldLabelClass,
} from "@/components/ui/form-field";

type Step = "email" | "reset" | "done";

interface FieldErrors {
  code?: string;
  password?: string;
  confirm?: string;
}

const HEADINGS: Record<Step, { title: string; intro: string }> = {
  email: {
    title: "Reset your password",
    intro: "Enter your email and we'll send you a 6-digit code.",
  },
  reset: {
    title: "Check your email",
    intro: "Enter the code from the email, then choose a new password.",
  },
  done: {
    title: "Password changed",
    intro: "You can now sign in with your new password.",
  },
};

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move keyboard and screen reader focus to the new step's heading so the change is announced.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const heading = HEADINGS[step];

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    const result = await requestResetCode(authClient, email);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEmail(normalizeEmail(email));
    setNotice(NEUTRAL_CODE_SENT_MESSAGE);
    cooldown.start();
    setStep("reset");
  };

  const handleResend = async () => {
    if (loading || cooldown.remaining > 0) return;
    setError("");
    setNotice("");
    setLoading(true);
    const result = await requestResetCode(authClient, email);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(NEUTRAL_CODE_SENT_MESSAGE);
    cooldown.start();
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setFieldErrors({});

    // Check each box locally first so the message sits next to the box that needs fixing.
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
    const result = await resetPasswordWithCode(authClient, { email, code, password, confirm });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice("");
    setCode("");
    setPassword("");
    setConfirm("");
    setStep("done");
  };

  const useDifferentEmail = () => {
    setError("");
    setNotice("");
    setFieldErrors({});
    setCode("");
    setStep("email");
  };

  return (
    <main className="bg-canvas flex flex-col items-center justify-center relative transition-colors min-h-dvh px-4 py-8 sm:p-6 overflow-x-clip">
      <div className="mb-6 sm:mb-8">
        <DuskLogo size={28} />
      </div>

      <div className="w-full max-w-md border border-border bg-card rounded-2xl p-5 sm:p-8 shadow-sm">
        <div className="text-center mb-8">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-foreground mb-2 outline-none"
          >
            {heading.title}
          </h1>
          <p className="text-sm text-foreground-secondary">{heading.intro}</p>
        </div>

        {error && (
          <Notice tone="error" className="mb-4">
            {error}
          </Notice>
        )}

        {step === "email" && (
          <form onSubmit={handleSendCode} className="space-y-4" noValidate>
            <div>
              <label htmlFor="forgot-email" className={fieldLabelClass}>
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldInputClass}
                placeholder="you@example.com"
              />
            </div>
            <button type="submit" disabled={loading} className={`${buttonPrimaryClass} w-full`}>
              <Mail strokeWidth={1.75} className="w-4 h-4" aria-hidden="true" />
              {loading ? "Sending..." : "Send me a code"}
            </button>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={handleReset} className="space-y-4" noValidate>
            {notice && (
              <Notice tone="info">
                {notice}
                <span className="block mt-1 break-all">
                  Email entered: <span className="font-semibold">{email}</span>
                </span>
              </Notice>
            )}

            <div>
              <label htmlFor="forgot-code" className={fieldLabelClass}>
                6-digit code
              </label>
              <input
                id="forgot-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={fieldErrors.code ? true : undefined}
                aria-describedby={fieldErrors.code ? "forgot-code-error" : undefined}
                className={`${fieldInputClass} tracking-widest`}
                placeholder="123456"
              />
              {fieldErrors.code && (
                <span id="forgot-code-error" role="alert" className="block text-[13px] text-[var(--danger-fg)] mt-1.5">
                  {fieldErrors.code}
                </span>
              )}
            </div>

            <PasswordField
              id="forgot-password"
              label="New password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              hint={PASSWORD_HINT}
              error={fieldErrors.password}
            />
            <PasswordField
              id="forgot-confirm"
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              error={fieldErrors.confirm}
            />

            <button type="submit" disabled={loading} className={`${buttonPrimaryClass} w-full mt-2`}>
              <KeyRound strokeWidth={1.75} className="w-4 h-4" aria-hidden="true" />
              {loading ? "Changing password..." : "Change password"}
            </button>

            <div className="flex flex-col items-center gap-1 pt-1">
              <button
                type="button"
                onClick={handleResend}
                disabled={loading || cooldown.remaining > 0}
                className="text-sm text-accent-text disabled:opacity-60 disabled:no-underline min-h-11 px-2 underline underline-offset-2"
              >
                {cooldown.remaining > 0 ? `Send a new code in ${cooldown.remaining}s` : "Send a new code"}
              </button>
              <button
                type="button"
                onClick={useDifferentEmail}
                disabled={loading}
                className="text-sm text-foreground-secondary min-h-11 px-2 underline underline-offset-2"
              >
                Use a different email
              </button>
            </div>
            <span className={`${fieldHintClass} text-center`}>
              Didn&apos;t get an email? Check your spam folder.
            </span>
          </form>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <Notice tone="success">Your password has been changed.</Notice>
            <Link href="/login" className={`${buttonPrimaryClass} w-full`}>
              Sign in
            </Link>
          </div>
        )}

        {step !== "done" && (
          <div className="mt-6 sm:mt-8 text-center text-sm text-foreground-secondary">
            Remembered it?{" "}
            <Link
              href="/login"
              className="text-accent-text font-medium underline underline-offset-2 inline-flex min-h-11 items-center"
            >
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

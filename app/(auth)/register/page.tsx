"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/client-errors";
import { Notice } from "@/components/ui/notice";
import { CheckoutIntentBanner, IntentLink } from "@/components/billing/checkout-intent-banner";
import { afterSignInPath } from "@/lib/billing/checkout-client";
import { PasswordField } from "@/components/auth/password-field";
import { AuthHeader } from "@/components/auth/auth-header";
import { GoogleButton, OrDivider } from "@/components/auth/social-sign-in";
import { authInputClass } from "@/components/auth/auth-field-classes";
import { PASSWORD_HINT, checkNewPassword } from "@/lib/auth/password-policy";
import { buttonPrimaryClass, fieldLabelClass } from "@/components/ui/form-field";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"details" | "verify">("details");
  const [otp, setOtp] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const router = useRouter();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    const policy = checkNewPassword(password);
    if (!policy.ok) {
      setPasswordError(policy.message);
      return;
    }
    setPasswordError("");
    setLoading(true);
    try {
      const result = await authClient.signUp.email({ email, password, name });
      if (result.error) throw result.error;

      // When the project requires email verification there is no session yet.
      const session = await authClient.getSession();
      if (session.data) {
        router.push(afterSignInPath(window.location.search));
        router.refresh();
      } else {
        setStep("verify");
      }
    } catch (err: unknown) {
      setError(authErrorMessage(err, "We couldn't create your account. Check your details and try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const result = await authClient.emailOtp.verifyEmail({ email, otp: otp.trim() });
      if (result.error) throw result.error;
      router.push(afterSignInPath(window.location.search));
      router.refresh();
    } catch (err: unknown) {
      setError(authErrorMessage(err, "We couldn't verify that code. Check it and try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (loading) return;
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      if (result.error) throw result.error;
      setNotice("We sent you a new code.");
    } catch (err: unknown) {
      setError(authErrorMessage(err, "We couldn't send a new code. Wait a minute and try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: afterSignInPath(window.location.search),
      });
      if (result?.error) throw result.error;
    } catch (err: unknown) {
      setError(authErrorMessage(err, "We couldn't sign you up with Google. Try again, or use your email."));
      setLoading(false);
    }
  };

  return (
    <>
      <AuthHeader
        title="Create your account"
        intro="You will choose a separate passphrase for your vault after this."
      />

      <CheckoutIntentBanner mode="register" />

      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}

      {step === "verify" ? (
        <form onSubmit={handleVerify} className="space-y-5">
          <p className="text-sm text-foreground-secondary">
            We emailed a code to <span className="font-medium text-foreground break-all">{email}</span>.
            Enter it below to finish creating your account.
          </p>
          {notice && (
            <p role="status" className="text-sm text-foreground-secondary">
              {notice}
            </p>
          )}
          <div>
            <label htmlFor="register-otp" className={fieldLabelClass}>
              Verification code
            </label>
            <input
              id="register-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className={`${authInputClass} tracking-widest`}
              placeholder="123456"
            />
          </div>
          <button type="submit" disabled={loading} className={`${buttonPrimaryClass} w-full`}>
            {loading ? "Checking..." : "Verify email"}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={loading}
            className="w-full text-sm text-accent-text disabled:opacity-50 min-h-11 underline underline-offset-2"
          >
            Send a new code
          </button>
        </form>
      ) : (
        <>
          <GoogleButton onClick={handleGoogleSignUp} disabled={loading} />

          <OrDivider />

          <form onSubmit={handleRegister} className="space-y-5">
            <div>
              <label htmlFor="register-name" className={fieldLabelClass}>
                Full name
              </label>
              <input
                id="register-name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={authInputClass}
              />
            </div>
            <div>
              <label htmlFor="register-email" className={fieldLabelClass}>
                Email
              </label>
              <input
                id="register-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authInputClass}
                placeholder="you@example.com"
              />
            </div>
            <PasswordField
              id="register-password"
              label="Password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              hint={PASSWORD_HINT}
              error={passwordError}
            />

            <button type="submit" disabled={loading} className={`${buttonPrimaryClass} w-full`}>
              <UserPlus strokeWidth={1.75} className="w-4 h-4" aria-hidden="true" />
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>
        </>
      )}

      <div className="mt-8 text-center text-sm text-foreground-secondary">
        Already have an account?{" "}
        <IntentLink to="/login" className="text-accent-text font-medium underline underline-offset-2 inline-flex min-h-11 items-center">
          Sign in
        </IntentLink>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/client-errors";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"details" | "verify">("details");
  const [otp, setOtp] = useState("");
  const [notice, setNotice] = useState("");
  const router = useRouter();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const result = await authClient.signUp.email({ email, password, name });
      if (result.error) throw result.error;

      // When the project requires email verification there is no session yet.
      const session = await authClient.getSession();
      if (session.data) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setStep("verify");
      }
    } catch (err: unknown) {
      setError(authErrorMessage(err, "Registration failed."));
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
      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      setError(authErrorMessage(err, "Verification failed."));
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
      setError(authErrorMessage(err, "Could not send a new code."));
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
        callbackURL: "/dashboard",
      });
      if (result?.error) throw result.error;
    } catch (err: unknown) {
      setError(authErrorMessage(err, "Google sign-up failed."));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 relative overflow-hidden transition-colors">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>

      <div className="w-full max-w-md border border-border bg-card rounded-2xl p-8 shadow-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
            Create your account
          </h1>
          <p className="text-sm text-foreground-secondary">
            Start securing your digital legacy.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger-fg)] text-[var(--danger-fg)] text-sm text-center">
            {error}
          </div>
        )}

        {step === "verify" ? (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-foreground-secondary text-center">
              We emailed a code to <span className="font-medium text-foreground">{email}</span>.
              Enter it below to finish creating your account.
            </p>
            {notice && (
              <p role="status" className="text-sm text-center text-foreground-secondary">
                {notice}
              </p>
            )}
            <div>
              <label
                htmlFor="register-otp"
                className="block text-xs font-medium text-foreground-secondary mb-2 ml-1"
              >
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
                className="w-full bg-background border border-border focus:border-brand focus:ring-1 focus:ring-brand rounded-lg p-3 text-foreground outline-none transition-all placeholder:text-foreground-muted tracking-widest"
                placeholder="123456"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand text-on-brand hover:bg-brand-hover font-semibold transition-colors p-3 rounded-lg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {loading ? "Checking..." : "Verify email"}
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={loading}
              className="w-full text-sm text-accent-text hover:underline disabled:opacity-50"
            >
              Send a new code
            </button>
          </form>
        ) : (
          <>
        <button
          type="button"
          onClick={handleGoogleSignUp}
          disabled={loading}
          className="w-full border border-border bg-elevated hover:bg-hover text-foreground font-medium transition-colors p-3 rounded-lg flex items-center justify-center gap-3 disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-foreground-muted uppercase tracking-wider">
            or
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label
              htmlFor="register-name"
              className="block text-xs font-medium text-foreground-secondary mb-2 ml-1"
            >
              Full name
            </label>
            <input
              id="register-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-background border border-border focus:border-brand focus:ring-1 focus:ring-brand rounded-lg p-3 text-foreground outline-none transition-all placeholder:text-foreground-muted"
              placeholder="Satoshi Nakamoto"
            />
          </div>
          <div>
            <label
              htmlFor="register-email"
              className="block text-xs font-medium text-foreground-secondary mb-2 ml-1"
            >
              Email
            </label>
            <input
              id="register-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-border focus:border-brand focus:ring-1 focus:ring-brand rounded-lg p-3 text-foreground outline-none transition-all placeholder:text-foreground-muted"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label
              htmlFor="register-password"
              className="block text-xs font-medium text-foreground-secondary mb-2 ml-1"
            >
              Password
            </label>
            <input
              id="register-password"
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background border border-border focus:border-brand focus:ring-1 focus:ring-brand rounded-lg p-3 text-foreground outline-none transition-all placeholder:text-foreground-muted"
              placeholder="At least 10 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand text-on-brand hover:bg-brand-hover font-semibold transition-colors p-3 rounded-lg flex items-center justify-center gap-2 mt-4 shadow-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Shield strokeWidth={1.75} className="w-4 h-4" />
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>
          </>
        )}

        <div className="mt-8 text-center text-sm text-foreground-secondary">
          Already have an account?{" "}
          <Link href="/login" className="text-accent-text hover:underline font-medium">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}